/**
 * 拍点图运行时 —— 上游 `03-beat/04-beat-map-runtime.js` 的忠实移植。
 *
 * ## 这是整个离线分析的视觉价值所在
 *
 * 分析产出的拍点图本身不动画面；真正改变观感的是这里的**两条光标**：
 *
 *   · `cameraCursor` 走 `cameraBeats`，判据 `beatTime > t + lookahead` 才停
 *     ⇒ 事件在自己时刻**前 75ms** 就被排进 `beatCamera` 的事件队列，
 *     attack 包络（最短 14ms）因此能在拍点上精确起跳。
 *   · `pulseCursor` 走 `pulseBeats`，判据 `<= t`（不提前）
 *     ⇒ 冲击脉冲在拍点**当刻**触发，与画面的"砸下去"对齐。
 *
 * 实时路径（`beatCamera.ts` 的 `processRealtimeBeatEngine`）只能在能量
 * 越过阈值**之后**才命中，相位系统性偏晚；这两条光标把相位对准了。
 *
 * ## 让位规则（上游 `:84-100`）
 *
 * 拍点图与实时引擎会同时在跑，不能双份触发。上游的仲裁是：
 *
 *   gridTimingLocked = tempoSource === 'music-tempo' && cameraBeats.length >= 4
 *   liveFreshWindow  = max(0.50, rtBeat.tempoGap × 1.18)
 *   realtimeHasLock  = rtBeat.lastHitAt > 0 && (t − lastHitAt) < liveFreshWindow
 *   触发条件         = gridTimingLocked || !realtimeHasLock
 *
 * 读法：**网格锁定的拍点图优先**（music-tempo 的网格比实时检测准）；
 * 没锁定时，只要实时引擎还"新鲜"（刚命中过）就让位给实时，避免双份。
 */

import type { BeatMap, BeatMapEvent, PulseBeat } from './beatAnalysisTypes'

/** 上游 `beatCam.lookahead`（`00-state/03-beat-dj-state.js:39`）。 */
export const BEAT_MAP_LOOKAHEAD = 0.075

/** 拍点图光标状态 —— 上游 `beatCam.nextIdx` 与 `beatMapNextIdx` 两个全局。 */
export interface BeatMapCursor {
  /** 运镜光标（上游 `beatCam.nextIdx`）。 */
  camera: number
  /** 脉冲光标（上游 `beatMapNextIdx`）。 */
  pulse: number
}

export function createBeatMapCursor(): BeatMapCursor {
  return { camera: 0, pulse: 0 }
}

/** 上游 `beatEventTime`：事件可能是裸数字或带 `time` 的对象。 */
export function beatEventTime(beat: number | { time: number }): number {
  return typeof beat === 'number' ? beat : beat.time
}

/** 上游 `tickBeatMap` 里取出的两个事件序列（容错多种字段名）。 */
export function beatMapCameraEvents(map: BeatMap): BeatMapEvent[] {
  return map.cameraBeats || map.beats || []
}

export function beatMapPulseEvents(map: BeatMap): PulseBeat[] {
  return map.pulseBeats || []
}

/**
 * 把光标重新对齐到某个播放时刻 —— 上游 `syncBeatMapPlaybackCursor`（`:36-47`）。
 *
 * 用在拍点图刚交接、以及用户拖动进度条之后：从头线性扫到第一个
 * 时间 >= t 的事件。上游也是线性扫（`while (… < t) idx++`），
 * 不做二分 —— 拍点图最多几千个事件，一次扫描可忽略。
 *
 * ★ 上游这里对 `pulseEvents` 用 `beatEventTime(…) < t` 严格小于，
 *   因此恰好落在 `t` 上的脉冲**会**被保留给下一次 tick 触发。
 */
