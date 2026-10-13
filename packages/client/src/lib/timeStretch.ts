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
  /** AudioWorklet 注册尚未完成；此时歌曲可能已被快速切走。 */
  initializing: boolean
  /** 初始化期间对应的 Howl 已释放，异步任务不得再建图或发布 tap。 */
  cancelled: boolean
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
  /**
   * 用户音量的图内一半（`installVolumeRouting` 的 √v 分支）。
   *
   * ★ 拓扑（上游 Mineradio 同款，见 installVolumeRouting 顶部说明）：
   *     source(el.volume=√v) → soundtouch → volumeGain(√v) → destination
   *                        └→ analyser（旁路，幅度 ∝ √v）
   * analyser 在两半之间 —— **节拍反馈跟随音量**（√v 感知曲线），静音时
   * 两半都写地板值，信号继续流过分析线，节拍不丢。
   *
   * 占位/失败图（无 source）为 null，保持原生 el.volume 语义。
   */
  volumeGain: GainNode | null
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
 * 已装"volume → gain 转发"的元素 → 其 gain。
 *
 * HTML5 元素是池化复用的：同元素换歌重 attach 时会再次走到建图代码，
 * 必须避免对同一个元素重复 defineProperty（二次包装会让还原逻辑失效）。
 * releaseTimeStretch 撤回 tap 时按此表还原原生 volume 属性。
 */
const descriptorRestoreRef = new WeakMap<HTMLMediaElement, GainNode>()

/** 摘除元素上的 volume 转发，恢复原生属性（元素回池前调用）。 */
function uninstallVolumeRouting(audio: HTMLMediaElement): void {
  if (!descriptorRestoreRef.has(audio)) return
  descriptorRestoreRef.delete(audio)
  try {
    delete (audio as unknown as Record<string, unknown>).volume
  } catch {
    /* defineProperty 的 own property 用 delete 移除；极老引擎忽略 */
  }
}

/**
 * 当前会话是否处于静音地板（用户音量 ≤ 0.001）。
 *
 * AudioAnalyser 的"播放中频谱全零"看门狗据此放行静音：地板下频谱≈全零是
 * **预期行为**（低于字节精度），不是死 tap。true 表示"最后写入的
 * 音量分支是地板值"；未建图（原生元素）时读不到转发值，恒 false ——
 * 看门狗维持原判据，不会因静音漏报真异常。
 */
let volumeAtFloor = false

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
    initializing: true,
    cancelled: false,
    metricsSnapshots: 0,
    lastBlockCount: 0,
    lastUnderrunCount: 0,
    analyser: null,
    volumeGain: null,
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
export function releaseTimeStretch(howl: Howl): (() => void) | null {
  const audio = getAudioElement(howl)
  if (!audio) return null
  const graph = graphByAudio.get(audio)
  if (graph?.analyser && getAudioTapAnalyser() === graph.analyser) {
    publishStretchAnalyser(null)
  }
  // 撤回 volume 转发，把原生 volume 属性还给元素（回池复用后可能走
  // 不建图的直通路径，需要原生语义）。把当前分支值反解回用户音量再写回，
  // 避免音量在换歌瞬间跳变（地板值反解为 0，即真静音）。
  if (descriptorRestoreRef.has(audio)) {
    const gain = descriptorRestoreRef.get(audio)!
    const branch = gain.gain.value
    uninstallVolumeRouting(audio)
    audio.volume = branch <= AUDIO_SILENCE_GAIN * 1.001 ? 0 : Math.min(1, branch * branch)
  }
  if (graph?.initializing) {
    graph.cancelled = true
    // Howler 会在紧接着的 unload() 中才把元素放回池。返回一个收尾函数，
    // 让调用方在 unload 后同步摘除，避免下一首在同一调用栈里领到这个仍有
    // 异步建图任务的元素。
    return () => retireAudioElement(audio)
  }
  return null
}

/**
 * 音量路由：把用户音量 v 拆成**元素 √v × 图内 gain √v**（上游 Mineradio
 * `08-audio-graph-controls.js` 的 `writeAudioOutputGain` 同款），并施加
 * 静音地板（上游 `AUDIO_SILENCE_GAIN`）。
 *
 * 拓扑：`source(el.volume=√v) → soundtouch → analyser(旁路) + volumeGain(√v) → destination`。
 * analyser 卡在两半之间，看到的信号幅度 ∝ √v（感知曲线）——
 * **节拍反馈跟随音量**（上游语义：低音量下视觉随之温柔），且 √v 在低音量端
 * 比线性保更大的检测余量。总响度 = √v·√v = v，听感不变。
 *
 * 静音地板：音量 ≤ 0.001（上游 `audioSilentFloor` 判据）时两半都写
 * `AUDIO_SILENCE_GAIN`（见常量处的取值论证）而不是 0 —— 元素 volume=0
 * 会让 MediaElementSource 物理静音进图（本轮"静音丢节拍"的根因），
 * 地板让信号继续流过 analyser，节拍引擎在静音时仍有东西可测。
 *
 * Howler 在 HTML5 模式下把音量直接写到 `el.volume`（`howl.volume()`、
 * `howl.fade()` 的每帧 tween 都是），所以还是劫持元素自身的 volume 属性：
 * `el.volume = v` → 元素写 √v'（带地板）、gain 写 √v'；读回返回 v。
 * 只有成功建图（有 volumeGain）才装；失败图同样安装（分析线语义一致），
 * 元素回池前由 `uninstallVolumeRouting` 还原。
 */

