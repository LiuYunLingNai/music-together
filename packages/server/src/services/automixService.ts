import type {
  AutomixLyricLinePayload,
  AutomixTrackProfile,
  Track,
  TransitionStyle,
} from '@music-together/shared'
import {
  AUTOMIX_DEFAULT_OVERLAP_SEC,
  AUTOMIX_MAX_OVERLAP_SEC,
  AUTOMIX_MIN_OVERLAP_SEC,
  planBlendShape,
  planForMode,
  resolveOverlap,
  settledBpm,
  shapeBlend,
  trimForBalance,
  type KeyRelation,
  type TransitionSettings,
} from '@music-together/shared'
import { roomRepo } from '../repositories/roomRepository.js'
import type { RoomData } from '../repositories/types.js'

/**
 * 自动混音调度。过渡参数的唯一来源是服务端房间配置，所有成员收到同一个
 * 重叠时长，听感因此一致；客户端不自行决定。
 *
 * 风格、长度与落点全部交给上游 `transitionPlanner`：有画像时按 BPM/段落
 * 对齐小节并避开人声，缺画像时退回默认 5 s。
 */
/** 档位直接复用上游 planner 的常量，避免两处漂移。 */
export { AUTOMIX_DEFAULT_OVERLAP_SEC, AUTOMIX_MAX_OVERLAP_SEC, AUTOMIX_MIN_OVERLAP_SEC }

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** 每房间最多保留的曲目画像；过渡只关心当前与下一首。 */
const PROFILE_CAP_PER_ROOM = 32
const profilesByRoom = new Map<string, Map<string, AutomixTrackProfile>>()

/** 歌词只保留规划需要的行时间线，仍按房间 LRU 管理。 */
const LINES_CAP_PER_ROOM = 32
const linesByRoom = new Map<string, Map<string, AutomixLyricLinePayload[]>>()

export function saveTrackLines(
  roomId: string,
  trackId: string,
  lines: AutomixLyricLinePayload[],
): void {
  let roomLines = linesByRoom.get(roomId)
  if (!roomLines) {
    roomLines = new Map()
    linesByRoom.set(roomId, roomLines)
  }
  roomLines.delete(trackId)
  roomLines.set(trackId, lines)
  while (roomLines.size > LINES_CAP_PER_ROOM) {
    const oldest = roomLines.keys().next().value
    if (oldest === undefined) break
    roomLines.delete(oldest)
  }
}

export function getTrackLines(roomId: string, trackId: string): AutomixLyricLinePayload[] | null {
  return linesByRoom.get(roomId)?.get(trackId) ?? null
}

export function saveTrackProfile(roomId: string, trackId: string, profile: AutomixTrackProfile): void {
  let roomProfiles = profilesByRoom.get(roomId)
  if (!roomProfiles) {
    roomProfiles = new Map()
    profilesByRoom.set(roomId, roomProfiles)
  }
  roomProfiles.delete(trackId)
  roomProfiles.set(trackId, profile)
  while (roomProfiles.size > PROFILE_CAP_PER_ROOM) {
    const oldest = roomProfiles.keys().next().value
    if (oldest === undefined) break
    roomProfiles.delete(oldest)
  }
}

export function getTrackProfile(roomId: string, trackId: string): AutomixTrackProfile | null {
  return profilesByRoom.get(roomId)?.get(trackId) ?? null
}

export function clearTrackProfiles(roomId: string): void {
  profilesByRoom.delete(roomId)
  linesByRoom.delete(roomId)
}

