import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'
import { Howler } from 'howler'
import type { Howl } from 'howler'
import {
  AUTOMIX_MIN_OVERLAP_SEC,
  buildBandCurves,
  buildCrossfadeCurves,
  dbToGain,
  TONE_EDGE_HZ,
  TONE_MID_HZ,
  trimForBalance,
  type TransitionStyle,
} from '@music-together/shared'
import { getAudioTapAnalyser, publishLowFreqAnalyser, publishStretchAnalyser } from './audioTap'
import { createDeckAnalyser, type DeckAnalyser } from './automix/upstream/deckAnalyser'
import { clearTrackLoudness, getReplayGainLinear, subscribeReplayGain } from './replayGain'
import { AUDIO_EQUALIZER_BANDS, audioEqualizerBandShape } from './audioEqualizer'
import { DEFAULT_AUDIO_EFFECT_SETTINGS, normalizeAudioEffects } from './audioEffects/model'
import { createAudioEffectChain, type AudioEffectChain } from './audioEffects/chain'
import { SERVER_URL } from './config'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'

const MIN_TEMPO = 0.99
const MAX_TEMPO = 1.01

const CORS_AUDIO_HOST_SUFFIXES = ['music.126.net', 'music.163.com', 'qqmusic.qq.com', 'kugou.com', 'kugou.net']

/** 中频钟形滤波的宽度：要的是整体音色倾向，不是修共振。 */
const MID_BELL_Q = 0.8
/** 没有 BPM 时的回声间隔：120 BPM 的八分音符。 */
const THROW_DEFAULT_DELAY_SEC = 0.25
const THROW_FEEDBACK = 0.45
const THROW_SEND = 0.6
const THROW_OPEN_SEC = 0.15
/** 频段曲线结束后回到平直的时间；上游同一取值。 */
const TONE_RESET_SEC = 0.12
/** 曲线尾部保护：引擎按渲染量子推进，端点差一个量子会被拒绝。 */
const CURVE_TAIL_GUARD_SEC = 0.006
/** 上游 `deckAnalyser` 的取样与 `startBalanceCorrection` 的复读节奏。 */
const BALANCE_TICK_MS = 25
const BALANCE_INTERVAL_MS = 100
const BALANCE_RAMP_SEC = 0.4
/** 小于这个量的修正不值得动增益；上游同一取值。 */
const BALANCE_STEP_DB = 0.75

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
  /** 同步变速开关：只用元素原生速率，音频不再经过 SoundTouch worklet。 */
  tempoEnabled: boolean
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
  /** 低频专用旁路（背景鼓点跳动）；与 `analyser` 同源，上限放宽到 0dB。 */
  lowFreqAnalyser: AnalyserNode | null
  /** 上游 `createDeckAnalyser`：过渡期间测量本 deck 自己的电平（在 fade 之前取样）。 */
  deckAnalyser: DeckAnalyser | null
  /** 十段均衡器；未启用时增益为 0，节点仍在链上，切开关不会重建音频图。 */
  equalizer: BiquadFilterNode[]
  /** 均衡器之后的效果链（饱和 / 降位 / 抖晃 / 底噪 / 宽度 / 动态 / 混响）。 */
  effectChain: AudioEffectChain | null
  /** 效果链入口；旁路切换只改均衡器接法，链内节点保持连接。 */
  chainInput: GainNode | null
  /** 元素与分轨 deck 的汇合点；默认链路从这里直接到响度/音量。 */
  sourceOut: GainNode | null
  /** 分轨 deck 的接入点；与元素共享后续处理，但不受元素静音闸门影响。 */
  externalInput: GainNode | null
  /** automix 专用的音色/回声/电平测量是否已经接入。 */
  automixWired: boolean
  /** 当前前缀是否已经按 EQ/效果的实际开关接过。 */
  prefixWired: boolean
  routedEq: boolean
  routedEffects: boolean
  /** 效果链出口；分析节点与音量节点都挂这里。 */
  chainOutput: GainNode | null
  /** ReplayGain 响度归一化；未开启时恒为 1。 */
  replayGainNode: GainNode | null
  /** 过渡期的出歌平衡修正；平时为 1。 */
  trimGain: GainNode | null
  /** 自动混音 deck 接管期间的静音闸门；平时为 1。 */
  muteGain: GainNode | null
  /** 过渡曲线闸门（等功率）；平时为 1。 */
  transitionGain: GainNode | null
  /** 自动混音的三段音色（低架/中钟/高架），静止时全平。 */
  tone: { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode } | null
  /** 回声抛送：从 fade 之前取样，绕过过渡曲线，接在用户音量上。 */
  throwSend: GainNode | null
  throwDelay: DelayNode | null
  throwFeedback: GainNode | null
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
const activeGraphs = new Set<StretchGraph>()
const registrationByContext = new WeakMap<BaseAudioContext, Promise<void>>()

