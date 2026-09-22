/**
 * 拍点相机事件调度器 —— Mineradio `01-scene/02-beat-camera-runtime.js` 的忠实移植。
 *
 * ============================ 为什么独立成模块 ============================
 *
 * 上游的节拍运镜**不是**"命中即踢一脚"，而是三层：
 *
 *   ① 实时节拍引擎 `processRealtimeBeatEngine`（`:392-606`）
 *      多频段跟随（fast/slow 双时间常数）+ flux/rise + 自适应阈值 +
 *      **tempo lock**（从连续命中间隔推 BPM）+ 四种 combo
 *   ② 事件调度 `scheduleBeatCamera`（`:639-887`）
 *      把每次命中排成带 `attack / hold / release` 包络的事件，
 *      逐事件算 `zoomAmp / thetaAmp / phiAmp / rollAmp`
 *   ③ 包络求值 `updateBeatCamera`（`:920-1015`）
 *      逐帧对所有"在飞"事件求包络，取**最强**者为 lead，
 *      再按 combo 把它分配成 radiusKick / phiKick / rollKick
 *
 * 本项目此前是"4 个常数 + 指数衰减"（`CameraRig` 里 `kick.phi = max(kick.phi,
 * 0.0048)` 等），于是**每一拍看起来都一样** —— 抒情歌与炸歌完全相同，
 * 没有 downbeat/drop/accent 的形态差异，也没有整曲动态。
 *
 * ============================ 移植范围（本轮）============================
 *
 * · **只做实时路径**（上游 `source = 'live'`）。上游的"提前一点推镜"来自
 *   **离线 BPM/beat-grid 分析**（`04-beat-map-runtime.js`），无拍点图时
 *   实时路径本来就会接管（`11-main-loop.js:441` 的 `liveFallbackOk`）。
 *   离线分析含 Web Worker / 缓存 / 预取，需单独一轮（HANDOFF §5.1）。
 * · **跳过 DJ 分支**。`djMode.active` 出厂恒为 `false`
 *   （`00-state/03-beat-dj-state.js:87`），且只对直播/DJ 音源可能为真 ——
 *   本项目无直播音源，该分支永不执行。跳过的是"振幅/包络/combo 系数的
 *   另一套取值"，**不影响**非 DJ 路径的任何数值。
 * · **不做 `lookahead` / `nextIdx`**：那是拍点图的光标推进，实时路径不需要。
 *
 * 与音频链的关系：本模块**只读** `readAudioBands()` 的缓存（红线 33 单点驱动
 * 不变），不碰分析管线、不新增 AnalyserNode（红线 2）。
 */

import { getAudioTapRevision } from '@/lib/audioTap'
import { getSonicAudioFrame } from '../shared/SonicAudioMonitor'

// ---------------------------------------------------------------- 常量（上游 03-beat-dj-state.js:35-56）

/** 实时命中的最小间隔 —— 上游 `beatCam.realtimeMinInterval`。 */
const REALTIME_MIN_INTERVAL = 0.46
/** 实时命中与已有事件的合并窗口 —— 上游 `beatCam.realtimeMergeWindow`。 */
const REALTIME_MERGE_WINDOW = 0.135
/** 包络默认值（上游 `beatCam.attack/hold/release`）。 */
const DEFAULT_ATTACK = 0.028
const DEFAULT_HOLD = 0.03
const DEFAULT_RELEASE = 0.185
/** 同屏最多保留的事件数（上游 `maxEvents = djMode.active ? 12 : 8`）。 */
const MAX_EVENTS = 8

/** combo 类型。 */
export type BeatCombo = 'downbeat' | 'push' | 'drop' | 'rebound' | 'accent'
/** 频段倾向。 */
export type BeatMode = 'deep' | 'body' | 'snap'

interface BeatEvent {
  start: number
  hit: number
  amp: number
  attack: number
  hold: number
  release: number
  zoomAmp: number
  thetaAmp: number
  phiAmp: number
  rollAmp: number
  mode: BeatMode
  combo: BeatCombo
  phase: number
  low: number
  body: number
  snap: number
  mass: number
  source: string
}

/** 相机可消费的每帧输出。 */
export interface BeatCameraFrame {
  punch: number
  thetaKick: number
  phiKick: number
  radiusKick: number
  rollKick: number
}

// ---------------------------------------------------------------- 状态

interface BeatCamState {
  events: BeatEvent[]
  punch: number
  lastTriggerAt: number
  lastRealtimeAt: number
  thetaKick: number
  phiKick: number
  radiusKick: number
  rollKick: number
  prevAudioTime: number
}

interface RealtimeState {
  subFast: number
  subSlow: number
  lowFast: number
  lowSlow: number
  bodyFast: number
  bodySlow: number
  vocalFast: number
  vocalSlow: number
  snapFast: number
  snapSlow: number
  prevSub: number
  prevLow: number
  prevBody: number
  prevVocal: number
  prevSnap: number
  prevRms: number
  onsetAvg: number
  onsetPeak: number
  subPeak: number
  lowPeak: number
  bodyPeak: number
  vocalPeak: number
  snapPeak: number
  lastHitAt: number
  tempoGap: number
  tempoConfidence: number
  beatCount: number
  primedFrames: number
  warmupUntil: number
}

/** 全局动态（整曲自适应）—— 上游 `cinemaDynamics`。 */
interface CinemaDynamics {
  avg: number
  lowAvg: number
  peak: number
  scale: number
}

/** 整曲画像 —— 上游 `cinemaTrackProfile`。 */
interface CinemaTrackProfile {
  scale: number
  target: number
  frames: number
  energyAvg: number
  lowAvg: number
  vocalAvg: number
  melodyAvg: number
  punchPeak: number
  density: number
}

function createBeatCam(): BeatCamState {
  return {
    events: [],
    punch: 0,
    lastTriggerAt: -10,
    lastRealtimeAt: -10,
    thetaKick: 0,
    phiKick: 0,
    radiusKick: 0,
    rollKick: 0,
    prevAudioTime: -1,
  }
}

function createRealtime(): RealtimeState {
  return {
    subFast: 0,
    subSlow: 0,
    lowFast: 0,
    lowSlow: 0,
    bodyFast: 0,
    bodySlow: 0,
    vocalFast: 0,
    vocalSlow: 0,
    snapFast: 0,
    snapSlow: 0,
    prevSub: 0,
    prevLow: 0,
    prevBody: 0,
    prevVocal: 0,
    prevSnap: 0,
    prevRms: 0,
    onsetAvg: 0.012,
    onsetPeak: 0.06,
    subPeak: 0.14,
    lowPeak: 0.18,
    bodyPeak: 0.16,
    vocalPeak: 0.16,
    snapPeak: 0.14,
    lastHitAt: -10,
    tempoGap: 0,
    tempoConfidence: 0,
    beatCount: 0,
    primedFrames: 0,
    warmupUntil: 0,
  }
}

const beatCam = createBeatCam()
let rt = createRealtime()
const dynamics: CinemaDynamics = { avg: 0, lowAvg: 0, peak: 0.3, scale: 0.82 }
const profile: CinemaTrackProfile = {
  scale: 1,
  target: 1,
  frames: 0,
  energyAvg: 0,
  lowAvg: 0,
  vocalAvg: 0,
  melodyAvg: 0,
  punchPeak: 0.1,
  density: 0,
}
/** 最近一次消费的 tap 发布代次 —— 用于识别**真实切歌**（见 stepBeatCameraAudio）。 */
let lastTapRevision = -1
/** 每帧输出（消费者读它，避免每帧分配对象）。 */
const output: BeatCameraFrame = { punch: 0, thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0 }

/**
 * 整曲自适应的**归一化分析态**（上游 `11-main-loop.js:383-506` 的主循环块）。
 *
 * ★ 第三个块：上游有**两套**独立的频段取法，此前本项目只做了第一套。
 *
 *   ① `processRealtimeBeatEngine` 内部（`:396-413`）：从原始 FFT 算
 *      `sub/kick/body/vocal/snap/low/rms`，用于 onset / score / 门槛 —— 这些是
 *      **未归一化**的绝对量。→ 本项目用监视器的 `beatSub`/`beatKick` 等。
 *
 *   ② **主循环**（`:383-506`）：另算 `bKick`/`mInst`/`tHigh`，过**动态峰值跟踪**
 *      与幂次归一化，得到 `rb`/`rm`/`rt`/`re`；再由它们推
 *      `bassOnset = max(0, rb - smoothBass)` 与四个 `smooth*` 跟随量，
 *      组装成 `cinemaProfileSample` 喂给整曲自适应。
 *
 *   此前本项目把 ① 的量直接当 ② 用 —— 于是：
 *     · `lowOnset` 只能是 0/1 布尔（监视器只有上升沿）→ `punchPeak` 锁死（A1）；
 *     · `melody` 取了 260–720Hz 而非 2600–6200Hz（A6）；
 *     · sonic 驱动段因两项同源而因子惰性（A9）。
 *
 *   补齐这一块后，上面三个症状**同时**消失 —— 它们本就是"缺了 ② "的三个面。
 *
 * ⚠️ 与上游的残余差异（登记 §5.4 A7）：上游 ② 读的是**原始** `getByteFrequencyData`
 *    与**时域** `getByteTimeDomainData`；本项目频段来自监视器的平滑链、且没有
 *    时域通道，故 `rms` 用频谱聚合 `energy` 近似。因此 onset 的**幅度**仍可能
 *    与上游不同（方向与形状已对齐）。彻底对齐要动监视器的数据出口，属单独一轮。
 */
