/**
 * Mineradio 音频监控引擎 —— 忠实移植 `03-beat/06-sonic-audio-monitor.js`。
 *
 * ## 为什么需要这一层
 *
 * 上游的鼓点反馈不是"读个频谱画个波形"，而是一整套**音源自适应**的节拍引擎：
 *
 *   八频段加权 RMS → lowDrive / lowDominance
 *                 → 六个节拍窗口的 flux 打分 + 90 帧自适应阈值 → kick onset
 *                 → kick 包络（快攻 42/s、慢放 11.5/s）→ 驱动地形/相机/涟漪
 *                 → 自动跟踪（autotrack）挑出当前歌曲最"像鼓"的频段窗口
 *
 * 本项目此前只有一段朴素 RMS + 一个 `bass > 平滑基线*1.28` 的粗糙 onset，
 * 因此鼓点要么不触发、要么整段音乐一起起伏 —— 这正是用户报告
 * 「鼓点反馈不满意」的结构性原因。
 *
 * ## 单点驱动（关键）
 *
 * 上游在主循环里**每帧只算一次**，把结果 frame 分发给所有消费者。
 * 本项目此前让 6 个组件各自调用 `readAudioBands`，而那是**有状态全局**：
 * 每次调用都推进共享的峰值跟随器与节拍状态，导致衰减快 6 倍、
 * `lastBeatAt` 被反复覆写、谁先渲染谁"吃掉"节拍。
 *
 * 因此本模块也必须是**单例 + 单点驱动**：由舞台根每帧调用一次
 * `stepSonicAudioMonitor`，其余消费者读 `getSonicAudioFrame()`。
 *
 * ## 红线
 *
 * 本模块只**读取**数据；音频接线仍由 `AudioAnalyser` 负责，
 * 且必须是 `Howler.masterGain` 上的只读旁路（绝不 `createMediaElementSource`、
 * 绝不接回 destination）。
 */

// ---------------------------------------------------------------- 常量

/** 上游把 FFT 降到 512 base bins 再分析（`SONIC_AUDIO_BASE_BINS`）。 */
const BASE_BINS = 512

const DEFAULT_SAMPLE_RATE = 44100

/** 节拍窗口（上游 `SONIC_AUDIO_BEAT_WINDOWS`）—— 同时用于检测与自动跟踪。 */
export const SONIC_BEAT_WINDOWS = [
  { name: 'Deep', startHz: 36, endHz: 82, bias: 1.04 },
  { name: 'Club', startHz: 46, endHz: 118, bias: 1.22 },
  { name: 'Kick', startHz: 54, endHz: 142, bias: 1.16 },
  { name: 'Punch', startHz: 68, endHz: 156, bias: 1.02 },
  { name: 'Body', startHz: 86, endHz: 190, bias: 0.86 },
  { name: 'Wide', startHz: 38, endHz: 155, bias: 0.78 },
] as const

/**
 * 八频段 Hz 边界（与 `AudioAnalyser.SONIC_BAND_EDGES` 同源，
 * 这里独立声明以避免循环依赖；两处必须一致，有测试钉住）。
 */
export const MONITOR_BAND_EDGES = [
  ['subBass', 32, 58],
  ['bass', 58, 118],
  ['lowMid', 118, 260],
  ['mid', 260, 720],
  ['highMid', 720, 1800],
  ['presence', 1800, 4200],
  ['brilliance', 4200, 9000],
  ['air', 9000, 16000],
] as const

const BAND_KEYS = MONITOR_BAND_EDGES.map(([id]) => id)

// ---------------------------------------------------------------- 工具

function clamp(value: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

/** 与帧率无关的一阶混合系数（上游 `sonicAudioBlendForRate`）。 */
function blendForRate(rate: number, dt: number): number {
  return clamp(1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt || 0)), 0, 1)
}

/** 攻击/释放一阶跟随（上游 `sonicAudioFollowValue`）。 */
function followValue(previous: number, next: number, attackRate: number, releaseRate: number, dt: number): number {
  const prev = Number(previous) || 0
  const target = clamp01(next)
  const rate = target > prev ? attackRate : releaseRate
  return prev + (target - prev) * blendForRate(rate, dt || 1 / 60)
}

interface AnalysisMeta {
  len: number
  sampleRate: number
  fftSize: number
  nyquist: number
  binHz: number
}

function resolveMeta(data: Uint8Array, sampleRate: number, fftSize: number): AnalysisMeta {
  const len = Math.max(1, data && data.length ? data.length : BASE_BINS)
  let sr = Number(sampleRate) || DEFAULT_SAMPLE_RATE
  let fft = Number(fftSize) || len * 2
  if (!Number.isFinite(sr) || sr < 8000) sr = DEFAULT_SAMPLE_RATE
  if (!Number.isFinite(fft) || fft < len * 2) fft = len * 2
  return { len, sampleRate: sr, fftSize: fft, nyquist: sr / 2, binHz: sr / fft }
}