const createEqualizer = (context: AudioContext): BiquadFilterNode[] =>
  AUDIO_EQUALIZER_BANDS.map((band, index) => {
    const filter = context.createBiquadFilter()
    filter.type = audioEqualizerBandShape(index)
    filter.frequency.value = Math.min(band.frequency, context.sampleRate * 0.475)
    filter.Q.value = 1.4
    filter.gain.value = 0
    return filter
  })

const applyEqualizer = (graph: StretchGraph): void => {
  const { equalizer } = useAudioSettingsStore.getState()
  graph.equalizer.forEach((filter, index) => {
    filter.gain.setTargetAtTime(equalizer.enabled ? (equalizer.gains[index] ?? 0) : 0, graph.context.currentTime, 0.015)
  })
}

/** 效果是否真的会改变声音；全中性时整条效果链都不接进信号路径。 */
const effectsAreActive = (effects: Parameters<typeof normalizeAudioEffects>[0]): boolean => {
  const normalized = normalizeAudioEffects(effects)
  return Object.entries(normalized).some(
    ([key, value]) =>
      value !== DEFAULT_AUDIO_EFFECT_SETTINGS[key as keyof typeof DEFAULT_AUDIO_EFFECT_SETTINGS],
  )
}

/**
 * 只重建 sourceOut → 处理段 → ReplayGain 的前缀。
 *
 * 默认（EQ/效果关闭）时这里是 `sourceOut → replayGain` 两根增益节点，
 * 不经过任何 Biquad / WaveShaper / 压缩器。开启某项时才把对应节点接进来。
 * 固定的尾链（replayGain → trim → transition → volumeGain）与其上的
 * deck 测量支路不在这里动，避免重建把 automix 的取样点扯断。
 */
function rebuildPrefix(graph: StretchGraph): void {
  const sourceOut = graph.sourceOut
  if (!sourceOut) return
  const settings = useAudioSettingsStore.getState().equalizer
  sourceOut.disconnect()
  for (const filter of graph.equalizer) filter.disconnect()
  graph.chainOutput?.disconnect()

  if (graph.analyser) sourceOut.connect(graph.analyser)
  if (graph.lowFreqAnalyser) sourceOut.connect(graph.lowFreqAnalyser)

  let tail: AudioNode = sourceOut
  if (settings.enabled) {
    for (const filter of graph.equalizer) {
      tail.connect(filter)
      tail = filter
    }
  }
  if (
    settings.enabled &&
    effectsAreActive(settings.effects) &&
    graph.chainInput &&
    graph.chainOutput
  ) {
    tail.connect(graph.chainInput)
    tail = graph.chainOutput
  }
  tail.connect(graph.replayGainNode ?? graph.volumeGain ?? graph.context.destination)
  graph.prefixWired = true
  graph.routedEq = settings.enabled
  graph.routedEffects =
    settings.enabled &&
    effectsAreActive(settings.effects) &&
    Boolean(graph.chainInput && graph.chainOutput)
}

const applyAudioSettings = (graph: StretchGraph): void => {
  // 占位/失败图没有可用的前缀，不在它上面创建 EQ 或效果节点。
  if (!graph.sourceOut) return
  const { equalizer } = useAudioSettingsStore.getState()
  if (equalizer.enabled && graph.equalizer.length === 0) {
    graph.equalizer = createEqualizer(graph.context)
  }
  applyEqualizer(graph)
  const needsEq = equalizer.enabled
  const effectsActive = needsEq && effectsAreActive(equalizer.effects)
  if (effectsActive && !graph.effectChain) {
    const chainInput = graph.context.createGain()
    const chainOutput = graph.context.createGain()
    graph.chainInput = chainInput
    graph.chainOutput = chainOutput
    graph.effectChain = createAudioEffectChain({
      context: graph.context,
      input: chainInput,
      output: chainOutput,
      effects: equalizer.effects,
      enabled: true,
    })
  }
  graph.effectChain?.apply(equalizer.effects, effectsActive)
  const needsEffects = effectsActive && Boolean(graph.chainInput && graph.chainOutput)
  if (!graph.prefixWired || graph.routedEq !== needsEq || graph.routedEffects !== needsEffects) {
    rebuildPrefix(graph)
  }
  applyReplayGain(graph)
  applyOutputDevice(graph.audio)
}