interface CameraAnalysis {
  bassPeak: number
  midPeak: number
  treblePeak: number
  energyPeak: number
  smoothBass: number
  smoothMid: number
  smoothTreb: number
  smoothEnergy: number
  prevEnergy: number
  /**
   * 本分析帧归一化后的低频与两个起始量。
   *
   * 上游把它们算在**主循环**里（`:383-406`），而消费它们的 `liveFallbackOk`
   * 门槛也在主循环（`:424-429`）—— 引擎只是"被夹在中间"。本项目同样需要
   * 让门槛读到这里的结果，故存进分析态（§5.4 A2）。
   */
  rb: number
  bassOnset: number
  energyOnset: number
}

function createCameraAnalysis(): CameraAnalysis {
  return {
    // 上游初值（`11-main-loop.js` 的模块级 peak 初值）
    bassPeak: 0.03,
    midPeak: 0.026,
    treblePeak: 0.018,
    energyPeak: 0.03,
    smoothBass: 0,
    smoothMid: 0,
    smoothTreb: 0,
    smoothEnergy: 0,
    prevEnergy: 0,
    rb: 0,
    bassOnset: 0,
    energyOnset: 0,
  }
}

const cam = createCameraAnalysis()

/**
 * 实时引擎命中后**返回**的载荷（上游 `processRealtimeBeatEngine` 的返回值，
 * `02-beat-camera-runtime.js:588-606`）。
 *
 * ★ 为什么要有这一层（第三十四轮修，§5.4 A2）：
 *
 *   上游的节拍运镜有**两道**门槛 —— 引擎内部的 `hit`（多频段瞬态 + 节奏接受 +
 *   最小间隔，即本项目此前实现的那一层），**以及**主循环的 `liveFallbackOk`
 *   （`11-main-loop.js:424-429`）：
 *
 *     liveKickFrame  = low > 0.42 && rb > 0.34 && bassOnset > 0.048 && energyOnset > 0.008
 *     liveStrongHit  = confidence > 0.62 && strength > 0.54 && score > 0.44 && liveKickFrame
 *     liveTempoHit   = tempoAssist && confidence > 0.62 && strength > 0.50 && low > 0.40
 *                      && bassOnset > 0.036
 *     liveFallbackOk = waitingForBeatMap ? (liveStrongHit || liveTempoHit)
 *                                        : (confidence > 0.68 && strength > 0.62
 *                                           && low > 0.44 && (liveKickFrame || score > 0.52))
 *
 *   即引擎命中之后，还必须**同时**有足够的置信度、强度、低频存在感，以及
 *   一记真实的低频起跳帧 —— 才真的推镜。
 *
 *   此前本项目**无条件**把每个引擎命中都排成事件（没有第二道门槛），
 *   于是密集段落的事件数明显多于上游、镜头明显更躁。
 *
 *   本项目无离线拍点图（§5.1），因此恒走 `!waitingForBeatMap` 那一支
 *   （即 `confidence > 0.68 && strength > 0.62 && low > 0.44 && (liveKickFrame || score > 0.52)`）。
 *
 *   ⚠️ `waitingForBeatMap` 分支依赖离线拍点图子系统（`beatMapBusy` /
 *   `beatAnalysisTimer` / `currentTime < 18`），本项目未移植，故不实现那一支。
 */
interface LiveBeatPayload {
  time: number
  strength: number
  confidence: number
  low: number
  body: number
  snap: number
  mass: number
  sharpness: number
  tempoAssist: boolean
  combo: BeatCombo
  impact: number
  score: number
}

/** 复用对象，避免每次命中分配（与 `output` 同理）。 */
const livePayload: LiveBeatPayload = {
  time: 0,
  strength: 0,
  confidence: 0,
  low: 0,
  body: 0,
  snap: 0,
  mass: 0,
  sharpness: 0,
  tempoAssist: false,
  combo: 'downbeat',
  impact: 0,
  score: 0,
}

/** 上游 `env(prev, next, attack, release)`（`:479-482`）—— 注意 k 是**直接**混合系数，不是时间常数。 */
function env(previous: number, next: number, attack: number, release: number): number {
  const k = next > previous ? attack : release
  return previous + (next - previous) * k
}

// ---------------------------------------------------------------- 小工具（上游同名）

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
/** 上游 `easeBeatCamera`：smoothstep。 */
function easeBeatCamera(x: number): number {
  const c = clamp01(x)
  return c * c * (3 - 2 * c)
}
/** 上游 `follow(cur, next, upTau, downTau)`：按方向取时间常数的指数跟随。 */
function follow(cur: number, next: number, upTau: number, downTau: number, dt: number): number {
  const tau = next > cur ? upTau : downTau
  return cur + (next - cur) * (1 - Math.exp(-dt / Math.max(0.001, tau)))
}

// ---------------------------------------------------------------- ① 实时节拍引擎

/** 上游 `readSonicRealtimeCameraSample`（`:174-203`）—— 桥接音波监视器 frame。 */
interface SonicCameraSample {
  lowPresence: number
  lowAttack: number
  score: number
  strength: number
  lowDominance: number
  lowFluxDominance: number
}

function readSonicRealtimeCameraSample(): SonicCameraSample | null {
  // ★ 必须读**原始引擎帧**（`getSonicAudioFrame`），不是 `readAudioBands()`
  //   投影出来的 `AudioBands` —— 上游 `readSonicRealtimeCameraSample` 读的是
  //   `sonicAudioMonitorState.frame`，其中 `kickFlux` / `kickOnset` /
  //   `kickConfidence` / `kickLowDominance` 这些**节拍检测**字段只存在于
  //   原始帧上（`AudioBands` 只投影了 `kickCore`/`kickSub` 等展示用字段）。
  //   `TopographyScene` 同样走这条路径（它读 `monitorFrame?.kickEnvelope`）。
  const frame = getSonicAudioFrame()
  if (!frame) return null
  const sub = clamp01(frame.subBass)
  const bassBand = clamp01(frame.bassBand)
  const lowMid = clamp01(frame.lowMid)
  const midBand = clamp01(frame.mid)
  const highMid = clamp01(frame.highMid)
  const presence = clamp01(frame.presence)
  const low = clamp01(sub * 0.58 + bassBand * 0.78 + lowMid * 0.28)
  const kick = clamp01(Math.max(frame.kickEnvelope, frame.triggerPulse, frame.beat))
  const kickDominance = clamp01(frame.kickLowDominance)
  const onset = clamp01(
    frame.kickFlux * 1.55 + frame.kickOnset * 0.24 + frame.triggerOnset * 0.16 + frame.triggerPulse * 0.18,
  )
  const competing = midBand * 0.58 + highMid * 0.32 + presence * 0.18
  return {
    lowPresence: clamp01(low + kick * 0.26),
    lowAttack: clampRange(onset * 0.055 + kick * 0.018 + kickDominance * 0.018, 0, 0.14),
    score: clamp01(frame.kickConfidence * 0.52 + onset * 0.3 + kick * 0.16 + kickDominance * 0.12),
    strength: clamp01(0.34 + kick * 0.26 + low * 0.22 + onset * 0.24),
    lowDominance: Math.max(0.7, low / Math.max(0.001, competing), 0.78 + kickDominance * 0.7),
    lowFluxDominance: Math.max(0.96, 0.82 + onset * 1.28 + kickDominance * 0.24),
  }
}