export interface AutomixDecision {
  /** 新旧重叠时长。 */
  overlapSec: number
  /** 距离开始过渡的时间。由 plan 的 outStart 反推，而不是简单的「时长 - 重叠」。 */
  delayMs: number
  /** 出歌开始混合的媒体时间。 */
  outStartSec: number
  style: TransitionStyle
  reason: string
  /** 新曲从哪个媒体时间进入（跳过前奏静音），已写入 playState.currentTime。 */
  inStartSec: number
  /** 仅单人房使用的节拍伸缩比（1 = 不伸缩）。 */
  stretch: number
  /** 过渡期间两端 EQ 的倾斜（dB），[出, 入]。 */
  tiltDb: [number, number]
  echoThrow: boolean
  /** 三频段交接位置（0..1），由出歌尾奏电平推导并吸附到拍点。 */
  crossover: number
  bpm: number | null
  /** `shapeBlend` 的三频段形状。 */
  shapeBands: boolean
  sweepOut: boolean
  together: number
  /** 出歌平衡修正（dB，正数表示压低出歌）。 */
  trimDb: number
  /** 两侧整曲参考电平（ReplayGain 之前）；客户端叠上各 deck 的 ReplayGain 后算修正。 */
  outgoingReferenceDb: number | null
  incomingReferenceDb: number | null
  relation: KeyRelation
  outgoingBarSec: number | null
  incomingBarSec: number | null
  outgoingDownbeatOffset: number | null
  incomingSectionStart: number | null
  incomingLeadInSec: number | null
  /** performance 模式的 build-up 强度（0.25..1），null 表示不执行。 */
  expansion: number | null
  /** 出歌每小节拍数，供客户端按同一网格铺 build。 */
  outgoingBeatsPerBar: number | null
}

/** 两首都测到整曲 program loudness 时才用它，否则用整曲平均响度。 */
function wholeTrackLevel(
  profile: AutomixTrackProfile,
  other: AutomixTrackProfile | null,
): number {
  const bothMeasured =
    typeof profile.programLoudness === 'number' &&
    typeof other?.programLoudness === 'number'
  return bothMeasured ? profile.programLoudness! : profile.loudness
}

/** 当前播放位置（秒），以服务端时间为锚点。 */
function playheadSec(room: RoomData, now: number): number {
  const { currentTime, serverTimestamp } = room.playState
  const elapsed = Math.max(0, (now - serverTimestamp) / 1000)
  return currentTime + elapsed
}

/** 上游 `waitToGrid`：媒体位置到下一格拍点还差多少墙钟秒。 */
function waitToGrid(offset: number, period: number, fromMedia: number, rate: number): number | null {
  if (!(period > 0) || !(rate > 0)) return null
  const next = offset + Math.ceil((fromMedia - offset) / period) * period
  return (next - fromMedia) / rate
}

/**
 * 决定这次切歌的重叠时长与延迟。返回 null 表示不接管：未开启、时长未知、
 * 已经进入尾声或没有后继曲目。
 */