type SinkCapableAudio = HTMLMediaElement & { setSinkId?: (deviceId: string) => Promise<void> }

const applyOutputDevice = (audio: HTMLMediaElement): void => {
  const { outputDeviceId } = useAudioSettingsStore.getState()
  const sink = audio as SinkCapableAudio
  if (!sink.setSinkId) return
  void sink.setSinkId(outputDeviceId).catch((error) => {
    console.warn('Unable to switch audio output device', error)
  })
}

const applyReplayGain = (graph: StretchGraph): void => {
  if (!graph.replayGainNode) return
  graph.replayGainNode.gain.setTargetAtTime(getReplayGainLinear(), graph.context.currentTime, 0.05)
}

subscribeReplayGain((linear, rampSec) => {
  for (const graph of activeGraphs) {
    const gain = graph.replayGainNode?.gain
    if (!gain) continue
    const now = graph.context.currentTime
    if (rampSec && rampSec > 0) {
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(gain.value, now)
      gain.linearRampToValueAtTime(linear, now + rampSec)
    } else {
      gain.setTargetAtTime(linear, now, 0.05)
    }
  }
})

useAudioSettingsStore.subscribe((state, previous) => {
  const equalizerChanged = state.equalizer !== previous.equalizer
  const outputChanged = state.outputDeviceId !== previous.outputDeviceId
  if (!equalizerChanged && !outputChanged) return
  for (const graph of activeGraphs) {
    if (equalizerChanged) applyAudioSettings(graph)
    else applyOutputDevice(graph.audio)
  }
})
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
    tempoEnabled: false,
    failed: true,
    initializing: true,
    cancelled: false,
    metricsSnapshots: 0,
    lastBlockCount: 0,
    lastUnderrunCount: 0,
    analyser: null,
    lowFreqAnalyser: null,
    deckAnalyser: null,
    equalizer: [],
    effectChain: null,
    chainInput: null,
    sourceOut: null,
    externalInput: null,
    automixWired: false,
    prefixWired: false,
    routedEq: false,
    routedEffects: false,
    chainOutput: null,
    replayGainNode: null,
    trimGain: null,
    muteGain: null,
    transitionGain: null,
    tone: null,
    throwSend: null,
    throwDelay: null,
    throwFeedback: null,
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
      applyOutputDevice(audio)
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
 * 在图的 muteGain 上做一次极短淡出，供定位前消除波形断点（爆音）。
 * 图不可用或已被其他流程静音（分轨交接）时返回 false，调用方应直接定位。
 */
export function duckHowlGraph(howl: Howl, rampSec: number): boolean {
  const graph = graphOf(howl)
  const gain = graph?.muteGain
  if (!graph || !gain || gain.gain.value < 0.5) return false
  return setHowlGraphMuted(howl, true, rampSec)
}

function graphOf(howl: Howl | null): StretchGraph | null {
  const audio = howl ? getAudioElement(howl) : null
  return audio ? graphByAudio.get(audio) ?? null : null
}

/**
 * 自动混音的等功率过渡曲线。与 Howler 的线性 fade 不同，两路在 −3 dB 处相交，
 * 同响度素材交叉时中点不塌陷。返回 false 表示没有音频图可承载曲线。
 */
export function scheduleHowlTransition(howl: Howl, direction: 'in' | 'out', seconds: number): boolean {
  const audio = getAudioElement(howl)
  const graph = audio ? graphByAudio.get(audio) : null
  const gain = graph?.transitionGain
  if (!graph || !gain || seconds <= 0) return false
  const now = graph.context.currentTime
  const points = 64
  const curve = new Float32Array(points)
  for (let index = 0; index < points; index += 1) {
    const t = index / (points - 1)
    curve[index] = direction === 'in' ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2)
  }
  try {
    gain.gain.cancelScheduledValues(now)
    // 曲线首点就是起点值；再写一个同时刻的 setValue 会与曲线自动化重叠而被拒绝。
    gain.gain.setValueCurveAtTime(curve, now, seconds)
  } catch {
    return false
  }
  return true
}

export interface AutomixBlendOptions {
  style: TransitionStyle
  /** 服务端 `shapeBlend.overlap`：实际交接长度（beatCut 为 40ms）。 */
  overlapSec: number
  /** 三频段交接位置（0..1）。 */
  crossover: number
  /** 入歌中高频的倾斜（dB）。 */
  tiltDb: [number, number]
  echoThrow: boolean
  bpm: number | null
  shapeBands: boolean
  sweepOut: boolean
  together: number
  /** 两侧整曲参考电平（ReplayGain 之前）；与上游 `referenceDb` 同义。 */
  outgoingReferenceDb?: number | null
  incomingReferenceDb?: number | null
}