/** 上游 `processRealtimeBeatEngine`（`:392-606`），DJ 分支已剔除。 */
function processRealtimeBeatEngine(dt: number, nowT: number): LiveBeatPayload | null {
  const step = Math.max(0.001, Math.min(0.08, dt || 0.016))

  // ★ 频段必须用**上游同名量**（第三十四轮修，§5.4 A5/A6）。
  //
  //   上游 `processRealtimeBeatEngine`（`:399-404`）自己从频域算：
  //     sub  = beatBandRms(38, 74)
  //     kick = beatBandRms(52, 165)
  //     low  = min(1, kick * 0.86 + sub * 0.42)        ← 注意**没有** body 项
  //     rms  = 时域 RMS
  //   而 `beatBandRms` 是**不加权**均方根（`:366-390`）。
  //
  //   此前本项目直接取八频段表的 `subBass`(32–58) / `bass`(58–118)，三处都不对：
  //   `subBass` 比上游的 38–74 更窄更低；`bass` 只是 58–118 那一段，而上游的
  //   `low` 是 52–165 踢鼓加权 0.86 + 38–74 次低音加权 0.42。
  //   `drumOnset`（`lowRise*1.62 + lowFlux*1.34`）是**绝对量**，量级与形状一偏，
  //   score / `lowAttack` 门槛就跟着移，命中时机与数量都会不同。
  //
  //   `beatSub` / `beatKick` 是监视器按上游范围与不加权口径补出来的同名量。
  //
  //   ⚠️ 残余（登记 §5.4 A7）：上游逐帧读**原始** FFT，本项目频段走监视器的
  //   平滑链（攻击 34 / 释放 10）—— flux/rise 是帧间差，平滑后再差会**幅度偏小
  //   且滞后**。改这条要动监视器的数据出口，属单独一轮。
  //   `rms` 上游取**时域** RMS，本项目无时域通道，仍用频谱聚合 `energy`
  //   （同为 0..1 能量量，语义最近）。
  const frame = getSonicAudioFrame()
  const sub = clamp01(frame?.beatSub ?? 0)
  const kickBand = clamp01(frame?.beatKick ?? 0)
  const low = clamp01(kickBand * 0.86 + sub * 0.42)
  const body = clamp01(frame?.body ?? 0)
  const vocal = clamp01(frame?.vocal ?? 0)
  const snap = clamp01(frame?.snap ?? 0)
  const rms = clamp01(frame?.energy ?? 0)

  rt.subFast = follow(rt.subFast, sub, 0.018, 0.064, step)
  rt.subSlow = follow(rt.subSlow, sub, 0.32, 0.52, step)
  rt.lowFast = follow(rt.lowFast, low, 0.016, 0.07, step)
  rt.lowSlow = follow(rt.lowSlow, low, 0.3, 0.54, step)
  rt.bodyFast = follow(rt.bodyFast, body, 0.02, 0.082, step)
  rt.bodySlow = follow(rt.bodySlow, body, 0.36, 0.6, step)
  rt.vocalFast = follow(rt.vocalFast, vocal, 0.026, 0.09, step)
  rt.vocalSlow = follow(rt.vocalSlow, vocal, 0.34, 0.58, step)
  rt.snapFast = follow(rt.snapFast, snap, 0.012, 0.06, step)
  rt.snapSlow = follow(rt.snapSlow, snap, 0.3, 0.52, step)

  const peakDecay = 0.99
  rt.subPeak = Math.max(rt.subPeak * Math.pow(peakDecay, step * 60), sub, 0.045)
  rt.lowPeak = Math.max(rt.lowPeak * Math.pow(0.989, step * 60), low, 0.06)
  rt.bodyPeak = Math.max(rt.bodyPeak * Math.pow(peakDecay, step * 60), body, 0.04)
  rt.vocalPeak = Math.max(rt.vocalPeak * Math.pow(peakDecay, step * 60), vocal, 0.04)
  rt.snapPeak = Math.max(rt.snapPeak * Math.pow(peakDecay, step * 60), snap, 0.035)

  const subFlux = Math.max(0, sub - rt.prevSub)
  const lowFlux = Math.max(0, low - rt.prevLow)
  const bodyFlux = Math.max(0, body - rt.prevBody)
  const vocalFlux = Math.max(0, vocal - rt.prevVocal)
  const snapFlux = Math.max(0, snap - rt.prevSnap)
  const rmsFlux = Math.max(0, rms - rt.prevRms)
  const subRise = Math.max(0, rt.subFast - rt.subSlow)
  const lowRise = Math.max(0, rt.lowFast - rt.lowSlow)
  const bodyRise = Math.max(0, rt.bodyFast - rt.bodySlow)
  const vocalRise = Math.max(0, rt.vocalFast - rt.vocalSlow)
  const snapRise = Math.max(0, rt.snapFast - rt.snapSlow)
  const drumOnset = subRise * 0.88 + subFlux * 0.66 + lowRise * 1.62 + lowFlux * 1.34
  const musicalOnset =
    bodyRise * 0.34 +
    bodyFlux * 0.24 +
    vocalRise * 0.52 +
    vocalFlux * 0.36 +
    snapRise * 0.08 +
    snapFlux * 0.06 +
    rmsFlux * 0.2
  const onset = drumOnset + musicalOnset * 0.16

  const avgTau = onset > rt.onsetAvg ? 1.1 : 0.34
  rt.onsetAvg = follow(rt.onsetAvg, onset, avgTau, avgTau, step)
  rt.onsetPeak = Math.max(rt.onsetPeak * Math.pow(0.988, step * 60), onset, 0.032)
  const floor = rt.onsetAvg * 0.84
  let score = clamp01((onset - floor) / Math.max(0.014, rt.onsetPeak - floor))
  const subNorm = clamp01(sub / Math.max(0.045, rt.subPeak * 0.7))
  const lowNorm = clamp01(low / Math.max(0.06, rt.lowPeak * 0.72))
  const bodyNorm = clamp01(body / Math.max(0.045, rt.bodyPeak * 0.72))
  const vocalNorm = clamp01(vocal / Math.max(0.045, rt.vocalPeak * 0.72))
  const snapNorm = clamp01(snap / Math.max(0.04, rt.snapPeak * 0.72))

  rt.primedFrames++
  const warmingUp = nowT < rt.warmupUntil || rt.primedFrames < 10
  const gapFromLast = nowT - rt.lastHitAt
  const expectedGap = rt.tempoGap > 0 ? rt.tempoGap : 0

  let lowPresence = Math.max(lowNorm, subNorm * 0.74)
  let lowAttack = lowRise + lowFlux * 0.72 + subRise * 0.58 + subFlux * 0.4
  let lowDominance = low / Math.max(0.001, vocal * 0.84 + body * 0.36 + snap * 0.1)
  let lowFluxDominance =
    (lowFlux + subFlux * 0.58) / Math.max(0.001, vocalFlux * 0.72 + bodyFlux * 0.42 + snapFlux * 0.16)
  const sonic = readSonicRealtimeCameraSample()
  let sonicKickAssist = false
  if (sonic) {
    lowPresence = Math.max(lowPresence, sonic.lowPresence)
    lowAttack = Math.max(lowAttack, sonic.lowAttack, lowAttack + sonic.lowAttack * 0.35)
    score = Math.max(score, sonic.score)
    lowDominance = Math.max(lowDominance, sonic.lowDominance)
    lowFluxDominance = Math.max(lowFluxDominance, sonic.lowFluxDominance)
    sonicKickAssist = sonic.score > 0.44 && sonic.lowPresence > 0.42 && sonic.lowDominance > 0.96
  }

  const voiceMask = vocalNorm > 0.6 && lowDominance < 0.8 && lowFluxDominance < 1.04 && !sonicKickAssist
  const fastGroove = rt.tempoGap > 0 && rt.tempoGap < 0.52
  let drumGate = lowPresence > 0.34 && lowAttack > Math.max(0.011, rt.onsetAvg * 0.26) && !voiceMask
  drumGate = drumGate && (lowDominance > 0.64 || lowFluxDominance > 0.92 || subNorm > 0.48 || sonicKickAssist)
  const strongTransient = drumGate && score > 0.46 && (drumOnset > rt.onsetAvg * 0.66 || sonicKickAssist)
  const kickTransient = drumGate && score > 0.34 && lowAttack > Math.max(0.014, rt.onsetAvg * 0.34)
  const fastTransient = drumGate && (fastGroove || sonicKickAssist) && score > 0.32 && lowPresence > 0.38
  const tempoAssist =
    expectedGap > 0 &&
    gapFromLast > expectedGap - Math.max(0.055, Math.min(0.105, expectedGap * 0.16)) &&
    gapFromLast < expectedGap + Math.max(0.055, Math.min(0.105, expectedGap * 0.16)) &&
    rt.tempoConfidence > 0.34 &&
    drumGate &&
    lowPresence > 0.36 &&
    score > 0.18 &&
    lowAttack > Math.max(0.012, rt.onsetAvg * 0.26)
  let candidateHit = strongTransient || kickTransient || fastTransient || tempoAssist
  if (warmingUp && !sonicKickAssist) candidateHit = false

  const hasTempoLock = expectedGap >= 0.42 && expectedGap <= 0.88 && rt.tempoConfidence > 0.38
  const lockedWindow = hasTempoLock ? Math.max(0.07, Math.min(0.11, expectedGap * 0.16)) : 0
  const gapRaw = nowT - rt.lastHitAt
  let rhythmAccept = false
  if (candidateHit) {
    if (rt.lastHitAt < 0) {
      rhythmAccept = (strongTransient || sonicKickAssist) && score > 0.5 && lowPresence > 0.4
    } else if (hasTempoLock) {
      const oneBeatErr = Math.abs(gapRaw - expectedGap)
      const twoBeatErr = Math.abs(gapRaw - expectedGap * 2)
      rhythmAccept = oneBeatErr <= lockedWindow && (kickTransient || strongTransient || fastTransient)
      rhythmAccept = rhythmAccept || (twoBeatErr <= lockedWindow * 1.35 && strongTransient && score > 0.58)
      rhythmAccept =
        rhythmAccept || (gapRaw > expectedGap * 1.2 && (strongTransient || fastTransient) && lowPresence > 0.38)
    } else {
      const looseRealtimeMin = Math.max(0.255, REALTIME_MIN_INTERVAL * 0.72)
      rhythmAccept =
        gapRaw >= looseRealtimeMin &&
        (strongTransient || (kickTransient && score > 0.4) || fastTransient) &&
        score > 0.42 &&
        lowPresence > 0.38
    }
  }
  let hit = candidateHit && rhythmAccept

  const minGap = hasTempoLock
    ? Math.max(0.255, Math.min(0.46, expectedGap * 0.56))
    : Math.max(0.255, REALTIME_MIN_INTERVAL * 0.72)
  if (hit && gapRaw < minGap) {
    if ((fastTransient || sonicKickAssist) && gapRaw > minGap * 0.78 && score > 0.4 && lowPresence > 0.38) {
      hit = true
    } else {
      hit = false
    }
  }

  rt.prevSub = sub
  rt.prevLow = low
  rt.prevBody = body
  rt.prevVocal = vocal
  rt.prevSnap = snap
  rt.prevRms = rms

  // ★ A4：`tempoConfidence` 衰减必须在 `if (!hit) return` **之前**。
  //
  //   上游 `:542` 的 `tempoConfidence *= pow(0.996, dt*60)` 在 `:544` 的
  //   `if (!hit)` 之前 —— 即**每个分析帧**都衰减。此前本项目写在 return 之后，
  //   只有命中帧才衰减：长安静段里 confidence 不降反持，`hasTempoLock`
  //   （要求 > 0.38）与 `tempoAssist`（要求 > 0.34）该释放时不释放 →
  //   安静段冒出多余命中（"忽强忽弱"的又一个来源）。
  rt.tempoConfidence *= Math.pow(0.996, step * 60)

  if (!hit) return null

  // ---- tempo lock：从连续命中间隔推 BPM ----
  let gapShift = 0
  if (rt.lastHitAt > 0) {
    let gap = nowT - rt.lastHitAt
    while (gap > 0.88) gap *= 0.5
    while (gap < 0.42) gap *= 2
    if (gap >= 0.42 && gap <= 0.88) {
      gapShift = rt.tempoGap ? Math.abs(gap - rt.tempoGap) / Math.max(0.001, rt.tempoGap) : 0
      const tempoEase = hasTempoLock ? 0.1 : 0.22
      rt.tempoGap = rt.tempoGap ? rt.tempoGap * (1 - tempoEase) + gap * tempoEase : gap
      // ★ A10：tempo-assist 命中只加 0.04，普通命中加 0.18。
      //   上游 `:562` `+ (tempoAssist ? 0.04 : 0.18)`；此前本项目恒 +0.18，
      //   导致 assist 命中的 confidence 爬升快 4.5×，后续 tempo-lock 更易被接受
      //   （自增强回路）。
      rt.tempoConfidence = Math.min(1, rt.tempoConfidence + (tempoAssist ? 0.04 : 0.18))
    }
  }
  rt.lastHitAt = nowT
  rt.beatCount++

  let strength = clamp01(
    0.24 + score * 0.36 + lowPresence * 0.34 + Math.min(1.25, lowDominance) * 0.07 + rmsFlux * 0.95,
  )
  if (sonic) strength = Math.max(strength, sonic.strength)
  if (tempoAssist) strength = Math.max(strength, 0.48 + rt.tempoConfidence * 0.1 + lowPresence * 0.14)

  const comboSlot = (rt.beatCount - 1) % 4
  let combo: BeatCombo = comboSlot === 0 ? 'downbeat' : comboSlot === 1 ? 'push' : comboSlot === 2 ? 'drop' : 'rebound'
  if (strength > 0.84 && comboSlot !== 0) combo = 'accent'
  void gapShift

  const confidence = clamp01(score * 0.62 + lowPresence * 0.26 + rt.tempoConfidence * 0.12)
  // ★ 只**返回**载荷，不在这里排事件 —— 上游同样如此（`:588-606` 返回对象，
  //   由主循环 `11-main-loop.js:429` 过 `liveFallbackOk` 后才 `scheduleBeatCamera`）。
  //   见 `LiveBeatPayload` 注释（§5.4 A2）。
  livePayload.time = nowT
  livePayload.strength = strength
  livePayload.confidence = confidence
  livePayload.low = Math.max(0.05, lowPresence)
  livePayload.body = Math.max(0.02, bodyNorm * 0.62)
  livePayload.snap = Math.max(0.02, snapNorm)
  livePayload.mass = clamp01(lowPresence * 0.76 + bodyNorm * 0.2)
  livePayload.sharpness = clamp01(snapNorm * 0.7 + bodyNorm * 0.12)
  livePayload.tempoAssist = tempoAssist
  livePayload.combo = combo
  livePayload.impact = clamp01(strength * 0.46 + confidence * 0.2 + lowPresence * 0.28)
  livePayload.score = score
  return livePayload
}