export function syncBeatMapCursor(cursor: BeatMapCursor, map: BeatMap | null, t: number): void {
  const time = Number.isFinite(t) ? t : 0
  cursor.pulse = 0
  cursor.camera = 0
  if (!map) return
  const pulseEvents = beatMapPulseEvents(map)
  while (cursor.pulse < pulseEvents.length && beatEventTime(pulseEvents[cursor.pulse]) < time) cursor.pulse++
  // ★ 上游 `syncBeatMapPlaybackCursor` 只推进 `beatMapNextIdx`（脉冲光标），
  //   运镜光标 `beatCam.nextIdx` 由随后的 `alignBeatCameraCursorToTime` /
  //   `syncBeatCameraToTime` 推进（`01-scene/02-beat-camera-runtime.js`）。
  //   本项目把两者合在这里：语义相同，且避免把 `beatCam` 的内部光标
  //   暴露成可变导出。判据与上游 `alignBeatCameraCursorToTime` 一致。
  const cameraEvents = beatMapCameraEvents(map)
  while (cursor.camera < cameraEvents.length && beatEventTime(cameraEvents[cursor.camera]) < time) cursor.camera++
}

/** `tickBeatMap` 的一次输出：本次要排的运镜事件与要触发的脉冲。 */
export interface BeatMapTickResult {
  /** 需要排进 `beatCamera` 事件队列的运镜拍点（已按 lookahead 提前取出）。 */
  cameraBeats: BeatMapEvent[]
  /** 需要立即触发的冲击脉冲。 */
  pulseBeats: PulseBeat[]
}

/**
 * 实时引擎的锁状态 —— 由 `beatCamera` 侧提供（上游直接读 `rtBeat` 全局）。
 */
export interface RealtimeLockState {
  /** 上游 `rtBeat.lastHitAt`。 */
  lastHitAt: number
  /** 上游 `rtBeat.tempoGap`。 */
  tempoGap: number
}

/**
 * 每帧推进拍点图 —— 上游 `tickBeatMap`（`:84-103`）。
 *
 * 返回本次要消费的事件；不直接调 `beatCamera`，由调用方注入 ——
 * 这样本模块不依赖 `beatCamera`，可独立单测。
 *
 * ★ 上游的 `partialUntilSec` 提前返回只在 DJ 分支
 *   （`tickPodcastDjBeatMap`）出现，非 DJ 的 `tickBeatMap` 没有该判断，
 *   这里照上游不做。
 */
export function tickBeatMap(
  cursor: BeatMapCursor,
  map: BeatMap | null,
  t: number,
  playing: boolean,
  realtime: RealtimeLockState,
): BeatMapTickResult {
  const empty: BeatMapTickResult = { cameraBeats: [], pulseBeats: [] }
  if (!map || !playing) return empty
  const time = Number.isFinite(t) ? t : 0
  const cameraEvents = beatMapCameraEvents(map)
  const pulseEvents = beatMapPulseEvents(map)

  // 上游 `:88-91`：网格锁定优先，否则实时新鲜就让位。
  const gridTimingLocked = map.tempoSource === 'music-tempo' && cameraEvents.length >= 4
  const liveFreshWindow = Math.max(0.5, realtime.tempoGap ? realtime.tempoGap * 1.18 : 0.5)
  const realtimeHasLock = realtime.lastHitAt > 0 && time - realtime.lastHitAt < liveFreshWindow
  const mayTrigger = gridTimingLocked || !realtimeHasLock

  const outCamera: BeatMapEvent[] = []
  const outPulse: PulseBeat[] = []

  // ★ 光标**无条件推进**，只有触发受 `mayTrigger` 门控（上游 `:92-97`
  //   同样把 `beatCam.nextIdx++` 放在 if 之外）。否则让位期间光标会卡住，
  //   让位结束后一口气补触发几十个历史拍点。
  while (cursor.camera < cameraEvents.length) {
    const beat = cameraEvents[cursor.camera]
    const beatTime = beatEventTime(beat)
    if (beatTime > time + BEAT_MAP_LOOKAHEAD) break
    if (mayTrigger) outCamera.push(beat)
    cursor.camera++
  }
  while (cursor.pulse < pulseEvents.length && beatEventTime(pulseEvents[cursor.pulse]) <= time) {
    if (mayTrigger) outPulse.push(pulseEvents[cursor.pulse])
    cursor.pulse++
  }

  return { cameraBeats: outCamera, pulseBeats: outPulse }
}