function hzToBin(meta: AnalysisMeta, hz: number, mode: 'floor' | 'ceil' | 'round'): number {
  const raw = (Number(hz) || 0) / Math.max(0.001, meta.binHz || 1)
  const bin = mode === 'ceil' ? Math.ceil(raw) : mode === 'floor' ? Math.floor(raw) : Math.round(raw)
  return Math.max(1, Math.min(Math.max(1, meta.len - 1), bin))
}

/**
 * 频段平均 —— 上游 `sonicAudioHzRangeAverage`。
 *
 * **注意它取的是平方的加权均值再开方（真正的 RMS）**，而不是普通均值。
 * 这一点很关键：弱信号段不会被强 bin 稀释，鼓点的"冲击感"才出得来。
 * `weighted` 为真时用三角权（中心权重更高），用于抓鼓的频段。
 */
function hzRangeAverage(
  data: Uint8Array,
  meta: AnalysisMeta,
  hzStart: number,
  hzEnd: number,
  weighted: boolean,
): number {
  if (!data || !data.length) return 0
  let start = hzToBin(meta, Math.min(hzStart, hzEnd), 'floor')
  let end = hzToBin(meta, Math.max(hzStart, hzEnd), 'ceil')
  if (end < start) {
    const tmp = start
    start = end
    end = tmp
  }
  const center = (start + end) / 2
  const half = Math.max(1, (end - start + 1) / 2)
  let sum = 0
  let total = 0
  for (let i = start; i <= end; i++) {
    let weight = 1
    if (weighted) {
      const distance = Math.abs(i - center)
      weight = 0.38 + 0.62 * (1 - Math.min(1, distance / half))
    }
    const v = (data[i] || 0) / 255
    sum += v * v * weight
    total += weight
  }
  return total > 0 ? Math.sqrt(sum / total) : 0
}

// ---------------------------------------------------------------- 频段

export interface SonicHzBands {
  subBass: number
  bass: number
  lowMid: number
  mid: number
  highMid: number
  presence: number
  brilliance: number
  air: number
  kickSub: number
  kickCore: number
  kickPunch: number
  kickWide: number
  body: number
  vocal: number
  snap: number
  lowDrive: number
  lowDominance: number
  energy: number
  bassBand: number
}
export function computeHzBands(data: Uint8Array, meta: AnalysisMeta): SonicHzBands {
  const values: Record<string, number> = {}
  let energySum = 0
  for (const [id, lo, hi] of MONITOR_BAND_EDGES) {
    const value = hzRangeAverage(data, meta, lo, hi, false)
    values[id] = value
    energySum += value
  }
  values.kickSub = hzRangeAverage(data, meta, 38, 78, true)
  values.kickCore = hzRangeAverage(data, meta, 52, 165, true)
  values.kickPunch = hzRangeAverage(data, meta, 72, 190, true)
  values.kickWide = hzRangeAverage(data, meta, 38, 220, true)
  values.body = hzRangeAverage(data, meta, 165, 420, true)
  values.vocal = hzRangeAverage(data, meta, 420, 2600, false)
  values.snap = hzRangeAverage(data, meta, 1800, 9200, false)
  values.lowDrive = clamp01(values.kickCore * 0.86 + values.kickSub * 0.42 + values.body * 0.1)
  values.lowDominance =
    values.lowDrive / Math.max(0.001, values.vocal * 0.72 + values.body * 0.34 + values.snap * 0.12)
  values.energy = clamp01((energySum / MONITOR_BAND_EDGES.length) * 0.82 + values.lowDrive * 0.18)
  // 58-118Hz 频段本身，与聚合的 lowDrive 区分开
  values.bassBand = values.bass
  return values as unknown as SonicHzBands
}

// ---------------------------------------------------------------- 节拍参数

interface BeatParams {
  thresholdStdDevGain: number
  thresholdFloor: number
  minTriggerFlux: number
}

/** 上游 `sonicAudioBeatParams`：strict/normal/sensitive 三段线性插值。 */
export function beatParams(sensitivity: number): BeatParams {
  const s = clamp(sensitivity, 0, 100)
  const lower = s <= 50 ? s / 50 : 1
  const upper = s > 50 ? (s - 50) / 50 : 0
  const strict = { thresholdStdDevGain: 2.6, thresholdFloor: 0.05, minTriggerFlux: 0.07 }
  const normal = { thresholdStdDevGain: 1.8, thresholdFloor: 0.028, minTriggerFlux: 0.045 }
  const sensitive = { thresholdStdDevGain: 1.1, thresholdFloor: 0.016, minTriggerFlux: 0.025 }
  const mid = {
    thresholdStdDevGain: strict.thresholdStdDevGain + (normal.thresholdStdDevGain - strict.thresholdStdDevGain) * lower,
    thresholdFloor: strict.thresholdFloor + (normal.thresholdFloor - strict.thresholdFloor) * lower,
    minTriggerFlux: strict.minTriggerFlux + (normal.minTriggerFlux - strict.minTriggerFlux) * lower,
  }
  return {
    thresholdStdDevGain: mid.thresholdStdDevGain + (sensitive.thresholdStdDevGain - mid.thresholdStdDevGain) * upper,
    thresholdFloor: mid.thresholdFloor + (sensitive.thresholdFloor - mid.thresholdFloor) * upper,
    minTriggerFlux: mid.minTriggerFlux + (sensitive.minTriggerFlux - mid.minTriggerFlux) * upper,
  }
}