// ---------------------------------------------------------------- ② 事件调度

interface BeatInput {
  time: number
  strength: number
  confidence: number
  low: number
  body: number
  snap: number
  mass: number
  sharpness: number
  combo: BeatCombo
  impact: number
  preview: boolean
  primary: boolean
  tempoAssist: boolean
}

/** 上游 `cameraDynamicsScale`（`:101-105`），DJ 项已剔除。 */
function cameraDynamicsScale(extra?: number): number {
  return clampRange((dynamics.scale || 0.82) * (profile.scale || 1) * (extra == null ? 1 : extra), 0.18, 1.18)
}

/** 上游 `scheduleBeatCamera`（`:639-887`），`isMapSource`/`dj` 分支已剔除。 */
function scheduleBeatCamera(beat: BeatInput): void {
  const time = beat.time
  if (!Number.isFinite(time)) return
  const strength = clampRange(beat.strength, 0, 1)
  const confidence = clampRange(beat.confidence, 0, 1)
  const visualImpact = clampRange(beat.impact, 0, 1)

  // 上游此处对 map 源有若干门槛（`isMapSource` 分支）与 `trackScale` 抑制。
  // 实时源只需后者：极弱段不排队，避免安静段落抖个不停。
  const trackScale = profile.scale || 1
  if (trackScale < 0.5 && strength < 0.84 && visualImpact < 0.56) return

  let lowTone = Math.max(0, beat.low)
  let bodyTone = Math.max(0, beat.body)
  let snapTone = Math.max(0, beat.snap)
  const toneSum = Math.max(0.001, lowTone + bodyTone + snapTone)
  lowTone /= toneSum
  bodyTone /= toneSum
  snapTone /= toneSum
  const sharpness = clampRange(beat.sharpness, 0, 1)
  const mass = clampRange(beat.mass, 0, 1)

  const nowT = time
  let mode: BeatMode = 'deep'
  if (snapTone > 0.42 && snapTone > lowTone * 1.18 && snapTone > bodyTone * 1.08) mode = 'snap'
  else if (bodyTone > 0.46 && bodyTone > lowTone * 1.12) mode = 'body'

  let amp = Math.max(0.18, Math.min(0.72, 0.15 + strength * 0.34 + confidence * 0.06 + mass * 0.13 + snapTone * 0.04))
  // ★ A3：`source === 'live'` 的源振幅因子（上游 `:693`）：
  //     `amp *= dj ? 0.62 : (livePreview ? 0.78 : 0.92)`
  //   本项目恒为非 DJ、非 preview ⇒ **×0.92**。此前整行漏抄，
  //   每个事件的 `amp` 高 8.7%，传导到 punch 与全部四条冲击通道。
  //   位置忠于上游：在 base clamp 之后、`mode === 'deep'` 倍率**之前**。
  amp *= 0.92
  if (mode === 'deep') amp = Math.min(0.62, amp * 1.12)
  amp *= cameraDynamicsScale(0.92 + visualImpact * 0.12 + mass * 0.08)

  const attack = Math.max(0.014, Math.min(0.038, DEFAULT_ATTACK * (1.18 - sharpness * 0.55)))
  const hold = Math.max(0.014, Math.min(0.052, DEFAULT_HOLD * (0.62 + lowTone * 0.55 + bodyTone * 0.25)))
  const release = Math.max(
    0.11,
    Math.min(0.255, DEFAULT_RELEASE * (0.76 + mass * 0.56 + bodyTone * 0.18 - sharpness * 0.18)),
  )

  const idx = Math.floor(time * 2.7)
  const combo = beat.combo
  const dynScale = cameraDynamicsScale(0.92 + visualImpact * 0.12 + mass * 0.08)
  let zoomAmp = 0.07 + mass * 0.19 + (mode === 'deep' ? 0.095 : 0.018) + strength * 0.045
  let thetaAmp = 0.00035
  let phiAmp = 0.002 + (mode === 'body' ? 0.012 : mode === 'snap' ? 0.005 : 0.002)
  let rollAmp = mode === 'snap' ? 0.003 + snapTone * 0.004 : 0.0008
  zoomAmp *= 0.76 + dynScale * 0.28
  phiAmp *= 0.82 + dynScale * 0.2
  rollAmp *= 0.78 + dynScale * 0.24

  // combo 形态（上游非 DJ 分支）
  if (combo === 'downbeat') {
    amp *= 1.1
    zoomAmp *= 1.18
    phiAmp *= 0.72
  } else if (combo === 'push') {
    amp *= 0.84
    zoomAmp *= 0.88
    phiAmp *= 0.62
  } else if (combo === 'drop') {
    amp *= 0.96
    zoomAmp *= 0.72
    phiAmp *= 1.22
  } else if (combo === 'rebound') {
    amp *= 0.74
    zoomAmp *= 0.62
    phiAmp *= 0.78
  } else if (combo === 'accent') {
    amp *= 1.14
    zoomAmp *= 1.08
    rollAmp *= 1.35
  }

  // 预热期（拍点图未就绪）压低振幅 —— 上游 `livePreview` 分支。
  //
  // ★ 本分支在**当前移植范围内不可达**（诚实标注，第三十四轮审计 #5）。
  //   上游的 `preview` 语义是 `waitingForBeatMap`（`11-main-loop.js:414`
  //   把 `preview: waitingForBeatMap` 传进 `scheduleBeatCamera`），而
  //   `waitingForBeatMap` 依赖**离线拍点图**子系统（`beatMapBusy` /
  //   `beatAnalysisTimer` / `currentTime < 18`）—— 本项目未移植（§5.1），
  //   因此唯一的构造点恒传 `preview: false`。
  //
  //   保留分支本身是为了：① 与上游结构逐行对应，将来补拍点图时直接可用；
  //   ② 说明"这里的振幅差异不是遗漏"。**不要**为了让它"可达"而伪造一个
  //   preview 值 —— 那会引入上游没有的行为。
  //
  //   另注：上游只有在**非** preview 时才有 `amp *= 0.92` 那一条（见上方 A3），
  //   所以本分支同时意味着"preview 时不再乘 0.92"。
  if (beat.preview) {
    const previewTone = clamp01(visualImpact * 0.54 + lowTone * 0.22 + confidence * 0.18 + strength * 0.06)
    amp *= 0.72 + previewTone * 0.16
    zoomAmp *= 0.62 + previewTone * 0.18
    phiAmp *= 0.7 + previewTone * 0.12
    thetaAmp *= 0.7 + previewTone * 0.12
    rollAmp *= 0.54 + previewTone * 0.16
  }

  amp = Math.max(0.08, Math.min(0.68, amp))

  // 实时源限流 + 与已有事件合并（上游 `isLiveSource` 分支）
  const fastLiveGroove = rt.tempoGap > 0 && rt.tempoGap < 0.52
  const liveMinInterval = Math.max(0.255, REALTIME_MIN_INTERVAL * (fastLiveGroove ? 0.62 : 0.72))
  if (time - beatCam.lastRealtimeAt < liveMinInterval && strength < 0.68) return
  beatCam.lastRealtimeAt = time

  if (
    mergeRealtimeBeatCamera(time, amp, {
      zoomAmp,
      thetaAmp,
      phiAmp,
      rollAmp,
      mode,
      low: lowTone,
      body: bodyTone,
      snap: snapTone,
    })
  ) {
    beatCam.lastTriggerAt = Math.max(beatCam.lastTriggerAt, time)
    return
  }
  beatCam.lastTriggerAt = Math.max(beatCam.lastTriggerAt, time)

  beatCam.events.push({
    start: nowT - attack * 0.42,
    hit: time,
    amp,
    attack,
    hold,
    release,
    zoomAmp,
    thetaAmp,
    phiAmp,
    rollAmp,
    mode,
    combo,
    phase: idx * 2.399963 + (snapTone - lowTone) * 1.4,
    low: lowTone,
    body: bodyTone,
    snap: snapTone,
    mass,
    source: 'live',
  })
  if (beatCam.events.length > MAX_EVENTS) {
    beatCam.events.splice(0, beatCam.events.length - MAX_EVENTS)
  }
}

