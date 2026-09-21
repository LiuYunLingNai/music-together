import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'
import { Howler } from 'howler'
import type { Howl } from 'howler'
import { getAudioTapAnalyser, publishStretchAnalyser } from './audioTap'
import { SERVER_URL } from './config'

const MIN_TEMPO = 0.99
const MAX_TEMPO = 1.01
const CORS_AUDIO_HOST_SUFFIXES = ['music.126.net', 'music.163.com', 'qqmusic.qq.com', 'kugou.com', 'kugou.net']

interface InternalHowl extends Howl {
  _sounds?: Array<{ _node?: HTMLMediaElement }>
}

interface InternalHowler {
  _obtainHtml5Audio: () => HTMLAudioElement
}

interface StretchGraph {
  audio: HTMLMediaElement
  source: MediaElementAudioSourceNode
  node: SoundTouchNode
  context: AudioContext
  bypassed: boolean
  failed: boolean
  metricsSnapshots: number
  lastBlockCount: number
  lastUnderrunCount: number
  /**
   * 只读分析旁路节点。
   *
   * ★ 为什么必须挂在这里而不是 `Howler.masterGain`：
   *   本项目的音频链路是
   *     HTMLMediaElement → createMediaElementSource → SoundTouch → destination
   *   它**完全绕过了 Howler 的 masterGain**（HTML5 音频 + 自定义 worklet 路由）。
   *   把 AnalyserNode 接在 masterGain 上，那条线上永远没有音频流过 ——
   *   分析结果恒为 0，表现为「视觉完全没有鼓点」。
   *
   *   AnalyserNode 是纯读取节点，接在 worklet 输出与 destination 之间
   *   **不会改变声音**（不接回 destination 的另一路），也不碰 SoundTouch。
   */
  analyser: AnalyserNode | null
}

export interface TimeStretchController {
  readonly enabled: boolean
  setEnabled: (enabled: boolean) => void
  setTempo: (tempo: number) => void
  reset: () => void
}

const graphByAudio = new WeakMap<HTMLMediaElement, StretchGraph>()
const registrationByContext = new WeakMap<BaseAudioContext, Promise<void>>()
let nextAudioUsesCors = false
let obtainAudioPatched = false

/**
 * 占位"禁用图"（节拍丢失加固，见 attachTimeStretch 内注释）：
 *
 * createMediaElementSource 必须在 SoundTouchNode 之前创建，而后者可能失败。
 * 失败后元素已被 ctx 接管、不能回池复用 —— 缓存里必须有一条**有效**记录，
 * 否则同元素的下次 attach 会因为缓存 miss 再走一遍注定失败的路径。
 * 这里登记一条直通 destination 的死图（node 字段塞一个最小占位对象，
 * controller 的所有方法在 failed 图上是安全 no-op）。
 */
function createDisabledGraph(context: AudioContext, audio: HTMLMediaElement): StretchGraph {
  const dummyNode = { playbackRate: { setValueAtTime: () => {} } } as unknown as SoundTouchNode
  return {
    audio,
    source: null as unknown as MediaElementAudioSourceNode,
    node: dummyNode,
    context,
    bypassed: true,
    failed: true,
    metricsSnapshots: 0,
    lastBlockCount: 0,
    lastUnderrunCount: 0,
    analyser: null,
  }
}

/**
 * 把元素从 Howler 的 HTML5 Audio 复用池里**永久摘除**。
 *
 * 元素已被 createMediaElementSource 接管（或接管失败但状态未知）后，
 * 回池复用会让下一次 attach 走进 InvalidStateError。池外的元素随
 * Howl.unload 的 GC 自然消亡，Howler 池空时只是 new 一个新的。
 */
function retireAudioElement(audio: HTMLMediaElement): void {
  const howler = Howler as unknown as {
    _html5AudioPool?: HTMLMediaElement[]
  }
  const pool = howler._html5AudioPool
  if (!Array.isArray(pool)) return
  const index = pool.indexOf(audio)
  if (index >= 0) pool.splice(index, 1)
}

/**
 * Howler has no public option for HTMLMediaElement.crossOrigin. Patch its
 * element factory once and mark the next synchronously-created element for
 * anonymous CORS before Howler assigns the direct CDN URL.
 */
export function prepareDirectStreamForTimeStretch(streamUrl: string): boolean {
  let supportsCors = false
  try {
    const stream = new URL(streamUrl)
    const hostname = stream.hostname.toLowerCase()
    supportsCors =
      stream.origin === window.location.origin ||
      stream.origin === new URL(SERVER_URL).origin ||
      CORS_AUDIO_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  } catch {
    supportsCors = false
  }

  const internalHowler = Howler as unknown as InternalHowler
  if (!obtainAudioPatched) {
    const obtainHtml5Audio = internalHowler._obtainHtml5Audio
    internalHowler._obtainHtml5Audio = function () {
      const audio = obtainHtml5Audio.call(this)
      if (nextAudioUsesCors) audio.crossOrigin = 'anonymous'
      else audio.removeAttribute('crossorigin')
      nextAudioUsesCors = false
      return audio
    }
    obtainAudioPatched = true
  }
  nextAudioUsesCors = supportsCors
  return supportsCors
}