/** 把三条频段曲线排到一副 deck 的音色节点上，并在曲线结束后回平。 */
function scheduleBands(
  tone: { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode },
  shapes: [Float32Array, Float32Array, Float32Array],
  begins: number,
  seconds: number,
  resetAt: number,
): void {
  const filters = [tone.low, tone.mid, tone.high]
  filters.forEach((filter, band) => {
    const shape = shapes[band]!
    filter.gain.cancelScheduledValues(begins)
    filter.gain.setValueCurveAtTime(shape, begins, seconds)
    // 曲线会停在最后一点上，过渡结束后必须显式回平，否则会带到下一首。
    filter.gain.setValueAtTime(shape[shape.length - 1]!, resetAt)
    filter.gain.linearRampToValueAtTime(0, resetAt + TONE_RESET_SEC)
  })
}

/** 上游 `scheduleEchoThrow`：在出歌被拿走的那一刻把最后一小段甩进延时线。 */
function scheduleThrow(graph: StretchGraph, bpm: number | null, at: number): void {
  const send = graph.throwSend
  const delay = graph.throwDelay
  const feedback = graph.throwFeedback
  if (!send || !delay || !feedback) return
  const periodSec = bpm && bpm > 0 ? 60 / bpm : null
  const repeat = periodSec && periodSec > 0
    ? Math.min(1, Math.max(0.08, periodSec / 2))
    : THROW_DEFAULT_DELAY_SEC
  const opensAt = Math.max(graph.context.currentTime, at - THROW_OPEN_SEC)
  const hitAt = Math.max(opensAt + 0.001, at)
  try {
    delay.delayTime.cancelScheduledValues(opensAt)
    delay.delayTime.setValueAtTime(repeat, opensAt)
    feedback.gain.setValueAtTime(THROW_FEEDBACK, opensAt)
    const gain = send.gain
    gain.cancelScheduledValues(opensAt)
    gain.setValueAtTime(0, opensAt)
    gain.linearRampToValueAtTime(THROW_SEND, hitAt)
    // 源一停就把发送关掉，已经进延时线的内容自己继续衰减。
    gain.setValueAtTime(THROW_SEND, hitAt)
    gain.linearRampToValueAtTime(0, hitAt + 0.03)
  } catch {
    send.gain.value = 0
  }
}

/**
 * 一次完整的自动混音过渡：两条 deck 的等功率曲线 +（需要时）三段频段交接
 * + 出歌的回声抛送。返回 false 表示音频图不可用，调用方回退到旧路径。
 */
export function scheduleAutomixBlend(
  outgoing: Howl | null,
  incoming: Howl,
  options: AutomixBlendOptions,
): boolean {
  const outGraph = graphOf(outgoing)
  const inGraph = graphOf(incoming)
  const outGain = outGraph?.transitionGain
  const inGain = inGraph?.transitionGain
  if (!outGraph || !inGraph || !outGain || !inGain || !(options.overlapSec > 0)) return false

  const seconds = Math.max(0.02, options.overlapSec)
  const curves = buildCrossfadeCurves(options.crossover, options.together, 64)
  const now = inGraph.context.currentTime
  try {
    outGain.gain.cancelScheduledValues(now)
    outGain.gain.setValueCurveAtTime(curves.out, now, seconds)
    inGain.gain.cancelScheduledValues(now)
    inGain.gain.setValueCurveAtTime(curves.in, now, seconds)
  } catch {
    return false
  }

  // 真正的混合才做实时补偿：硬切/短缝合时两首从不同时出声，压谁都是白掉一档音量。
  if (seconds >= AUTOMIX_MIN_OVERLAP_SEC) {
    startBalanceCorrection(outGraph, inGraph, {
      outgoingDb: options.outgoingReferenceDb ?? null,
      incomingDb: options.incomingReferenceDb ?? null,
    }, seconds)
  }

  if (options.shapeBands && outGraph.tone && inGraph.tone) {
    const bands = buildBandCurves({
      crossover: options.crossover,
      // 上游 `scheduleBandBlend` 对任何三频段交接都做低频换手。
      swapBass: true,
      sweepOut: options.sweepOut,
      tiltDb: options.tiltDb,
    })
    const resetAt = now + seconds + CURVE_TAIL_GUARD_SEC
    try {
      scheduleBands(outGraph.tone, bands.out, now, seconds, resetAt)
      scheduleBands(inGraph.tone, bands.in, now, seconds, resetAt)
    } catch {
      // 频段曲线失败不影响整体增益过渡。
    }
  }

  // 上游：硬切在开头抛，其他风格在两曲交接的那一刻抛。
  if (options.echoThrow) {
    scheduleThrow(
      outGraph,
      options.bpm,
      now + (options.style === 'beatCut' ? 0 : seconds * options.crossover),
    )
  }
  return true
}