// ---------------------------------------------------------------- 状态

const FLUX_HISTORY_SIZE = 90

interface BeatState {
  activeWindowIndex: number
  windowScores: number[]
  previousWindowLevels: number[]
  fluxHistory: number[]
  fluxHistoryIndex: number
  smoothedFlux: number
  previousSmoothedFlux: number
  cooldownRemaining: number
}

interface KickState {
  noiseFloor: number
  kickLevel: number
  kickOnset: number
  kickEnvelope: number
}

interface TriggerState {
  smoothedFlux: number
  previousSmoothedFlux: number
  history: number[]
  historyIndex: number
  beatHold: number
  cooldownRemaining: number
  lastEnergy: number
  lastThreshold: number
  pulse: number
}

interface AutoTrackState {
  frames: Array<{
    time: number
    levels: number[]
    lowDominance: number
    body: number
    vocal: number
    snap: number
  }>
  lastAt: number
  start: number
  end: number
  windowIndex: number | null
  hzStart: number
  hzEnd: number
  sensitivity: number
}

function createBeatState(): BeatState {
  return {
    activeWindowIndex: 1,
    windowScores: new Array(SONIC_BEAT_WINDOWS.length).fill(0),
    previousWindowLevels: new Array(SONIC_BEAT_WINDOWS.length).fill(0),
    fluxHistory: new Array(FLUX_HISTORY_SIZE).fill(0),
    fluxHistoryIndex: 0,
    smoothedFlux: 0,
    previousSmoothedFlux: 0,
    cooldownRemaining: 0,
  }
}

function fluxStats(history: number[]): { avg: number; stdDev: number } {
  let sum = 0
  for (let i = 0; i < history.length; i++) sum += history[i] || 0
  const avg = sum / Math.max(1, history.length)
  let variance = 0
  for (let i = 0; i < history.length; i++) variance += Math.pow((history[i] || 0) - avg, 2)
  variance /= Math.max(1, history.length)
  return { avg, stdDev: Math.sqrt(variance) }
}

// ---------------------------------------------------------------- 输出 frame

/** 引擎输出的完整音频帧 —— 字段名与上游 `sonicAudioFrame` 一致。 */
export interface SonicAudioFrame {
  // 八频段（已平滑）
  subBass: number
  /**
   * 聚合低频（上游 frame 的 `bass`，即平滑后的 `lowDrive`）。
   *
   * 注意与 `bassBand` 区分：`bass` 是"低频驱动量"（kickCore*0.86 + kickSub*0.42 + body*0.10），
   * 供粒子整体的低频呼吸使用；`bassBand` 才是 58-118Hz 那个具体频段。
   */
  bass: number
  /** 58-118Hz 频段本身（八频段表里的 `bass`）。 */
  bassBand: number
  lowMid: number
  mid: number
  highMid: number
  presence: number
  brilliance: number
  air: number
  // 鼓相关细频段（已平滑）
  kickSub: number
  kickCore: number
  kickPunch: number
  kickWide: number
  body: number
  vocal: number
  snap: number
  lowDrive: number
  lowDominance: number
  // 聚合
  treble: number
  energy: number
  beat: number
  warmth: number
  brightness: number
  sharpness: number
  smoothness: number
  density: number
  // 节拍检测
  kickLevel: number
  kickFlux: number
  kickThreshold: number
  kickOnset: number
  kickEnvelope: number
  kickConfidence: number
  kickLowDominance: number
  kickWindowName: string
  kickHzStart: number
  kickHzEnd: number
  // 选频段触发器
  triggerBandStart: number
  triggerBandEnd: number
  triggerHzStart: number
  triggerHzEnd: number
  triggerEnergy: number
  triggerThreshold: number
  triggerPulse: number
  triggerOnset: number
}

function emptyFrame(): SonicAudioFrame {
  return {
    subBass: 0,
    bass: 0,
    bassBand: 0,
    lowMid: 0,
    mid: 0,
    highMid: 0,
    presence: 0,
    brilliance: 0,
    air: 0,
    kickSub: 0,
    kickCore: 0,
    kickPunch: 0,
    kickWide: 0,
    body: 0,
    vocal: 0,
    snap: 0,
    lowDrive: 0,
    lowDominance: 0,
    treble: 0,
    energy: 0,
    beat: 0,
    warmth: 0,
    brightness: 0,
    sharpness: 0,
    smoothness: 0,
    density: 0,
    kickLevel: 0,
    kickFlux: 0,
    kickThreshold: 0,
    kickOnset: 0,
    kickEnvelope: 0,
    kickConfidence: 0,
    kickLowDominance: 0,
    kickWindowName: '',
    kickHzStart: 0,
    kickHzEnd: 0,
    triggerBandStart: 0,
    triggerBandEnd: 0,
    triggerHzStart: 0,
    triggerHzEnd: 0,
    triggerEnergy: 0,
    triggerThreshold: 0,
    triggerPulse: 0,
    triggerOnset: 0,
  }
}