function getAudioElement(howl: Howl): HTMLMediaElement | null {
  const sound = (howl as InternalHowl)._sounds?.[0]
  return sound?._node ?? null
}

/**
 * 切歌/卸载时撤回该 Howl 发布的分析节点（节拍丢失加固）。
 *
 * `audioTap` 是**全局单例**：旧歌卸载后，tap 仍指向旧音频图上的
 * AnalyserNode。若新歌走非 CORS 流（canTimeStretch=false）或 attach
 * 失败，没有任何人会发布新 tap —— 视觉层从此每帧升级到旧歌的死
 * 节点，频谱恒零；更糟的是看门狗拆线后下一帧又升级回同一个死 tap，
 * 节拍反馈永久消失直到刷新页面。
 *
 * 在 Howl unload 时把"本图发布的 tap"撤回为 null，视觉层回落到
 * 未接线状态等待新 tap —— 死节点不再被锁死进单例。
 */
export function releaseTimeStretch(howl: Howl): void {
  const audio = getAudioElement(howl)
  if (!audio) return
  const graph = graphByAudio.get(audio)
  if (graph?.analyser && getAudioTapAnalyser() === graph.analyser) {
    publishStretchAnalyser(null)
  }
}

function registerProcessor(context: AudioContext): Promise<void> {
  const existing = registrationByContext.get(context)
  if (existing) return existing
  const registration = SoundTouchNode.register(context, processorUrl)
  registrationByContext.set(context, registration)
  return registration
}

function disableGraph(graph: StretchGraph, failed = false): void {
  if (failed) graph.failed = true
  // 占位禁用图（attach 失败的登记条目）没有真实节点，保持 no-op 即可
  if (graph.bypassed || !graph.source) return
  graph.bypassed = true
  graph.node.playbackRate.setValueAtTime(1, graph.context.currentTime)
  graph.node.disconnect()
  graph.source.disconnect()
  graph.source.connect(graph.context.destination)
  // 旁路时 worklet 被摘掉，分析节点要改从音源直接取，否则视觉会静音
  if (graph.analyser) graph.source.connect(graph.analyser)
  graph.audio.playbackRate = 1
}

function resumeContext(graph: StretchGraph): void {
  if (graph.context.state === 'running') return
  void graph.context.resume().catch((error) => {
    console.warn('Unable to resume time-stretch audio context', error)
  })
}

function enableGraph(graph: StretchGraph): void {
  if (!graph.bypassed || graph.failed || !graph.source) return
  resumeContext(graph)
  graph.source.disconnect()
  graph.source.connect(graph.node)
  graph.node.connect(graph.context.destination)
  // 分析节点重新挂到 worklet 输出
  if (graph.analyser) graph.node.connect(graph.analyser)
  graph.bypassed = false
  graph.metricsSnapshots = 0
  graph.lastBlockCount = graph.node.metrics?.blockCount ?? 0
  graph.lastUnderrunCount = graph.node.metrics?.underrunCount ?? 0
}

/**
 * Attach SoundTouch's WSOLA AudioWorklet to Howler's HTML5 media element.
 * The returned controller is intentionally fail-closed: if the browser does
 * not support AudioWorklet or the processor underruns, native 1.0x playback
 * is restored instead of producing malformed audio.
 */