/** 每副 deck 上正在跑的补偿计时器；换过渡或收尾时必须先停，否则会在归位后重新压低 trim。 */
const balanceStops = new WeakMap<StretchGraph, () => void>()

function stopBalanceCorrection(...graphs: StretchGraph[]): void {
  for (const graph of graphs) {
    balanceStops.get(graph)?.()
  }
}

/**
 * 上游 `startBalanceCorrection`：过渡期间复读两侧 deck 自己的电平，按 `trimForBalance`
 * 把出歌继续压低。只减不增、只动出歌，压过的量不回退，所以不会来回摆。
 *
 * 与上游一致，从 0 起步：两侧都有整曲画像时用服务端下发的整曲参考电平
 * （= 上游 `referenceDb` 的两侧输入）作为恒定目标，并叠加各 deck 当前的
 * ReplayGain；只有一侧或都没有画像时，才退到 replayGain 之后、trim 之前的
 * 实时 tap（上游 `referenceDb ?? loudnessDb()` 的退路）。
 */
function startBalanceCorrection(
  outGraph: StretchGraph,
  inGraph: StretchGraph,
  reference: { outgoingDb: number | null; incomingDb: number | null },
  seconds: number,
): void {
  const outgoing = outGraph.deckAnalyser
  const incoming = inGraph.deckAnalyser
  const trim = outGraph.trimGain
  if (!trim) return
  stopBalanceCorrection(outGraph, inGraph)

  const context = outGraph.context
  const endAt = context.currentTime + seconds + BALANCE_RAMP_SEC
  // 上游 `referenceDb`：整曲参考 + 该 deck 当前的 ReplayGain 线性值。
  const referenceDb = (level: number | null, graph: StretchGraph): number | null =>
    level === null
      ? null
      : level + 20 * Math.log10(Math.max(graph.replayGainNode?.gain.value ?? 1, 1e-6))
  let appliedTrimDb = 0
  let ticks = 0
  let interval: ReturnType<typeof setInterval> | null = null
  const stop = () => {
    if (interval !== null) clearInterval(interval)
    interval = null
    balanceStops.delete(outGraph)
    balanceStops.delete(inGraph)
  }
  interval = setInterval(() => {
    const now = context.currentTime
    if (now >= endAt) {
      stop()
      return
    }
    // 上游逐侧取 `referenceDb(...) ?? analyser.loudnessDb()`：有画像用整曲参考，
    // 缺画像的那一侧退到 replayGain 之后、trim 之前的实时 tap。
    outgoing?.tick(now)
    incoming?.tick(now)
    ticks += 1
    if (ticks * BALANCE_TICK_MS < BALANCE_INTERVAL_MS) return
    ticks = 0
    const outgoingDb = referenceDb(reference.outgoingDb, outGraph) ?? outgoing?.loudnessDb() ?? null
    const incomingDb = referenceDb(reference.incomingDb, inGraph) ?? incoming?.loudnessDb() ?? null
    if (outgoingDb === null || incomingDb === null) return
    const target = trimForBalance(outgoingDb, incomingDb)
    if (target < appliedTrimDb + BALANCE_STEP_DB) return
    appliedTrimDb = target
    const gain = trim.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(dbToGain(-appliedTrimDb), now + BALANCE_RAMP_SEC)
  }, BALANCE_TICK_MS)
  balanceStops.set(outGraph, stop)
  balanceStops.set(inGraph, stop)
}

/**
 * 把一副 deck 恢复到静止态：音色全平、fade/trim 归 1、回声发送归 0。
 * `restMute` 供池化元素复用前调用 —— 交接时被静音闸门压到 0 的元素
 * 若不在这里放行，下一首歌会一直无声。
 */