/** 上游 `mergeRealtimeBeatCamera`（`:607-637`）：窗口内已有事件则取 max 合并。 */
function mergeRealtimeBeatCamera(
  time: number,
  amp: number,
  tone: {
    zoomAmp: number
    thetaAmp: number
    phiAmp: number
    rollAmp: number
    mode: BeatMode
    low: number
    body: number
    snap: number
  },
): boolean {
  let best: BeatEvent | null = null
  let bestDist = REALTIME_MERGE_WINDOW
  for (const ev of beatCam.events) {
    const dist = Math.abs((ev.hit || 0) - time)
    if (dist < bestDist) {
      best = ev
      bestDist = dist
    }
  }
  if (!best) return false
  best.hit = time
  best.start = time - (best.attack || DEFAULT_ATTACK) * 0.42
  best.amp = Math.min(0.62, Math.max(best.amp || 0, amp))
  best.zoomAmp = Math.max(best.zoomAmp || 0, tone.zoomAmp)
  best.thetaAmp = Math.max(best.thetaAmp || 0, tone.thetaAmp)
  best.phiAmp = Math.max(best.phiAmp || 0, tone.phiAmp)
  best.rollAmp = Math.max(best.rollAmp || 0, tone.rollAmp || 0)
  best.low = Math.max(best.low || 0, tone.low)
  best.body = Math.max(best.body || 0, tone.body)
  best.snap = Math.max(best.snap || 0, tone.snap)
  best.mode = tone.mode || best.mode
  best.source = 'hybrid'
  return true
}

// ---------------------------------------------------------------- ③ 包络求值

/** 上游 `updateBeatCamera`（`:920-1015`），DJ 分支已剔除。 */
/**
 * 重新开始节拍引擎（上游 `resetRealtimeBeatEngine`，`:233-247`）。
 *
 * 与 `resetBeatCamera` 的区别：**只重置引擎侧**（峰值跟踪器、tempo、预热窗口），
 * 不碰事件队列之外的相机冲击，也**不碰**整曲自适应（`dynamics`/`profile`）。
 * 上游在两条路径上用它：seek（`:934`）与切歌（经 `resetBeatCameraSync`）。
 */
function resetRealtimeEngine(currentTime: number): void {
  rt = createRealtime()
  rt.warmupUntil = (Number.isFinite(currentTime) ? currentTime : 0) + 0.48
  // 归一化分析态（峰值跟踪器 / smooth 跟随量）同属频率自适应，必须一并归零 —
  // 否则 seek 后 `subNorm`/`lowNorm` 仍按跳转前的高峰值归一，`score` 失真。
  cam.bassPeak = 0.03
  cam.midPeak = 0.026
  cam.treblePeak = 0.018
  cam.energyPeak = 0.03
  cam.smoothBass = 0
  cam.smoothMid = 0
  cam.smoothTreb = 0
  cam.smoothEnergy = 0
  cam.prevEnergy = 0
}