export async function attachTimeStretch(howl: Howl): Promise<TimeStretchController | null> {
  if (typeof AudioContext === 'undefined') return null
  const audio = getAudioElement(howl)
  if (!audio) return null

  const existing = graphByAudio.get(audio)
  if (existing) {
    // ★ 复用重发布（节拍丢失闭环的另一半）：`releaseTimeStretch` 在切歌时
    //   把全局 tap 撤回为 null，而 Howler 的元素池是 LIFO 复用 —— 下一首歌
    //   很可能领回**同一个**元素，走到这里提前返回。若不重新发布，tap 单例
    //   恒为 null，视觉层只能落到 masterGain 兜底线（恒零）—— "从第二首起
    //   节拍永久丢失"的回归正是漏了这一半。图未 failed 时重新发布其 analyser。
    if (existing.analyser && !existing.failed && getAudioTapAnalyser() === null) {
      publishStretchAnalyser(existing.analyser)
    }
    return createController(existing)
  }

  const context = Howler.ctx
  if (!context) return null

  // ★ 抢占式缓存（节拍丢失加固）：
  //
  // Howler 的 HTML5 Audio 元素是**池化复用**的（_obtainHtml5Audio →
  // unload 时 _releaseHtml5Audio 回池）。而 HTMLMediaElement 一旦被
  // createMediaElementSource 接管就**终生属于该 ctx** —— 回池后再次取出，
  // 任何新的 createMediaElementSource(audio) 都会抛
  // InvalidStateError（"HTMLMediaElement already connected"）。
  //
  // 此前若 attach 在 source 创建**之后**、graphByAudio.set **之前**抛错
  // （SoundTouchNode 构造失败等），带孤儿 source 的元素就会回池：之后
  // 每一首歌领到它都 attach 失败 → tap 指向旧图的死节点 → 频谱全零 →
  // 视觉所有模式的节拍反馈静默消失，直到整页刷新。
  //
  // 修复：attach 一开始就登记占位禁用图 —— 保证缓存里永远是有效条目，
  // 同时失败分支据此把元素从 Howler 复用池永久摘除（retireAudioElement），
  // 杜绝"孤儿 source 元素"再次分配。
  graphByAudio.set(audio, createDisabledGraph(context, audio))
  let source: MediaElementAudioSourceNode | null = null

  try {
    await registerProcessor(context)
    source = context.createMediaElementSource(audio)
    const node = new SoundTouchNode({ context, interpolationStrategy: 'lanczos' })
    node.setStretchParameters({ sequenceMs: 80, seekWindowMs: 20, overlapMs: 12, quickSeek: true })
    node.pitch.value = 1
    source.connect(node)

    // 只读分析旁路：worklet 输出 → AnalyserNode（不接回 destination）。
    // 视觉层从这里取频谱 —— 这是唯一一条真正有音频流过的路径。
    let analyser: AnalyserNode | null = null
    try {
      analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.58
      analyser.minDecibels = -82
      analyser.maxDecibels = -8
      node.connect(analyser)
    } catch {
      analyser = null
    }

    node.connect(context.destination)

    const graph: StretchGraph = {
      audio,
      source,
      node,
      context,
      bypassed: false,
      failed: false,
      metricsSnapshots: 0,
      lastBlockCount: 0,
      lastUnderrunCount: 0,
      analyser,
    }
    if (analyser) publishStretchAnalyser(analyser)
    graphByAudio.set(audio, graph)
    // These Howls use HTML5 Audio, so Howler's auto-suspend scan does not
    // count them as active WebAudio sounds. The media element is nevertheless
    // routed through this context; allowing Howler to suspend it would leave
    // currentTime advancing while producing no audio after about 30 seconds.
    Howler.autoSuspend = false
    resumeContext(graph)

    node.addEventListener('metrics', () => {
      const metrics = node.metrics
      if (!metrics) return
      graph.metricsSnapshots++
      const blockDelta = metrics.blockCount - graph.lastBlockCount
      const underrunDelta = metrics.underrunCount - graph.lastUnderrunCount
      graph.lastBlockCount = metrics.blockCount
      graph.lastUnderrunCount = metrics.underrunCount

      // WSOLA needs a short initial buffer, so startup underruns are expected.
      // After warm-up, sustained gaps indicate that this device cannot keep up.
      if (graph.metricsSnapshots > 3 && blockDelta > 0 && underrunDelta / blockDelta > 0.02) {
        disableGraph(graph, true)
      }
    })
    return createController(graph)
  } catch (error) {
    // 失败分支：缓存里已是占位禁用图。source 若已创建，把它接通
    // destination（占位图标记 failed，controller 全部 no-op），保证该
    // 元素的音频链路可用；否则（createMediaElementSource 本身抛错）
    // 元素不可再入池 —— 摘除它，杜绝"孤儿 source 元素"再次分配。
    if (source) {
      source.connect(context.destination)
      const graph = graphByAudio.get(audio)
      if (graph) graph.failed = true
    } else {
      retireAudioElement(audio)
    }
    audio.playbackRate = 1
    console.warn('Time-stretch processor unavailable; keeping native 1.0x audio', error)
    return null
  }
}

function createController(graph: StretchGraph): TimeStretchController {
  return {
    get enabled() {
      return !graph.bypassed
    },
    setEnabled: (enabled) => {
      if (enabled) enableGraph(graph)
      else disableGraph(graph)
    },
    setTempo: (tempo) => {
      if (graph.bypassed) return
      resumeContext(graph)
      const clamped = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, tempo))
      graph.audio.playbackRate = clamped
      graph.node.playbackRate.setValueAtTime(clamped, graph.context.currentTime)
    },
    reset: () => {
      graph.audio.playbackRate = 1
      graph.node.playbackRate.setValueAtTime(1, graph.context.currentTime)
    },
  }
}