// ---------------------------------------------------------------- 引擎状态（单例）

/** 需要被 decay 的字段（上游 `sonicAudioDecayFrame` 的键表）。 */
const DECAY_KEYS: Array<keyof SonicAudioFrame> = [
  'subBass',
  'bass',
  'lowMid',
  'mid',
  'highMid',
  'presence',
  'brilliance',
  'air',
  'body',
  'vocal',
  'snap',
  'lowDrive',
  'treble',
  'energy',
  'kickEnvelope',
  'kickLevel',
  'kickFlux',
  'kickOnset',
  'kickConfidence',
  'kickLowDominance',
  'triggerEnergy',
  'triggerPulse',
  'beat',
]

interface MonitorSettings {
  enabled: boolean
  autoTrack: boolean
  bandStart: number
  bandEnd: number
  sensitivity: number
  threshold: number
  pulseStrength: number
}

const DEFAULT_SETTINGS: MonitorSettings = {
  enabled: true,
  autoTrack: true,
  bandStart: 1,
  bandEnd: 4,
  sensitivity: 100,
  threshold: 32,
  pulseStrength: 62,
}

const state = {
  raw: new Uint8Array(BASE_BINS),
  prev: new Float32Array(BASE_BINS),
  smooth: {} as Record<string, number>,
  beat: createBeatState(),
  kick: { noiseFloor: 0, kickLevel: 0, kickOnset: 0, kickEnvelope: 0 } as KickState,
  trigger: {
    smoothedFlux: 0,
    previousSmoothedFlux: 0,
    history: new Array(40).fill(0),
    historyIndex: 0,
    beatHold: 0,
    cooldownRemaining: 0,
    lastEnergy: 0,
    lastThreshold: 0,
    pulse: 0,
  } as TriggerState,
  autoTrack: {
    frames: [],
    lastAt: 0,
    start: 1,
    end: 2,
    windowIndex: 1 as number | null,
    hzStart: 52,
    hzEnd: 165,
    sensitivity: 0.85,
  } as AutoTrackState,
  meta: null as AnalysisMeta | null,
  frame: null as SonicAudioFrame | null,
  lastAudioTime: 0,
}

/**
 * 重置与当前音频内容绑定的瞬态检测器，保持上游
 * `sonicAudioResetTransientState`（`06-sonic-audio-monitor.js:221-247`）的完整范围：
 * beat / kick / trigger / autoTrack **四者一起**重置。
 *
 * ★ 只重置 `beat` 是不够的（真实缺陷）：`trigger` 的 `history` 是 40 格
 *   自适应阈值窗口、`autoTrack` 记录"当前歌最像鼓的频段"。切歌时留着它们，
 *   上一首高能歌曲的历史会让新歌的 onset 在约 90 个分析帧内持续偏钝 ——
 *   表现为「随机切歌时节拍忽强忽弱」。
 */
function resetTransientState(meta: AnalysisMeta | null): void {
  state.beat = createBeatState()
  state.kick = { noiseFloor: 0, kickLevel: 0, kickOnset: 0, kickEnvelope: 0 }
  state.trigger = {
    smoothedFlux: 0,
    previousSmoothedFlux: 0,
    history: new Array(40).fill(0),
    historyIndex: 0,
    beatHold: 0,
    cooldownRemaining: 0,
    lastEnergy: 0,
    lastThreshold: 0,
    pulse: 0,
  }
  state.autoTrack = {
    frames: [],
    lastAt: 0,
    // 上游无 meta 时兜底 `start: 1 / end: 3`（`06-sonic-audio-monitor.js:244-245`）；
    // 有 meta 时按 46/118 Hz 换算，取整模式用 round（`sonicAudioHzToBase`）。
    start: meta ? hzToBin(meta, 46, 'round') : 1,
    end: meta ? hzToBin(meta, 118, 'round') : 3,
    windowIndex: 1,
    hzStart: 46,
    hzEnd: 118,
    sensitivity: 0.85,
  }
}

function ensureBuffers(len: number): void {
  if (state.raw.length !== len) {
    state.raw = new Uint8Array(len)
    state.prev = new Float32Array(len)
  }
}

// ---------------------------------------------------------------- kick 包络

/**
 * 踢鼓包络（上游 `sonicAudioStepKickEnvelope`）。
 *
 * 快攻 42/s、慢放 11.5/s —— 于是鼓点在视觉上是"一次干脆的抬升"，
 * 而不是持续鼓起。`breathTarget` 提供一层很轻的底噪呼吸。
 */