function settleAutomixGraph(graph: StretchGraph, restMute = false): void {
  stopBalanceCorrection(graph)
  const now = graph.context.currentTime
  if (graph.tone) {
    for (const filter of [graph.tone.low, graph.tone.mid, graph.tone.high]) {
      filter.gain.cancelScheduledValues(now)
      filter.gain.setValueAtTime(0, now)
    }
  }
  // 曲线停在终值上，池化元素复用时若不清回 1，下一首歌会一直静音。
  if (graph.transitionGain) {
    graph.transitionGain.gain.cancelScheduledValues(now)
    graph.transitionGain.gain.setValueAtTime(1, now)
  }
  if (graph.trimGain) {
    graph.trimGain.gain.cancelScheduledValues(now)
    graph.trimGain.gain.setValueAtTime(1, now)
  }
  const send = graph.throwSend?.gain
  if (send) {
    send.cancelScheduledValues(now)
    send.setValueAtTime(0, now)
  }
  if (restMute && graph.muteGain) {
    graph.muteGain.gain.cancelScheduledValues(now)
    graph.muteGain.gain.setValueAtTime(1, now)
  }
}

/** 过渡结束/中断时把一副 deck 的音色与回声恢复原状。 */
export function resetAutomixTone(howl: Howl | null): void {
  const graph = graphOf(howl)
  if (graph) settleAutomixGraph(graph)
}

/**
 * 分轨 deck 接入点：与元素共用 EQ / 效果 / 响度 / 音量，但位于元素静音闸门之后，
 * 因此交接时静音元素不会把分轨一起消掉。
 */
export function getStemInput(howl: Howl | null): GainNode | null {
  if (!howl) return null
  const audio = getAudioElement(howl)
  return audio ? (graphByAudio.get(audio)?.externalInput ?? null) : null
}

/**
 * 自动混音 deck 接管/交还元素时使用的静音闸门。返回 false 表示这条 Howl
 * 没有可用的音频图（例如不支持 CORS 的直连流），调用方应回退普通交叉淡化。
 */