function updateBeatCamera(dt: number, nowT: number, playing: boolean): void {
  if (!playing) {
    beatCam.punch *= Math.pow(0.08, dt)
    beatCam.thetaKick *= Math.pow(0.05, dt)
    beatCam.phiKick *= Math.pow(0.05, dt)
    beatCam.radiusKick *= Math.pow(0.05, dt)
    beatCam.rollKick *= Math.pow(0.05, dt)
    beatCam.events.length = 0
    beatCam.prevAudioTime = nowT
    return
  }
  // seek / 回绕：上游按 0.55s 跳变判定
  if (beatCam.prevAudioTime >= 0 && Math.abs(nowT - beatCam.prevAudioTime) > 0.55) {
    // ★ 必须**完整重置引擎**，不只是清空在飞事件（第三十四轮修，§5.4 A11）。
    //
    //   上游 `updateBeatCamera`（`:932-935`）走的是
    //   `syncBeatCameraToTime(t)` → `resetBeatCameraSync(t)` → `resetRealtimeBeatEngine()`：
    //   清在飞事件**之外**，还重置峰值跟踪器（`subPeak`…）、`tempoGap`、
    //   `tempoConfidence`、`lastHitAt`，并把预热窗口重启为 `t + 0.48`。
    //
    //   此前本项目只清 `events` —— 于是 seek 之后：峰值跟踪器带着**跳转前**的
    //   高值 → `subNorm`/`lowNorm` 被压低、`score` 失真；tempo 状态也留着旧
    //   曲段的 BPM，可能立刻误命中一记。
    //
    //   ★ 刻意**不动** `dynamics` / `profile`（整曲自适应）：上游这条路径
    //     也不动它们（`resetRealtimeBeatEngine` 不碰 `cinemaDynamics`/
    //     `cinemaTrackProfile`），它们描述的是"整首歌的能量画像"，
    //     seek 不改变这个画像。只有**真的换歌**（tap 代次变化）才重置。
    resetRealtimeEngine(Math.max(0, nowT))
  }
  beatCam.prevAudioTime = nowT

  let punch = 0
  // thetaKick 在非 DJ 路径恒为 0（见下方 `leadEvent.dj` 说明），故用 const。
  const thetaKick = 0
  let phiKick = 0
  let radiusKick = 0
  let rollKick = 0
  let leadEvent: BeatEvent | null = null
  let leadPunch = 0
  let leadVal = 0

  for (let i = beatCam.events.length - 1; i >= 0; i--) {
    const ev = beatCam.events[i]
    const attack = ev.attack || DEFAULT_ATTACK
    const hold = ev.hold || DEFAULT_HOLD
    const release = ev.release || DEFAULT_RELEASE
    const local = nowT - ev.start
    let val = 0
    if (local < 0) {
      val = 0
    } else if (local < attack) {
      val = easeBeatCamera(local / attack)
    } else if (local < attack + hold) {
      val = 1
    } else if (local < attack + hold + release) {
      val = 1 - easeBeatCamera((local - attack - hold) / release)
    } else {
      beatCam.events.splice(i, 1)
      continue
    }
    const evPunch = val * ev.amp
    punch = Math.max(punch, evPunch)
    if (evPunch > leadPunch) {
      leadEvent = ev
      leadPunch = evPunch
      leadVal = val
    }
  }

  if (leadEvent) {
    const sign = Math.sin(leadEvent.phase) >= 0 ? 1 : -1
    const snapFlick = 1 - Math.min(1, Math.max(0, leadVal - 0.25) / 0.75)
    const combo = leadEvent.combo || 'downbeat'
    if (combo === 'downbeat') {
      radiusKick = leadPunch * leadEvent.zoomAmp
      phiKick = -leadPunch * 0.0032
    } else if (combo === 'push') {
      radiusKick = leadPunch * leadEvent.zoomAmp * 0.72
      phiKick = -leadPunch * 0.0014
    } else if (combo === 'drop') {
      radiusKick = leadPunch * leadEvent.zoomAmp * 0.46
      phiKick = leadPunch * leadEvent.phiAmp * 0.92
    } else if (combo === 'rebound') {
      radiusKick = leadPunch * leadEvent.zoomAmp * 0.3
      phiKick = -leadPunch * leadEvent.phiAmp * 0.22
    } else if (combo === 'accent') {
      radiusKick = leadPunch * leadEvent.zoomAmp * 0.9
      phiKick = -leadPunch * 0.0022
      rollKick = sign * leadPunch * (leadEvent.rollAmp || 0) * (0.45 + snapFlick * 0.3)
    } else if (leadEvent.mode === 'deep') {
      radiusKick = leadPunch * leadEvent.zoomAmp
      phiKick = -leadPunch * 0.003
    }
  }

  // 非 DJ 的缓动系数（上游 `djEase = false`）
  beatCam.punch += (punch - beatCam.punch) * (punch > beatCam.punch ? 0.72 : 0.38)
  beatCam.thetaKick +=
    (thetaKick - beatCam.thetaKick) * (Math.abs(thetaKick) > Math.abs(beatCam.thetaKick) ? 0.7 : 0.36)
  beatCam.phiKick += (phiKick - beatCam.phiKick) * (Math.abs(phiKick) > Math.abs(beatCam.phiKick) ? 0.7 : 0.36)
  beatCam.radiusKick += (radiusKick - beatCam.radiusKick) * (radiusKick > beatCam.radiusKick ? 0.72 : 0.34)
  beatCam.rollKick += (rollKick - beatCam.rollKick) * (Math.abs(rollKick) > Math.abs(beatCam.rollKick) ? 0.72 : 0.38)
}

// ---------------------------------------------------------------- ④ 歌曲自适应

/** 上游 `updateCinemaDynamics`（`:71-99`），DJ 项已剔除。 */
function updateCinemaDynamics(rawEnergy: number, rawLow: number): void {
  const e = clamp01(rawEnergy || 0)
  const l = clamp01(rawLow || 0)
  const composite = clamp01(e * 0.62 + l * 0.38)
  dynamics.avg += (composite - dynamics.avg) * (composite > dynamics.avg ? 0.01 : 0.004)
  dynamics.lowAvg += (l - dynamics.lowAvg) * (l > dynamics.lowAvg ? 0.012 : 0.005)
  dynamics.peak = Math.max(0.3, dynamics.peak * 0.9988, composite)
  const floor = Math.max(0.1, dynamics.avg * 0.82)
  const span = Math.max(0.18, dynamics.peak - floor)
  let lift = clamp01((composite - floor) / span)
  lift = lift * lift * (3 - 2 * lift)
  let target = 0.42 + lift * 0.56 + clamp01((l - dynamics.lowAvg) / 0.36) * 0.12
  if (dynamics.avg < 0.18 && l < 0.32) target *= 0.78
  if (e > 0.48 && l > 0.46) target = Math.max(target, 0.92)
  target = clampRange(target, 0.34, 1.08)
  dynamics.scale += (target - dynamics.scale) * (target > dynamics.scale ? 0.045 : 0.022)
}

/** 上游 `updateCinemaTrackProfile`（`:146-172`），DJ 项与 `nameHint` 已剔除。 */
function updateCinemaTrackProfile(sample: {
  energy: number
  low: number
  vocal: number
  melody: number
  lowOnset: number
  energyOnset: number
}): void {
  const p = profile
  p.frames++
  const early = p.frames < 360
  const k = early ? 0.02 : 0.006
  p.energyAvg = p.energyAvg + (clamp01(sample.energy) - p.energyAvg) * k
  p.lowAvg = p.lowAvg + (clamp01(sample.low) - p.lowAvg) * k
  p.vocalAvg = p.vocalAvg + (clamp01(sample.vocal) - p.vocalAvg) * k * 0.8
  p.melodyAvg = p.melodyAvg + (clamp01(sample.melody) - p.melodyAvg) * k * 0.8
  const punchRaw = clamp01((sample.lowOnset || 0) * 2.4 + (sample.energyOnset || 0) * 1.5 + sample.low * 0.16)
  p.punchPeak = Math.max(0.1, p.punchPeak * 0.9975, punchRaw)
  const lowDrive = clamp01((p.lowAvg - 0.2) / 0.42)
  const loudDrive = clamp01((p.energyAvg - 0.18) / 0.4)
  const punchDrive = clamp01((p.punchPeak - 0.13) / 0.36)
  const vocalSoft = clamp01((p.vocalAvg * 0.72 + p.melodyAvg * 0.42 - p.lowAvg * 0.34 - 0.08) / 0.42)
  const quietSoft = clamp01((0.24 - p.energyAvg) / 0.18)
  let target = 0.54 + lowDrive * 0.28 + loudDrive * 0.22 + punchDrive * 0.34 - vocalSoft * 0.34 - quietSoft * 0.18
  if (p.density) target += clamp01((p.density - 0.55) / 1.6) * 0.14
  target = clampRange(target, 0.28, 1.12)
  p.target = target
  p.scale += (target - p.scale) * (target > p.scale ? 0.03 : 0.045)
}