export function stepKickEnvelope(rawKickLevel: number, onset: boolean, dt: number): KickState {
  const k = state.kick
  const safeRaw = clamp01(rawKickLevel)
  const floorRate = safeRaw > k.noiseFloor ? 1.15 : 0.35
  const noiseFloor = k.noiseFloor + (safeRaw - k.noiseFloor) * blendForRate(floorRate, dt)
  const kickLevel = clamp01(safeRaw - noiseFloor - 0.025)
  const breathTarget = Math.min(0.11, kickLevel * 0.18)
  const onsetTarget = onset ? Math.max(0.48, kickLevel * 0.95) : 0
  const targetEnvelope = Math.max(breathTarget, onsetTarget)
  const envelopeRate = targetEnvelope > k.kickEnvelope ? 42 : 11.5
  const kickEnvelope = Math.max(
    breathTarget,
    k.kickEnvelope + (targetEnvelope - k.kickEnvelope) * blendForRate(envelopeRate, dt),
  )
  state.kick = { noiseFloor, kickLevel, kickOnset: onset ? 1 : 0, kickEnvelope: clamp01(kickEnvelope) }
  return state.kick
}

// ---------------------------------------------------------------- 节拍检测

interface BeatData {
  kickLevel: number
  kickFlux: number
  kickThreshold: number
  kickOnset: number
  kickEnvelope: number
  kickConfidence: number
  kickLowDominance: number
  kickWindowName: string
  kickHzStart: number
  kickHzEnd: number
}

/** 上游 `sonicAudioStepBeatDetector`。 */
function stepBeatDetector(
  data: Uint8Array,
  dt: number,
  settings: MonitorSettings,
  meta: AnalysisMeta,
  bands: SonicHzBands,
): BeatData {
  const s = state.beat
  const params = beatParams(settings.sensitivity)
  const windowLevels = SONIC_BEAT_WINDOWS.map((win) =>
    hzRangeAverage(data, meta, win.startHz, win.endHz, true),
  )
  const nextScores = s.windowScores.map((score, index) => {
    const fluxValue = Math.max(0, windowLevels[index] - (s.previousWindowLevels[index] || 0))
    const win = SONIC_BEAT_WINDOWS[index]
    const dominanceBoost = clamp(bands.lowDominance || 0, 0.65, 2.25) / 2.25
    return score * 0.945 + fluxValue * (win.bias || 1) * (0.7 + dominanceBoost * 0.7)
  })
  let activeWindowIndex =
    settings.autoTrack && state.autoTrack.windowIndex != null
      ? state.autoTrack.windowIndex
      : s.activeWindowIndex || 0
  for (let i = 0; i < nextScores.length; i++) {
    if (nextScores[i] > nextScores[activeWindowIndex] * 1.1) activeWindowIndex = i
  }
  const rawFlux = Math.max(0, windowLevels[activeWindowIndex] - (s.previousWindowLevels[activeWindowIndex] || 0))
  const smoothedFlux = s.smoothedFlux + (rawFlux - s.smoothedFlux) * 0.46
  const stats = fluxStats(s.fluxHistory)
  const threshold = Math.max(params.thresholdFloor, stats.avg + stats.stdDev * params.thresholdStdDevGain)
  const cooldownRemaining = Math.max(0, s.cooldownRemaining - Math.max(0, dt || 0))
  const lowDominance = bands.lowDominance || 0
  const lowGate = bands.lowDrive || windowLevels[activeWindowIndex] || 0
  const vocalMask = bands.vocal * 0.62 + bands.snap * 0.16
  const drumGate = lowGate > 0.045 && (lowDominance > 0.78 || lowGate > vocalMask * 1.04 || bands.kickSub > 0.085)
  const instantRise = rawFlux > threshold && rawFlux >= params.minTriggerFlux
  const peakConfirm =
    s.previousSmoothedFlux > threshold &&
    s.previousSmoothedFlux >= smoothedFlux &&
    s.previousSmoothedFlux >= params.minTriggerFlux * 0.86
  const onset = cooldownRemaining <= 0 && drumGate && (instantRise || peakConfirm)
  const displayedFlux = instantRise ? rawFlux : onset ? Math.max(s.previousSmoothedFlux, smoothedFlux) : smoothedFlux
  const nextHistory = s.fluxHistory.slice()
  nextHistory[s.fluxHistoryIndex] = smoothedFlux
  const nextHistoryIndex = (s.fluxHistoryIndex + 1) % nextHistory.length
  const kickLevel = Math.max(windowLevels[activeWindowIndex], bands.lowDrive || 0)
  const kick = stepKickEnvelope(kickLevel, onset, dt || 1 / 60)
  s.activeWindowIndex = activeWindowIndex
  s.windowScores = nextScores
  s.previousWindowLevels = windowLevels
  s.fluxHistory = nextHistory
  s.fluxHistoryIndex = nextHistoryIndex
  s.smoothedFlux = smoothedFlux
  s.previousSmoothedFlux = smoothedFlux
  s.cooldownRemaining = onset ? 0.12 : cooldownRemaining
  const activeWindow = SONIC_BEAT_WINDOWS[activeWindowIndex]
  return {
    kickLevel: kick.kickLevel,
    kickFlux: displayedFlux,
    kickThreshold: threshold,
    kickOnset: onset ? 1 : 0,
    kickEnvelope: kick.kickEnvelope,
    kickConfidence: clamp(displayedFlux / Math.max(0.001, threshold * 1.85), 0, 1),
    kickLowDominance: clamp(lowDominance / 1.8, 0, 1),
    kickWindowName: activeWindow.name,
    kickHzStart: activeWindow.startHz,
    kickHzEnd: activeWindow.endHz,
  }
}