/** 静音地板（上游 Mineradio `AUDIO_SILENCE_GAIN` 的有效化修订）。
 *
 * 上游写 0.0001（-80dB）——但 -80dB 经 getByteFrequencyData 映射（默认
 * -100/-30dB 区间）后字节读数 ≈ 1~3，再经 smoothing 实测衰减到全零：
 * **上游的字面值在其自身分析链上读不出节拍**。这里取 0.005（-46dB）：
 * 仍然完全听不见（歌正播放时被完全掩蔽；歌内静音段泄漏低于安静房间本底），
 * 但字节读数 ~25/255，节拍引擎在静音时有真实信号可打点 —— 达成上游
 * "静音节拍反馈仍在"的设计意图，而不只是字面值。
 */
export const AUDIO_SILENCE_GAIN = 0.005
/** 上游 `audioSilentFloor` 的静音判据。 */
const VOLUME_FLOOR_THRESHOLD = 0.001

/** 上游 `writeAudioOutputGain` 的分支值：图内音量走感知平方根。 */
function splitVolumeGain(volume: number): number {
  if (volume <= VOLUME_FLOOR_THRESHOLD) return AUDIO_SILENCE_GAIN
  return Math.sqrt(volume)
}

function installVolumeRouting(audio: HTMLMediaElement, gain: GainNode): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
  if (!descriptor) return
  Object.defineProperty(audio, 'volume', {
    configurable: true,
    enumerable: true,
    get() {
      // 读回"用户音量"：从 gain 反解 v = (√v)²。地板值反解为 0（静音）。
      const branch = gain.gain.value
      return branch <= AUDIO_SILENCE_GAIN * 1.001 ? 0 : Math.min(1, branch * branch)
    },
    set(next: number) {
      const clamped = Math.max(0, Math.min(1, next))
      const branch = splitVolumeGain(clamped)
      gain.gain.value = branch
      volumeAtFloor = clamped <= VOLUME_FLOOR_THRESHOLD
      // 元素写同一分支值（上游同样同时写两处）。写地板而非 0：
      // 元素 volume=0 会让进图的信号物理静音，分析线跟着全零。
      descriptor.set!.call(audio, branch)
    },
  })
}