// ---------------------------------------------------------------- 对外的驱动（分频，与上游一致）

/**
 * ① + ④：按**音频分析频率**推进（不是每帧）。
 *
 * ★ 为什么必须与 ③ 分开：上游这两步在
 *   `if (audioStepDt > 0)`（`11-main-loop.js:361-362`）**之内** ——
 *   而 ③ 在 `updateCinema(dt)`（`:617`）里**之外**，每帧都跑。
 *
 *   这不只是性能考虑，而是**正确性**：
 *     · ① 的 flux/rise 用"本帧值 − 上帧值"算。本项目音频帧只在
 *       `stepAudioFrame` 时才更新（被画质档节流），若每帧都调 ①，
 *       未更新帧会拿到**同一个** frame → flux 恒为 0 → 节拍检测失效。
 *     · ④ 的 `profile.frames < 360` 是"前 360 **分析帧**"的语义，
 *       逐帧调会让前 6 秒就进入慢速跟随。
 *
 *   ③ 则必须每帧跑，否则包络（attack 最短 14ms）会在低画质档被
 *   采样不足 → 镜头推拉发抖。
 *
 * 调用点：`ParticleScene` 的 `AudioStepDriver`，在 `stepAudioFrame` 之后。
 */
export function stepBeatCameraAudio(dt: number, currentTime: number, playing: boolean): void {
  if (!playing) return

  // ★ 真实切歌 → 重置（与音波监视器同一判据：tap 发布代次）。
  //
  //   用 revision 而不是"挂载/卸载"：视觉舞台自身来回切换不应清空状态
  //   （那会让每次回来都重新经历预热，节拍忽强忽弱），只有**真的换了音频源**
  //   才重置。这与 `AudioAnalyser` 里 `resetSonicAudioMonitor` 的判据同源。
  //
  //   不重置的后果：上一首的在飞事件会带进新歌（"新歌一开始莫名推一下"），
  //   且整曲自适应 `dynamics`/`profile` 带着上一首的高能量值 —— 高能歌切到
  //   安静歌时运镜会持续偏强（与音波监视器的自适应阈值同理）。
  const revision = getAudioTapRevision()
  if (revision !== lastTapRevision) {
    lastTapRevision = revision
    resetBeatCamera(currentTime)
    // ★ 入场推镜必须在 reset **之后**（reset 会把 dynamics.scale 归到 0.82，
    //   而入场要求 ≥0.92、并注入 punch/radiusKick/phiKick）。顺序反了会被抹掉。
    //   见 `primeBeatCameraAfterTrackStart`（§5.4 A8）。
    primeBeatCameraAfterTrackStart(currentTime)
  }

  const step = Math.max(0, dt)
  const nowT = Math.max(0, currentTime)

  // ④ 整曲自适应：能量/低频/起始量与调性都取上游同名量
  //    （第三十四轮修，§5.4 A1/A6/A9）。
  const frame = getSonicAudioFrame()
  if (frame) {
    // ---- 上游主循环的归一化块（`11-main-loop.js:383-506`）----
    //
    // 动态峰值跟踪 → 幂次归一化 → `bassOnset` → smooth 跟随量 → 组装采样。
    // 逐式对照上游（非 DJ 分支），常量全部同名同值。
    const subNorm0 = clamp01(frame.beatSub)
    const kickNorm0 = clamp01(frame.beatKick)
    const bodyNorm0 = clamp01(frame.body)
    const vocalNorm0 = clamp01(frame.vocal)
    const snapNorm0 = clamp01(frame.snap)
    // `mInst` = 2600–6200Hz（melody），`tHigh` 用 snap 的 1800–9200 近似
    const mInst = clamp01(frame.beatMelody)
    const tHigh = snapNorm0
    // `bKick = min(1, kick*0.86 + sub*0.42 + body*0.10)`
    const bKick = Math.min(1, kickNorm0 * 0.86 + subNorm0 * 0.42 + bodyNorm0 * 0.1)
    const rmsRaw = clamp01(frame.energy)

    cam.bassPeak = Math.max(cam.bassPeak * 0.994, bKick, 0.03)
    cam.midPeak = Math.max(cam.midPeak * 0.993, mInst, 0.026)
    cam.treblePeak = Math.max(cam.treblePeak * 0.992, tHigh, 0.018)
    cam.energyPeak = Math.max(cam.energyPeak * 0.995, rmsRaw, 0.03)

    const rb = Math.min(1, Math.pow(bKick / Math.max(0.038, cam.bassPeak * 0.66), 0.78))
    const rm = Math.min(1, Math.pow(mInst / Math.max(0.025, cam.midPeak * 0.7), 0.86))
    const rtBand = Math.min(1, Math.pow(tHigh / Math.max(0.02, cam.treblePeak * 0.74), 0.92))
    const re = Math.min(1, Math.pow(rmsRaw / Math.max(0.034, cam.energyPeak * 0.68), 0.82))

    // ★ A1 的正解：**连续**的频段上升量（不是 0/1 上升沿）
    const bassOnset = Math.max(0, rb - cam.smoothBass)
    const energyOnset = Math.max(0, re - cam.prevEnergy)
    cam.prevEnergy = cam.prevEnergy * 0.88 + re * 0.12
    // 供第二道门槛 `liveFallbackOk` 使用（§5.4 A2）
    cam.rb = rb
    cam.bassOnset = bassOnset
    cam.energyOnset = energyOnset

    // smooth 跟随量（上游 `env` 的 k 是**直接**混合系数）
    cam.smoothBass = env(cam.smoothBass, Math.min(0.82, rb * 0.78 + re * 0.025), 0.28, 0.075)
    cam.smoothMid = env(cam.smoothMid, Math.min(0.68, rm * 0.64 + re * 0.025), 0.18, 0.06)
    cam.smoothTreb = env(cam.smoothTreb, Math.min(0.56, rtBand * 0.54), 0.18, 0.055)
    cam.smoothEnergy = env(cam.smoothEnergy, Math.min(0.72, re), 0.16, 0.055)

    const sample = {
      energy: re,
      low: rb,
      vocal: vocalNorm0,
      melody: rm,
      lowOnset: bassOnset,
      energyOnset,
    }

    // ★ A9：上游先用 sonic 驱动量**抬高**采样再混合（`:493-503`）。
    //   此前本项目写 `Math.max(frame.energy, sample.energy * 0.92)` ——
    //   两项同源，因子惰性（`max(x, x*0.92) === x`），即整段 sonic 驱动没生效。
    //   注：`kickOnset` / `triggerPulse` 在这里按 0..1 用是**忠实上游**的
    //   （上游同样乘小系数），与 A1 不同 —— A1 那处上游用的是连续量。
    const sonicLowOnset = clampRange(
      frame.kickFlux * 0.14 + frame.kickOnset * 0.065 + frame.triggerPulse * 0.085,
      0,
      0.18,
    )
    const sonicLowDrive = clamp01(
      frame.subBass * 0.58 + frame.bass * 0.78 + frame.lowMid * 0.26 + frame.kickEnvelope * 0.24,
    )
    const sonicEnergyDrive = clamp01(frame.energy * 0.88 + sonicLowOnset * 0.74)
    sample.energy = Math.max(sample.energy, sonicEnergyDrive)
    sample.low = Math.max(sample.low, sonicLowDrive)
    sample.lowOnset = Math.max(sample.lowOnset, sonicLowOnset)
    sample.energyOnset = Math.max(sample.energyOnset, sonicLowOnset * 0.62)

    updateCinemaDynamics(Math.max(re, sample.energy * 0.92), Math.max(rb, sample.low * 0.9))
    updateCinemaTrackProfile(sample)
  }

  // ① 实时节拍引擎（命中时返回载荷，未命中返回 null）
  const hitPayload = processRealtimeBeatEngine(step, nowT)

  // ★ A2：引擎命中后必须再过**第二道门槛** `liveFallbackOk`
  //   （上游 `11-main-loop.js:424-429`），不是无条件排事件。
  //
  //   ★ `hitPayload` 判空**不可省**：`livePayload` 是复用对象，引擎未命中时
  //     它仍保留**上一次命中**的值 —— 只看 `liveFallbackOk` 会把同一记命中
  //     在每个分析帧重复排一次事件（镜头抖成一团）。
  //
  //   非 DJ 且无拍点图时（本项目恒定如此，§5.1）：
  //     liveKickFrame = low > 0.42 && rb > 0.34 && bassOnset > 0.048 && energyOnset > 0.008
  //     liveFallbackOk = confidence > 0.68 && strength > 0.62 && low > 0.44
  //                      && (liveKickFrame || score > 0.52)
  //
  //   即"引擎认为有拍"之外，还要**同时**满足高置信、高强度、强低频在场，
  //   以及一记真实的低频起跳帧（或足够高的分数）。缺了这道门槛时，
  //   密集段落会把每个引擎命中都推成事件 —— 镜头明显比上游躁。
  if (hitPayload) {
    const liveKickFrame = hitPayload.low > 0.42 && cam.rb > 0.34 && cam.bassOnset > 0.048 && cam.energyOnset > 0.008
    const liveFallbackOk =
      hitPayload.confidence > 0.68 &&
      hitPayload.strength > 0.62 &&
      hitPayload.low > 0.44 &&
      (liveKickFrame || hitPayload.score > 0.52)

    if (liveFallbackOk) {
      scheduleBeatCamera({
        time: hitPayload.time,
        strength: hitPayload.strength,
        confidence: hitPayload.confidence,
        low: hitPayload.low,
        body: hitPayload.body,
        snap: hitPayload.snap,
        mass: hitPayload.mass,
        sharpness: hitPayload.sharpness,
        tempoAssist: hitPayload.tempoAssist,
        combo: hitPayload.combo,
        impact: hitPayload.impact,
        preview: false,
        primary: true,
      })
    }
  }
}