export function setHowlGraphMuted(howl: Howl, muted: boolean, rampSec = 0.08): boolean {
  const audio = getAudioElement(howl)
  const graph = audio ? graphByAudio.get(audio) : null
  const gain = graph?.muteGain
  if (!graph || !gain) return false
  const now = graph.context.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(gain.gain.value, now)
  gain.gain.linearRampToValueAtTime(muted ? 0 : 1, now + Math.max(0.001, rampSec))
  return true
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
  if (graph) {
    stopBalanceCorrection(graph)
    activeGraphs.delete(graph)
    // 底噪与混响是独立声源：换歌后若继续以旧设置运行，会在静音的元素上继续出声。
    graph.effectChain?.apply(DEFAULT_AUDIO_EFFECT_SETTINGS, false)
  }
  if (graph?.analyser && getAudioTapAnalyser() === graph.analyser) {
    publishStretchAnalyser(null)
    publishLowFreqAnalyser(null)
    clearTrackLoudness()
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
      // Howler's HTML5 fade writes `el.volume` every animation step; jumping
      // the graph gain on each write produces zipper noise. A 5 ms ramp keeps
      // the same perceived curve without audible steps.
      gain.gain.setTargetAtTime(branch, gain.context.currentTime, 0.005)
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

function resumeContext(graph: StretchGraph): void {
  if (graph.context.state === 'running') return
  void graph.context.resume().catch((error) => {
    console.warn('Unable to resume time-stretch audio context', error)
  })
}

/**
 * 变速开关只决定元素走 worklet 还是直通；后面的处理前缀由
 * `rebuildPrefix` 决定，两者互不牵连。
 */
function setStretchEnabled(graph: StretchGraph, enabled: boolean, failed = false): void {
  if (failed) graph.failed = true
  // 占位禁用图（attach 失败的登记条目）没有真实节点，保持 no-op 即可
  if (!graph.source || !graph.sourceOut || !graph.node) return
  // 同步变速（±0.5% 以内）只改元素原生速率，音频始终直通、不进 SoundTouch worklet：
  // worklet 一旦 underrun 就是咔哒/顿挫，而这个幅度的重采样音高偏移小于约 9 音分。
  const elementOutput = graph.muteGain ?? graph.sourceOut
  graph.source.disconnect()
  graph.node.disconnect()
  graph.source.connect(elementOutput)
  graph.bypassed = true
  graph.tempoEnabled = enabled && !graph.failed
  if (graph.tempoEnabled) {
    resumeContext(graph)
  } else {
    graph.audio.playbackRate = 1
  }
}

/**
 * automix 专用的音色、回声与 deck 电平测量。默认不创建；房间开启自动混音
 * 或过渡真正需要时才接进来。全部节点静止时是透明的（0 dB / 发送 0）。
 */
function ensureAutomixProcessing(graph: StretchGraph): void {
  if (graph.automixWired) return
  const { context, trimGain, transitionGain, replayGainNode, volumeGain } = graph
  if (!trimGain || !transitionGain || !replayGainNode || !volumeGain) return

  const toneLow = context.createBiquadFilter()
  toneLow.type = 'lowshelf'
  toneLow.frequency.value = Math.min(TONE_EDGE_HZ[0], context.sampleRate * 0.475)
  const toneMid = context.createBiquadFilter()
  toneMid.type = 'peaking'
  toneMid.frequency.value = Math.min(TONE_MID_HZ, context.sampleRate * 0.475)
  toneMid.Q.value = MID_BELL_Q
  const toneHigh = context.createBiquadFilter()
  toneHigh.type = 'highshelf'
  toneHigh.frequency.value = Math.min(TONE_EDGE_HZ[1], context.sampleRate * 0.475)

  const throwSend = context.createGain()
  throwSend.gain.value = 0
  const throwDelay = context.createDelay(2)
  throwDelay.delayTime.value = THROW_DEFAULT_DELAY_SEC
  const throwFeedback = context.createGain()
  throwFeedback.gain.value = THROW_FEEDBACK

  trimGain.disconnect()
  trimGain.connect(toneLow)
  toneLow.connect(toneMid)
  toneMid.connect(toneHigh)
  toneHigh.connect(transitionGain)
  toneHigh.connect(throwSend)
  throwSend.connect(throwDelay)
  throwDelay.connect(throwFeedback)
  throwFeedback.connect(throwDelay)
  throwDelay.connect(volumeGain)

  graph.tone = { low: toneLow, mid: toneMid, high: toneHigh }
  graph.throwSend = throwSend
  graph.throwDelay = throwDelay
  graph.throwFeedback = throwFeedback
  graph.deckAnalyser = createDeckAnalyser(context, replayGainNode, volumeGain)
  graph.automixWired = true
}

/**
 * Attach SoundTouch's WSOLA AudioWorklet to Howler's HTML5 media element.
 * The returned controller is intentionally fail-closed: if the browser does
 * not support AudioWorklet or the processor underruns, native 1.0x playback
 * is restored instead of producing malformed audio.
 */
/** iOS Safari 不声明音频会话用途时，进后台会暂停 Web Audio（上游 usePlaybackAudioBridge 同款）。 */
function ensurePlaybackAudioSession(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = 'playback'
  } catch {
    // 不支持 audioSession 的浏览器忽略
  }
}

export async function attachTimeStretch(
  howl: Howl,
  options?: { tempoEnabled?: boolean; automixEnabled?: boolean },
): Promise<TimeStretchController | null> {
  if (typeof AudioContext === 'undefined') return null
  ensurePlaybackAudioSession()
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
    // failed 只表示 WSOLA 变速已回退直通；setStretchEnabled 已把 source 同时接到
    // analyser，因此频谱仍然有效，不能因为 failed 拒绝发布。若全局还残留
    // 另一首歌的 tap，也必须由当前图主动接管，而不是只在 null 时发布。
    if (existing.analyser && getAudioTapAnalyser() !== existing.analyser) {
      publishStretchAnalyser(existing.analyser)
      publishLowFreqAnalyser(existing.lowFreqAnalyser)
    }
    // ★ 复用分支必须重新装 volume 转发：releaseTimeStretch 在换歌时已把
    //   原生 volume 属性还给元素（uninstallVolumeRouting），若不接回，
    //   Howler 写 el.volume=0 会让进图信号物理静音 —— 静音丢节拍从这里复发。
    if (existing.volumeGain && !descriptorRestoreRef.has(audio)) {
      existing.volumeGain.gain.value = splitVolumeGain(audio.volume)
      installVolumeRouting(audio, existing.volumeGain)
      descriptorRestoreRef.set(audio, existing.volumeGain)
    }
    // 复用分支同样要回到 activeGraphs：releaseTimeStretch 在上一首 unload 时删掉了它，
    // 不补回来，本曲之后拖动 EQ / 分析完成发布 ReplayGain 都更新不到这张图。
    activeGraphs.add(existing)
    // 元素可能带着上一首过渡的残留状态回来（静音闸门 / fade 曲线 / 回声发送），
    // 先回到静止态再交给新曲。
    settleAutomixGraph(existing, true)
    existing.deckAnalyser?.reset()
    if (options?.automixEnabled) ensureAutomixProcessing(existing)
    setStretchEnabled(existing, options?.tempoEnabled !== false)
    applyAudioSettings(existing)
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
  activeGraphs.add(pendingGraph)
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
    } catch {
      analyser = null
    }
    // 背景鼓点：上游按线性振幅取前两个频段，需要不被 -30dB 上限钳住的读数。
    let lowFreqAnalyser: AnalyserNode | null = null
    try {
      lowFreqAnalyser = context.createAnalyser()
      lowFreqAnalyser.fftSize = 2048
      lowFreqAnalyser.smoothingTimeConstant = 0
      lowFreqAnalyser.maxDecibels = 0
    } catch {
      lowFreqAnalyser = null
    }

    // 默认链路：element →(变速开启时) worklet → mute → sourceOut → ReplayGain
    // → trim → transition → volume → destination。EQ、效果链、音色、回声、
    // deck 电平测量默认都不创建，真正需要时才由 applyAudioSettings /
    // ensureAutomixProcessing 接进来。
    const sourceOut = context.createGain()
    const externalInput = context.createGain()
    externalInput.connect(sourceOut)
    // 元素静音闸门放在汇合点之前：分轨接管时只静音元素，不静音 deck。
    const muteGain = context.createGain()
    muteGain.connect(sourceOut)
    stretchNode.connect(muteGain)

    const replayGainNode = context.createGain()
    replayGainNode.gain.value = getReplayGainLinear()
    const trimGain = context.createGain()
    const transitionGain = context.createGain()
    replayGainNode.connect(trimGain)
    trimGain.connect(transitionGain)
    transitionGain.connect(volumeGain)
    volumeGain.connect(context.destination)

    const graph: StretchGraph = {
      audio,
      source,
      node: stretchNode,
      context,
      bypassed: true,
      tempoEnabled: false,
      failed: false,
      initializing: false,
      cancelled: false,
      metricsSnapshots: 0,
      lastBlockCount: 0,
      lastUnderrunCount: 0,
      analyser,
      lowFreqAnalyser,
      deckAnalyser: null,
      equalizer: [],
      effectChain: null,
      chainInput: null,
      chainOutput: null,
      sourceOut,
      externalInput,
      automixWired: false,
      prefixWired: false,
      routedEq: false,
      routedEffects: false,
      replayGainNode,
      trimGain,
      muteGain,
      transitionGain,
      tone: null,
      throwSend: null,
      throwDelay: null,
      throwFeedback: null,
      volumeGain,
    }
    if (options?.automixEnabled) ensureAutomixProcessing(graph)
    applyAudioSettings(graph)
    setStretchEnabled(graph, options?.tempoEnabled !== false)
    if (analyser) publishStretchAnalyser(analyser)
    publishLowFreqAnalyser(lowFreqAnalyser)
    graphByAudio.set(audio, graph)
    activeGraphs.delete(pendingGraph)
    activeGraphs.add(graph)
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
        setStretchEnabled(graph, false, true)
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
      // 直通图没有均衡器/效果链，但响度补偿仍应生效（与成功图同一目标增益）。
      const fallbackReplayGain = context.createGain()
      fallbackReplayGain.gain.value = getReplayGainLinear()
      fallbackGain.connect(fallbackReplayGain)
      fallbackReplayGain.connect(context.destination)
      pendingGraph.replayGainNode = fallbackReplayGain
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
      let fallbackLowFreqAnalyser: AnalyserNode | null = null
      try {
        fallbackLowFreqAnalyser = context.createAnalyser()
        fallbackLowFreqAnalyser.fftSize = 2048
        fallbackLowFreqAnalyser.smoothingTimeConstant = 0
        fallbackLowFreqAnalyser.maxDecibels = 0
        source.connect(fallbackLowFreqAnalyser)
        publishLowFreqAnalyser(fallbackLowFreqAnalyser)
      } catch {
        fallbackLowFreqAnalyser = null
      }
      pendingGraph.source = source
      pendingGraph.analyser = fallbackAnalyser
      pendingGraph.lowFreqAnalyser = fallbackLowFreqAnalyser
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
      return graph.tempoEnabled
    },
    setEnabled: (enabled) => {
      setStretchEnabled(graph, enabled)
    },
    setTempo: (tempo) => {
      if (!graph.tempoEnabled) return
      resumeContext(graph)
      const clamped = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, tempo))
      // 值没变就不写：重复赋值可能触发 ratechange / 重置音频管线，造成可闻的小顿挫。
      if (graph.audio.preservesPitch) graph.audio.preservesPitch = false
      if (graph.audio.playbackRate !== clamped) graph.audio.playbackRate = clamped
    },
    reset: () => {
      if (graph.audio.playbackRate !== 1) graph.audio.playbackRate = 1
    },
  }
}