/**
 * 冲击脉冲的强度计算 —— 上游 `triggerScheduledBeat`（`:105-123`），
 * DJ 分支已剔除。
 *
 * 两道门槛（上游 `:108-109`）：
 *   · `impact < 0.18 && strength < 0.52` ⇒ 丢弃（太弱，不值得砸一下）
 *   · 整曲画像 `trackScale < 0.52` 且 `impact < 0.46 && strength < 0.74`
 *     ⇒ 丢弃（安静歌里只留真正的重拍）
 *
 * 返回 null 表示该拍不触发；否则返回要并入 `scheduledBeatPulse` 的值
 * （上游是 `max(scheduledBeatPulse, pulse)`，由调用方合并）。
 */
export function scheduledBeatPulseAmount(
  beat: PulseBeat | number,
  trackScale: number,
  dynamicsScale: (extra: number) => number,
): number | null {
  const strength =
    typeof beat === 'number' ? 0.42 : Math.max(0, Math.min(1, beat && beat.strength != null ? beat.strength : 0.42))
  const impact =
    typeof beat === 'number' ? strength : Math.max(0, Math.min(1, beat && beat.impact != null ? beat.impact : strength))
  if (impact < 0.18 && strength < 0.52) return null
  if ((trackScale || 1) < 0.52 && impact < 0.46 && strength < 0.74) return null
  const body = typeof beat === 'number' ? 0 : Math.max(0, Math.min(1, beat && beat.body != null ? beat.body : 0))
  const combo = typeof beat === 'number' ? null : beat && beat.combo
  const comboLift = combo === 'downbeat' ? 0.08 : combo === 'drop' ? 0.04 : 0
  const dynScale = dynamicsScale(0.88 + impact * 0.16)
  // ★ 上游此处还有 `if (djPulse)` 的另一套系数与 0.92 上限；本项目无 DJ 源，
  //   取非 DJ 分支：系数 `(0.14 + s×0.46 + i×0.18 + b×0.08 + lift)`，上限 0.78。
  const pulse = (0.14 + strength * 0.46 + impact * 0.18 + body * 0.08 + comboLift) * dynScale
  return Math.min(0.78, pulse)
}

/**
 * 从拍点图反推整曲画像 —— 上游 `applyCinemaProfileFromBeatMap`
 * （`01-scene/02-beat-camera-runtime.js:202-221`）。
 *
 * 拍点图一到手就能算出"这首歌有多炸"：平均冲击、平均低频占比、拍点密度、
 * 主拍比例四项加权，得到 `target`，再乘歌名提示 `nameHint`。
 *
 * ★ 收敛是**不对称**的（上游 `:220`）：
 *     scale += (target − scale) × (target < scale ? 0.55 : 0.22)
 *   往下收得快（0.55）、往上涨得慢（0.22）—— 宁可先保守，避免安静段
 *   被一次高估的 target 顶上去。
 *
 * 返回要写入 `cinemaTrackProfile` 的 `{ density, target }`；
 * `scale` 的收敛由调用方做（它持有当前 scale）。
 */
export function cinemaProfileFromBeatMap(
  map: BeatMap | null,
  nameHint: number,
): { density: number; target: number } | null {
  if (!map || !map.duration) return null
  const events = beatMapCameraEvents(map).filter((b) => b && typeof b !== 'number' && b.camera !== false)
  if (!events.length) return null
  let sumImpact = 0
  let sumLow = 0
  let primary = 0
  events.forEach((b) => {
    sumImpact += Math.max(b.impact || 0, b.strength || 0)
    sumLow += b.low || 0
    if (b.primary !== false) primary++
  })
  const avgImpact = sumImpact / events.length
  const avgLow = sumLow / events.length
  const density = events.length / Math.max(20, map.duration)
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  let target =
    0.44 +
    clamp01((avgImpact - 0.2) / 0.55) * 0.38 +
    clamp01((avgLow - 0.24) / 0.48) * 0.18 +
    clamp01((density - 0.45) / 1.65) * 0.2 +
    clamp01(primary / Math.max(1, events.length)) * 0.08
  target *= nameHint || 1
  target = Math.max(0.28, Math.min(1.12, target))
  return { density, target }
}

/**
 * 画像收敛的一步 —— 上游 `:220` 的不对称跟随。
 */
export function convergeCinemaScale(scale: number, target: number): number {
  return scale + (target - scale) * (target < scale ? 0.55 : 0.22)
}