export function decideAutomix(
  room: RoomData,
  options: { now?: number; nextTrack?: Track | null } = {},
): AutomixDecision | null {
  if (!room.automixEnabled) return null
  if (!room.playState.isPlaying) return null
  if (!room.currentTrack || !options.nextTrack) return null
  const duration = room.currentTrack.duration
  if (!Number.isFinite(duration) || duration <= AUTOMIX_MIN_OVERLAP_SEC * 2) return null

  const now = options.now ?? Date.now()
  const playhead = playheadSec(room, now)
  const remaining = duration - playhead
  if (remaining <= AUTOMIX_MIN_OVERLAP_SEC) return null

  // 上游 planner 决定风格、长度与落点：优先放在无人声窗口，并对齐小节。
  // 画像缺失时它退回默认 5 s，仍然比本地近似更接近上游行为。
  const fromProfile = getTrackProfile(room.id, room.currentTrack.id)
  const toProfile = getTrackProfile(room.id, options.nextTrack.id)
  const lineEvidence = getTrackLines(room.id, room.currentTrack.id)
  const fromLines = lineEvidence
    ? lineEvidence.map((line) => ({
        startTime: line.startTime,
        endTime: line.endTime,
        fullText: line.fullText,
        words: [],
      }))
    : null
  const outgoingBpm = settledBpm(fromProfile?.bpm ?? null, fromProfile?.outroBpm ?? null)
  const settings: TransitionSettings = {
    mode: room.transitionMode,
    crossfadeMaxSec: room.crossfadeMaxSec,
    performance: room.automixPerformance,
  }
  const plan = planForMode(
    settings,
    { duration, lines: fromLines, profile: fromProfile },
    { duration: options.nextTrack.duration, lines: null, profile: toProfile },
    outgoingBpm,
    playhead,
  )
  // hardCut 表示没有可混合的余量：不提前接管，交给正常的播完切歌。
  if (plan.kind === 'hardCut' || !(plan.overlap > 0)) return null

  const periodSec = outgoingBpm ? 60 / outgoingBpm : null
  const nextBeatIn = periodSec && fromProfile
    ? waitToGrid(fromProfile.beatOffset % periodSec, periodSec, plan.outStart, plan.stretch)
    : null
  const overlapBase = resolveOverlap(plan, remaining)
  const fade = planBlendShape({
    overlap: overlapBase,
    outgoingDb: fromProfile?.tailDb ?? null,
    nextBeatIn,
    periodSec,
    minOverlap: plan.minOverlap,
    maxOverlap: remaining,
  })
  const shape = shapeBlend({
    style: plan.style,
    room: overlapBase,
    overlap: fade.overlap,
    crossover: fade.crossover,
    nextBeatIn,
    periodSec,
    incomingLeadIn: toProfile?.leadIn ?? null,
  })
  // 等待拍点由服务端吸收：新曲真正起播的时刻 = outStart + hold。
  const startSec = plan.outStart + shape.hold
  const overlapSec = Math.min(shape.overlap, Math.max(0, duration - startSec))
  if (!(overlapSec > 0)) return null

  return {
    overlapSec,
    delayMs: Math.max(0, (startSec - playhead) * 1000),
    outStartSec: startSec,
    style: plan.style,
    reason: plan.reason,
    inStartSec: Math.max(0, plan.inStart),
    stretch: plan.stretch,
    tiltDb: plan.tiltDb,
    echoThrow: plan.echoThrow,
    crossover: fade.crossover,
    bpm: outgoingBpm,
    shapeBands: shape.shapeBands,
    sweepOut: shape.sweepOut,
    together: shape.together,
    // 平衡修正修的是两首母带的整体响度差，不是尾奏/前奏这一小段；
    // 只有两侧都测到整曲 program loudness 时才用它，否则退回整曲平均值。
    trimDb:
      fromProfile && toProfile
        ? trimForBalance(
            wholeTrackLevel(fromProfile, toProfile),
            wholeTrackLevel(toProfile, fromProfile),
          )
        : 0,
    outgoingReferenceDb: fromProfile ? wholeTrackLevel(fromProfile, toProfile) : null,
    incomingReferenceDb: toProfile ? wholeTrackLevel(toProfile, fromProfile) : null,
    relation: plan.relation,
    outgoingBarSec:
      outgoingBpm && fromProfile ? (60 / outgoingBpm) * (fromProfile.beatsPerBar || 4) : null,
    incomingBarSec:
      toProfile?.bpm ? (60 / toProfile.bpm) * (toProfile.beatsPerBar || 4) : null,
    outgoingDownbeatOffset: fromProfile?.downbeatOffset ?? null,
    incomingSectionStart: toProfile?.sectionStart ?? null,
    incomingLeadInSec: toProfile?.leadIn ?? null,
    expansion: plan.expansion ?? null,
    outgoingBeatsPerBar: fromProfile?.beatsPerBar ?? null,
  }
}

export function cancelAutomix(roomId: string): void {
  const timer = timers.get(roomId)
  if (timer) clearTimeout(timer)
  timers.delete(roomId)
}

/**
 * 重新安排房间的过渡点。已有定时器会被取消，因此可以在播放、恢复、拖动和
 * 切歌后重复调用。
 */
export function scheduleAutomix(
  roomId: string,
  nextTrack: Track | null,
  advance: (decision: AutomixDecision, trackId: string) => void,
  /** 排定后回调，用于把落点广播给客户端提前准备（如分轨分离）。 */
  onScheduled?: (decision: AutomixDecision, fromTrackId: string, toTrackId: string) => void,
): void {
  cancelAutomix(roomId)
  const room = roomRepo.get(roomId)
  if (!room) return
  const decision = decideAutomix(room, { nextTrack })
  if (!decision) return
  const trackId = room.currentTrack?.id
  if (!trackId) return
  if (nextTrack) onScheduled?.(decision, trackId, nextTrack.id)

  const timer = setTimeout(() => {
    timers.delete(roomId)
    const current = roomRepo.get(roomId)
    // 排练期间状态可能已变（暂停、换歌、关掉开关、房间销毁）。
    if (!current || !current.automixEnabled) return
    if (!current.playState.isPlaying) return
    if (current.currentTrack?.id !== trackId) return
    advance(decision, trackId)
  }, decision.delayMs)
  // 不阻止进程退出。
  timer.unref?.()
  timers.set(roomId, timer)
}

/** 清理房间定时器由 `playerService.cleanupRoom` 统一调用。 */