/**
 * ③：**每帧**推进包络求值，并返回相机可消费的冲击量。
 *
 * 消费者每帧读一次；返回的是**复用的对象**，不要保存引用。
 */
export function stepBeatCameraFrame(dt: number, currentTime: number, playing: boolean): BeatCameraFrame {
  updateBeatCamera(Math.max(0, dt), Math.max(0, currentTime), playing)
  output.punch = beatCam.punch
  output.thetaKick = beatCam.thetaKick
  output.phiKick = beatCam.phiKick
  output.radiusKick = beatCam.radiusKick
  output.rollKick = beatCam.rollKick
  return output
}

/**
 * 只读快照：**整曲自适应**的内部量。
 *
 * ★ 供测试断言用（§5.4 A1 的回归保护）。A1 那个缺陷之所以长期存活，
 *   正是因为它的症状落在 `punchPeak` / `profile.target` 上，而这些量
 *   **对外不可观测** —— 只看 `radiusKick` 的测试在"punchDrive 恒为 1"与
 *   "正常自适应"两种情况下都能通过（振幅被 clamp 吸收了一部分）。
 *
 *   返回复制的普通对象（调用方不该拿到内部引用）。
 */
export function readCinemaProfileSnapshot(): {
  punchPeak: number
  target: number
  scale: number
  dynamicsScale: number
} {
  return {
    punchPeak: profile.punchPeak,
    target: profile.target,
    scale: profile.scale,
    dynamicsScale: dynamics.scale,
  }
}

/**
 * 切歌入场推镜（上游 `primeCinemaAfterTrackStart`，`02-beat-camera-runtime.js:35-47`）。
 *
 * ============================ 为什么需要（§5.4 A8） ============================
 *
 * 上游每次**切歌**（`opts.trackSwitch`）都会在起播时主动打一记：
 *
 *     cinemaDynamics.scale = max(scale, 0.92)
 *     beatCam.lastTriggerAt = min(lastTriggerAt, currentT − 0.48)
 *     beatCam.punch     = max(punch, 0.16)
 *     beatCam.radiusKick = max(radiusKick, 0.085)
 *     beatCam.phiKick    = max(phiKick, 0.0048)
 *     camPunch = max(camPunch, 0.11)
 *
 * 本项目**完全没有这一步** —— 于是切歌时既没有那一下入场推镜，又叠加了
 * `warmupUntil = currentTime + 0.48` 的预热窗口（预热期内不接受命中），
 * 结果是**新歌开头约半秒毫无运镜**。
 *
 * ★ `lastTriggerAt` 那一行的作用正是**抵消预热**：把它推到 0.48 秒前，
 *   于是引擎的 `minGap` 判定立即满足 —— 上游是"先给一记入场冲击、
 *   再进入正常节拍检测"，不是"先哑半秒"。
 *
 * @param currentTime 起播时刻（秒）。上游读 `audio.currentTime`。
 */
export function primeBeatCameraAfterTrackStart(currentTime: number): void {
  const t = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
  dynamics.scale = Math.max(dynamics.scale || 0, 0.92)
  // 抵消预热窗口：让首拍不被 minGap 挡掉
  beatCam.lastTriggerAt = Math.min(beatCam.lastTriggerAt || -10, t - 0.48)
  beatCam.punch = Math.max(beatCam.punch || 0, 0.16)
  beatCam.radiusKick = Math.max(beatCam.radiusKick || 0, 0.085)
  beatCam.phiKick = Math.max(beatCam.phiKick || 0, 0.0048)
  // 上游在此**累加** thetaKick，但本项目 `djMode.active` 恒 false 且
  // theta 只在 DJ 路径累加（见 `updateBeatCamera`）—— 故不加，保持与
  // 正常路径一致（否则会引入上游非 DJ 路径不存在的环绕冲击）。
  // `camPunch` 由调用方通过 `boostCameraPunch(0.11)` 抬高（它在
  // `orbitCameraState` 里，beatCamera 不反向依赖相机模块）。
  primeCamPunch = Math.max(primeCamPunch, 0.11)
}

/** 待消费的入场 `camPunch`（由 `CameraRig` 读走，避免 beatCamera → 相机的反向依赖）。 */
let primeCamPunch = 0

/**
 * 读走入场 `camPunch`（读后清零 —— 一次性）。
 * 消费方：`CameraRig` 在每帧的 `boostCameraPunch` 位置调用。
 */
export function consumePrimeCamPunch(): number {
  const v = primeCamPunch
  primeCamPunch = 0
  return v
}

/**
 * 切歌 / 离开舞台时重置。
 *
 * ★ 必须清空**事件队列**与**整曲自适应**：否则上一首的在飞事件会带进新歌，
 *   且高能歌曲的 `dynamics`/`profile` 会让安静歌曲的运镜偏强（"忽强忽弱"的
 *   另一半成因，与音波监视器的自适应阈值同理）。
 *
 * @param currentTime 当前播放位置（秒）—— 用于设置预热窗口的起点。
 *   上游 `resetRealtimeBeatEngine`（`:239`）把 `warmupUntil` 设为
 *   `currentTime + 0.48`：前 ~0.48 秒（或前 10 个分析帧）不接受命中，
 *   因为此时峰值跟踪器 `subPeak`/`lowPeak` 等还停在初值上，阈值失真。
 */
export function resetBeatCamera(currentTime = 0, preserveMomentum = false): void {
  beatCam.events.length = 0
  beatCam.lastTriggerAt = -10
  beatCam.lastRealtimeAt = -10
  if (!preserveMomentum) {
    beatCam.punch = 0
    beatCam.thetaKick = 0
    beatCam.phiKick = 0
    beatCam.radiusKick = 0
    beatCam.rollKick = 0
  }
  beatCam.prevAudioTime = -1
  rt = createRealtime()
  // 上游：warmupUntil = currentTime + 0.48（非 DJ 档）
  rt.warmupUntil = (Number.isFinite(currentTime) ? currentTime : 0) + 0.48
  dynamics.avg = 0
  dynamics.lowAvg = 0
  dynamics.peak = 0.3
  dynamics.scale = 0.82
  profile.scale = 1
  profile.target = 1
  profile.frames = 0
  profile.energyAvg = 0
  profile.lowAvg = 0
  profile.vocalAvg = 0
  profile.melodyAvg = 0
  profile.punchPeak = 0.1
  profile.density = 0
  // 归一化分析态（峰值跟踪器 / smooth 跟随量 / prevEnergy）也必须归零：
  // 它们是**频段自适应**状态，带着上一首的高峰值会让新歌的 onset 长期为 0
  // （`bassOnset = max(0, rb - smoothBass)` 在 smoothBass 偏高时恒 0）。
  cam.bassPeak = 0.03
  cam.midPeak = 0.026
  cam.treblePeak = 0.018
  cam.energyPeak = 0.03
  cam.smoothBass = 0
  cam.smoothMid = 0
  cam.smoothTreb = 0
  cam.smoothEnergy = 0
  cam.prevEnergy = 0
  // 未消费的入场冲击也要作废（红线 22：模块级状态必须能被清干净）
  primeCamPunch = 0
}