// ---------------------------------------------------------------- 自动跟踪

/** 上游 `sonicAudioTrackAutoPulse`：挑出当前歌曲最"像鼓"的频段窗口。 */
function trackAutoPulse(data: Uint8Array, now: number, meta: AnalysisMeta, bands: SonicHzBands): void {
  const tracker = state.autoTrack
  const levels = SONIC_BEAT_WINDOWS.map((win) => hzRangeAverage(data, meta, win.startHz, win.endHz, true))
  tracker.frames.push({
    time: now,
    levels,
    lowDominance: bands.lowDominance || 0,
    body: bands.body || 0,
    vocal: bands.vocal || 0,
    snap: bands.snap || 0,
  })
  while (tracker.frames.length && now - tracker.frames[0].time > 1450) tracker.frames.shift()
  if (now - tracker.lastAt <= 360 || tracker.frames.length < 8) return
  tracker.lastAt = now
  const scores = SONIC_BEAT_WINDOWS.map((_, index) => ({ index, avg: 0, max: 0, score: 0 }))
  for (let f = 1; f < tracker.frames.length; f++) {
    const cur = tracker.frames[f]
    const prev = tracker.frames[f - 1]
    const highMask = cur.vocal * 0.58 + cur.snap * 0.22 + cur.body * 0.18
    const dominance = clamp(cur.lowDominance, 0.65, 2.2) / 2.2
    for (let k = 0; k < scores.length; k++) {
      const diff = Math.max(0, cur.levels[k] - prev.levels[k])
      const win = SONIC_BEAT_WINDOWS[k]
      const width = Math.max(1, win.endHz - win.startHz)
      const widthPenalty = clamp(Math.sqrt(82 / width), 0.68, 1.16)
      const bodyPenalty = win.endHz > 160 ? 1 / (1 + cur.body * 0.42 + highMask * 0.22) : 1
      const weighted =
        (diff * (win.bias || 1) * widthPenalty * bodyPenalty * (0.72 + dominance * 0.6)) / (1 + highMask * 0.78)
      scores[k].avg += weighted
      scores[k].max = Math.max(scores[k].max, weighted)
    }
  }
  for (const item of scores) {
    item.avg /= Math.max(1, tracker.frames.length - 1)
    item.score = item.max * 0.7 + item.avg * 0.3
  }
  scores.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.003) return b.score - a.score
    const aw = SONIC_BEAT_WINDOWS[a.index]
    const bw = SONIC_BEAT_WINDOWS[b.index]
    return aw.endHz - bw.endHz || aw.endHz - aw.startHz - (bw.endHz - bw.startHz)
  })
  if (!scores.length || scores[0].score < 0.01) return
  const best = SONIC_BEAT_WINDOWS[scores[0].index]
  tracker.windowIndex = scores[0].index
  tracker.hzStart = best.startHz
  tracker.hzEnd = best.endHz
  tracker.start = Math.round(clamp(hzToBin(meta, best.startHz, 'round'), 0, BASE_BINS - 2))
  tracker.end = Math.round(clamp(hzToBin(meta, best.endHz, 'round'), tracker.start + 1, BASE_BINS))
  tracker.sensitivity = clamp(0.72 + Math.min(0.24, scores[0].score * 2.8), 0.72, 0.96)
}

// ---------------------------------------------------------------- 触发器

interface TriggerData {
  triggerBandStart: number
  triggerBandEnd: number
  triggerHzStart: number
  triggerHzEnd: number
  triggerEnergy: number
  triggerThreshold: number
  triggerPulse: number
  triggerOnset: number
}