/** 看门狗查询：当前用户音量是否处于静音地板（频谱全零属预期）。 */
export function isPlaybackVolumeAtFloor(): boolean {
  return volumeAtFloor
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
  // ★ bypass 时音量节点仍在链上：source → volumeGain → destination。
  //   元素 volume 属性已被转发到 gain（installVolumeRouting），不能把
  //   元素直接接回 destination 而绕过它 —— 否则"元素 volume=1 全幅直出"
  //   会让用户音量失控（变成最大音量）。
  if (graph.volumeGain) {
    graph.source.connect(graph.volumeGain)
    graph.volumeGain.connect(graph.context.destination)
  } else {
    graph.source.connect(graph.context.destination)
  }
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
    // 同一元素的首次异步初始化尚未落定时，不得把占位图当成可用 controller。
    if (existing.initializing) return null
    // ★ 复用重发布（节拍丢失闭环的另一半）：`releaseTimeStretch` 在切歌时
    //   把全局 tap 撤回为 null，而 Howler 的元素池是 LIFO 复用 —— 下一首歌
    //   很可能领回**同一个**元素，走到这里提前返回。若不重新发布，tap 单例
    //   恒为 null，视觉层只能落到 masterGain 兜底线（恒零）—— "从第二首起
    //   节拍永久丢失"的回归正是漏了这一半。
    //
    // failed 只表示 WSOLA 变速已回退直通；disableGraph 已把 source 同时接到
    // analyser，因此频谱仍然有效，不能因为 failed 拒绝发布。若全局还残留
    // 另一首歌的 tap，也必须由当前图主动接管，而不是只在 null 时发布。
    if (existing.analyser && getAudioTapAnalyser() !== existing.analyser) {
      publishStretchAnalyser(existing.analyser)
    }
    // ★ 复用分支必须重新装 volume 转发：releaseTimeStretch 在换歌时已把
    //   原生 volume 属性还给元素（uninstallVolumeRouting），若不接回，
    //   Howler 写 el.volume=0 会让进图信号物理静音 —— 静音丢节拍从这里复发。
    if (existing.volumeGain && !descriptorRestoreRef.has(audio)) {
      existing.volumeGain.gain.value = splitVolumeGain(audio.volume)
      installVolumeRouting(audio, existing.volumeGain)
      descriptorRestoreRef.set(audio, existing.volumeGain)
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
  const pendingGraph = createDisabledGraph(context, audio)
  graphByAudio.set(audio, pendingGraph)
  let source: MediaElementAudioSourceNode | null = null
  let stretchNode: SoundTouchNode | null = null

  try {
    await registerProcessor(context)
    // 连续切歌可能在 AudioWorklet 注册完成前已经 unload 当前 Howl。旧任务
    // 此后若继续 createMediaElementSource 并 publish，会用死节点覆盖新歌 tap。
    if (pendingGraph.cancelled || graphByAudio.get(audio) !== pendingGraph) return null
    source = context.createMediaElementSource(audio)
    stretchNode = new SoundTouchNode({ context, interpolationStrategy: 'lanczos' })
    stretchNode.setStretchParameters({ sequenceMs: 80, seekWindowMs: 20, overlapMs: 12, quickSeek: true })
    stretchNode.pitch.value = 1
    source.connect(stretchNode)

    // 用户音量 √v 拆分（见 installVolumeRouting 顶部说明）：元素与 gain 各拿
    // 一半，analyser 卡在中间看 √v 幅度。必须在发布 tap 之前装好转发，避免
    // Howler 先写 el.volume=0 而此刻 gain 仍是默认 1 的窗口。
    const volumeGain = context.createGain()
    volumeGain.gain.value = splitVolumeGain(audio.volume)
    installVolumeRouting(audio, volumeGain)
    descriptorRestoreRef.set(audio, volumeGain)

    // 只读分析旁路：worklet 输出 → AnalyserNode（不接回 destination）。
    // 视觉层从这里取频谱 —— 这是唯一一条真正有音频流过的路径。
    //
    // ★ 不设 minDecibels/maxDecibels（上游 Mineradio 建图处同样只设 fftSize +
    //   smoothing）：Web Audio 默认 -100/-30dB 下，静音地板信号的字节读数
    //   仍有 ~25/255 —— 节拍引擎在静音时有足够分辨率继续打点（上游同款
    //   语义）。此前项目里自设的 -82/-8 收窄把地板信号压到字节读数 2~7，
    //   近似量化归零 —— 表现为"音量 0 就又没节拍"。
    let analyser: AnalyserNode | null = null
    try {
      analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.58
      stretchNode.connect(analyser)
    } catch {
      analyser = null
    }

    stretchNode.connect(volumeGain)
    volumeGain.connect(context.destination)

    const graph: StretchGraph = {
      audio,
      source,
      node: stretchNode,
      context,
      bypassed: false,
      failed: false,
      initializing: false,
      cancelled: false,
      metricsSnapshots: 0,
      lastBlockCount: 0,
      lastUnderrunCount: 0,
      analyser,
      volumeGain,
    }
    if (analyser) publishStretchAnalyser(analyser)
    graphByAudio.set(audio, graph)
    // These Howls use HTML5 Audio, so Howler's auto-suspend scan does not
    // count them as active WebAudio sounds. The media element is nevertheless
    // routed through this context; allowing Howler to suspend it would leave
    // currentTime advancing while producing no audio after about 30 seconds.
    Howler.autoSuspend = false
    resumeContext(graph)

    stretchNode.addEventListener('metrics', () => {
      const metrics = stretchNode?.metrics
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
    // destination，并直接挂 analyser。变速虽然关闭，节拍输入仍应工作；
    // 否则一次 WSOLA 初始化失败会连带让后续复用该元素的歌曲都没有频谱。
    // AudioWorklet 注册可能在 createMediaElementSource 之前失败；只要歌曲还
    // 没被切走，就补建纯直通 source，让这类浏览器也保留节拍分析能力。
    if (!source && !pendingGraph.cancelled) {
      try {
        source = context.createMediaElementSource(audio)
      } catch {
        source = null
      }
    }
    if (source) {
      try {
        stretchNode?.disconnect()
        source.disconnect()
      } catch {
        /* 节点可能尚未连接 */
      }
      // 失败图同语义：√v 拆分 + 地板，静音时节拍输入仍工作。
      const fallbackGain = context.createGain()
      fallbackGain.gain.value = splitVolumeGain(audio.volume)
      installVolumeRouting(audio, fallbackGain)
      descriptorRestoreRef.set(audio, fallbackGain)
      source.connect(fallbackGain)
      fallbackGain.connect(context.destination)
      let fallbackAnalyser: AnalyserNode | null = null
      try {
        fallbackAnalyser = context.createAnalyser()
        fallbackAnalyser.fftSize = 2048
        fallbackAnalyser.smoothingTimeConstant = 0.58
        // 不设 min/maxDecibels（与成功图一致，静音地板可读）
        source.connect(fallbackAnalyser)
        publishStretchAnalyser(fallbackAnalyser)
      } catch {
        fallbackAnalyser = null
      }
      pendingGraph.source = source
      pendingGraph.analyser = fallbackAnalyser
      pendingGraph.volumeGain = fallbackGain
      pendingGraph.initializing = false
      pendingGraph.failed = true
    } else {
      pendingGraph.cancelled = true
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