/** 上游 `sonicAudioEvaluateSelectedTrigger`。 */
function evaluateSelectedTrigger(
  data: Uint8Array,
  settings: MonitorSettings,
  dt: number,
  meta: AnalysisMeta,
  beatData: BeatData,
): TriggerData {
  const trigger = state.trigger
  let start = settings.autoTrack ? state.autoTrack.start : settings.bandStart
  let end = settings.autoTrack ? state.autoTrack.end : settings.bandEnd
  start = Math.round(clamp(start, 0, BASE_BINS - 2))
  end = Math.round(clamp(end, start + 1, BASE_BINS))
  const hzStart = settings.autoTrack
    ? state.autoTrack.hzStart
    : (clamp(start, 0, BASE_BINS) / BASE_BINS) * meta.nyquist
  const hzEnd = settings.autoTrack ? state.autoTrack.hzEnd : (clamp(end, 0, BASE_BINS) / BASE_BINS) * meta.nyquist
  const energy = settings.autoTrack && beatData ? beatData.kickLevel : hzRangeAverage(data, meta, hzStart, hzEnd, false)
  const startBin = hzToBin(meta, hzStart, 'floor')
  const endBin = hzToBin(meta, hzEnd, 'ceil')
  let flux = 0
  let count = 0
  for (let i = Math.min(startBin, endBin); i <= Math.max(startBin, endBin); i++) {
    const val = (data[i] || 0) / 255
    const diff = val - (state.prev[i] || 0)
    if (diff > 0.01) flux += diff
    count++
  }
  flux /= Math.max(1, count)
  let triggered = false
  let strength = 0
  if (settings.autoTrack) {
    flux = Math.max(flux, beatData ? beatData.kickFlux * 0.72 : 0)
    trigger.smoothedFlux += (flux - trigger.smoothedFlux) * 0.48
    trigger.history[trigger.historyIndex] = trigger.smoothedFlux
    trigger.historyIndex = (trigger.historyIndex + 1) % trigger.history.length
    const stats = fluxStats(trigger.history)
    const thresholdMultiplier = Math.max(0.1, 5.0 - state.autoTrack.sensitivity * 4.0)
    const adaptiveThreshold = Math.max(0.01, stats.avg + stats.stdDev * thresholdMultiplier)
    const isPeak =
      (beatData && beatData.kickOnset > 0) ||
      (flux > adaptiveThreshold && flux > trigger.previousSmoothedFlux * 1.04)
    if (trigger.beatHold > 0) trigger.beatHold--
    else if (isPeak) {
      triggered = true
      trigger.beatHold = Math.max(3, Math.round(8 + (1 - settings.pulseStrength / 100) * 10))
      strength = clamp01(
        Math.max(flux * 24, (beatData ? beatData.kickConfidence : 0) * 0.68 + energy * 0.32) *
          (settings.pulseStrength / 100),
      )
    }
    trigger.lastEnergy = Math.max(energy, trigger.smoothedFlux * 8)
    trigger.lastThreshold = adaptiveThreshold * 8
    trigger.previousSmoothedFlux = trigger.smoothedFlux
  } else {
    trigger.cooldownRemaining = Math.max(0, trigger.cooldownRemaining - Math.max(0, dt || 0))
    const threshold = settings.threshold / 100
    if (trigger.cooldownRemaining <= 0 && energy > threshold) {
      triggered = true
      trigger.cooldownRemaining = 0.18
      strength = clamp01((energy - threshold) / Math.max(0.05, 1 - threshold) + settings.pulseStrength / 220)
    }
    trigger.lastEnergy = energy
    trigger.lastThreshold = threshold
  }
  trigger.pulse = Math.max(
    trigger.pulse * Math.pow(0.1, Math.max(0.001, dt || 1 / 60)),
    triggered ? strength : 0,
  )
  return {
    triggerBandStart: start,
    triggerBandEnd: end,
    triggerHzStart: hzStart,
    triggerHzEnd: hzEnd,
    triggerEnergy: trigger.lastEnergy,
    triggerThreshold: trigger.lastThreshold,
    triggerPulse: trigger.pulse,
    triggerOnset: triggered ? 1 : 0,
  }
}

// ---------------------------------------------------------------- 主入口

export interface StepOptions {
  /** 渲染帧时长（秒） */
  dt: number
  sampleRate: number
  fftSize: number
  /** 播放位置（秒），用于检测 seek/回绕并重置瞬态 */
  currentTime?: number
  /** 是否在播放；false 走 decay 路径 */
  playing?: boolean
  /** 上游的全局 beat 值（可选，会并入 kickEnvelope） */
  beat?: number
  /** 设置覆盖（默认取 DEFAULT_SETTINGS） */
  settings?: Partial<MonitorSettings>
}

function resolveSettings(override?: Partial<MonitorSettings>): MonitorSettings {
  if (!override) return DEFAULT_SETTINGS
  return { ...DEFAULT_SETTINGS, ...override }
}

/**
 * 推进一帧音频分析。
 *
 * **必须由舞台根每帧只调用一次**，结果缓存后供所有消费者读取
 * （见本文件顶部「单点驱动」）。
 */
export function stepSonicAudioMonitor(data: Uint8Array | null, opts: StepOptions): SonicAudioFrame | null {
  const settings = resolveSettings(opts.settings)
  const playing = opts.playing !== false && !!data && data.length > 0 && settings.enabled
  if (!playing) return decayFrame(opts.dt)
  if (!data) return decayFrame(opts.dt)

  const meta = resolveMeta(data, opts.sampleRate, opts.fftSize)
  state.meta = meta
  ensureBuffers(data.length)

  const currentTime = Number(opts.currentTime)
  if (Number.isFinite(currentTime)) {
    // 检测回绕/seek：时间倒退超过 0.3s 就完整重置瞬态，避免沿用上一首歌
    // 的 trigger / autoTrack 阈值。此前只重置 beat，漏掉了上游同函数覆盖的
    // kick、trigger 与 autoTrack，随机切歌时会出现节拍忽强忽弱。
    if (state.lastAudioTime > 0 && currentTime + 0.3 < state.lastAudioTime) {
      resetTransientState(meta)
      state.prev.fill(0)
      state.smooth = {}
    }
    state.lastAudioTime = currentTime
  }

  state.raw.set(data)

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const values = computeHzBands(data, meta)
  if (settings.autoTrack) trackAutoPulse(data, now, meta, values)

  const lowSum = values.subBass + values.bass + values.lowMid + values.mid * 0.42
  const midSum = values.mid * 0.58 + values.highMid + values.presence * 0.26
  const highSum = values.presence * 0.74 + values.brilliance + values.air
  const totalTone = Math.max(0.001, lowSum + midSum + highSum)
  const legacyMid = clamp01(values.mid * 0.58 + values.highMid * 0.42)
  const legacyTreble = clamp01(values.presence * 0.42 + values.brilliance * 0.38 + values.air * 0.2)
  const energy = values.energy
  const warmth = lowSum / totalTone
  const brightness = highSum / totalTone

  // 逐频段一阶平滑（攻击 34 / 释放 10）
  const smooth = state.smooth
  for (const key of Object.keys(values) as Array<keyof SonicHzBands>) {
    smooth[key] = followValue(smooth[key], values[key], 34, 10, opts.dt || 1 / 60)
  }
  smooth.bass = smooth.bass || 0
  smooth.treble = followValue(smooth.treble, legacyTreble, 30, 9, opts.dt || 1 / 60)
  smooth.energy = followValue(smooth.energy, energy, 28, 8, opts.dt || 1 / 60)

  const beatData = stepBeatDetector(data, opts.dt || 1 / 60, settings, meta, values)
  const triggerData = evaluateSelectedTrigger(data, settings, opts.dt || 1 / 60, meta, beatData)

  // prev 在 flux 之后更新，使 flux 差分为"相邻帧"语义
  state.prev.set(data)

  const kickEnvelope = clamp01(Math.max(beatData.kickEnvelope, triggerData.triggerPulse, Number(opts.beat) || 0))

  const frame = emptyFrame()
  // 先铺平滑后的全部频段
  for (const key of Object.keys(values) as Array<keyof SonicHzBands>) {
    ;(frame as unknown as Record<string, number>)[key] = smooth[key] ?? values[key]
  }
  frame.bass = smooth.bass || values.bass
  // bassBand 刻意保留**未**被 lowDrive 覆盖的 58-118Hz 频段本身
  frame.bassBand = smooth.bassBand ?? values.bass
  frame.mid = smooth.mid || values.mid
  frame.treble = smooth.treble || legacyTreble
  frame.energy = smooth.energy || energy
  frame.warmth = warmth
  frame.brightness = brightness
  frame.sharpness = clamp01(brightness * 0.42 + values.snap * 0.14 + beatData.kickOnset * 0.28)
  frame.smoothness = clamp01(1 - legacyTreble * 0.32 + legacyMid * 0.12)
  frame.density = clamp01(0.4 + legacyTreble * 0.24 + values.vocal * 0.12 + kickEnvelope * 0.16)
  Object.assign(frame, beatData, triggerData)
  frame.beat = kickEnvelope
  frame.kickEnvelope = kickEnvelope

  state.frame = frame
  return frame
}

/** 未播放时的衰减路径（上游 `sonicAudioDecayFrame`，每秒 ×0.08）。 */
function decayFrame(dt: number): SonicAudioFrame | null {
  const frame = state.frame
  if (!frame) return null
  const decay = Math.pow(0.08, Math.max(0.001, dt || 1 / 60))
  for (const key of DECAY_KEYS) {
    ;(frame as unknown as Record<string, number>)[key] = clamp01((Number(frame[key]) || 0) * decay)
  }
  state.trigger.pulse = frame.triggerPulse || 0
  return frame
}

/** 读取最近一次分析结果（消费者用这个，而不是自己再算）。 */
export function getSonicAudioFrame(): SonicAudioFrame | null {
  return state.frame
}

/** 重置引擎（真实音频源切换或测试隔离时调用）。 */
export function resetSonicAudioMonitor(): void {
  state.prev.fill(0)
  state.smooth = {}
  resetTransientState(state.meta)
  state.frame = null
  state.lastAudioTime = 0
}

export { BAND_KEYS }
