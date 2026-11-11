import type {
  AudioQuality,
  MusicSource,
  PlayMode,
  PlayState,
  PlaybackFailure,
  ScheduledPlayState,
  Track,
} from '@music-together/shared'
import { EVENTS, NTP, TIMING, clampPlaybackPosition, nextPlaybackRevision } from '@music-together/shared'
import { roomRepo } from '../repositories/roomRepository.js'
import { nanoid } from 'nanoid'
import { musicProvider } from './musicProvider.js'
import { resolveStream, resolveStreamDetailed } from './streamResolutionService.js'
import { decideFailureAction, toPlaybackFailure } from './playbackFailure.js'
import * as queueService from './queueService.js'
import * as trackFallbackService from './trackFallbackService.js'
import * as authService from './authService.js'
import { estimateCurrentTime, estimateCurrentTimeAt } from './syncService.js'
import { broadcastRoomList } from './roomLifecycleService.js'
import { toPublicRoomState } from '../utils/roomUtils.js'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import type { RoomData } from '../repositories/types.js'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { degradeQuality, getEffectiveQuality, providerQualityRank, type MembershipTier } from './audioQualityPolicy.js'
import * as listeningReportService from './listeningReportService.js'
import { isRoamingTrack, roamingService, shouldPreferRoamingForNext } from './roamingService.js'
import * as automixService from './automixService.js'
import { shouldRemovePlayedTrackAfterAdvance } from './queueNavigation.js'
import { isStreamUrlExpired } from './streamUrlLifetime.js'
import {
  recordAutoFallbackAttempt,
  recordAutoFallbackFailed,
  recordAutoFallbackSuccess,
  recordSourceSwitch,
  recordSourceSwitchFailed,
} from './playbackMetrics.js'

// ---------------------------------------------------------------------------
// Per-room mutex for playTrackInRoom (prevents concurrent execution)
// ---------------------------------------------------------------------------

const playMutexes = new Map<string, Promise<unknown>>()
const lastStreamUrlRefreshAt = new Map<string, number>()

/** Persist a recent position snapshot so a process restart can resume close to the last position. */
export function persistPlaybackSnapshots(serverTime = Date.now()): void {
  for (const room of roomRepo.getAll().values()) {
    if (!room.permanent || !room.currentTrack || !room.playState.isPlaying) continue
    room.playState = {
      ...room.playState,
      currentTime: estimateCurrentTimeAt(room.id, serverTime),
      serverTimestamp: serverTime,
    }
    roomRepo.persist(room.id)
  }
}

// ---------------------------------------------------------------------------
// Auto fallback cooldown (prevents repeated attempts / ping-pong)
// ---------------------------------------------------------------------------

const autoFallbackCooldown = new Map<string, number>()

function canAutoFallback(roomId: string, trackId: string): boolean {
  const key = `${roomId}:${trackId}`
  const until = autoFallbackCooldown.get(key)
  if (!until) return true
  if (Date.now() >= until) {
    autoFallbackCooldown.delete(key)
    return true
  }
  return false
}

function markAutoFallback(roomId: string, trackId: string, ms: number): void {
  const key = `${roomId}:${trackId}`
  autoFallbackCooldown.set(key, Date.now() + ms)
}

function withPlayMutex<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const prev = playMutexes.get(roomId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  playMutexes.set(roomId, next)
  // Cleanup entry when chain settles to avoid unbounded growth
  const cleanup = () => {
    if (playMutexes.get(roomId) === next) playMutexes.delete(roomId)
  }
  void next.then(cleanup, cleanup)
  return next
}

// ---------------------------------------------------------------------------
// Scheduled execution helpers
// ---------------------------------------------------------------------------

/**
 * Compute the future server-time at which all clients should execute an
 * action, based on the P90 RTT in the room.
 */
/** 上游 `MAX_ALIGN_HOLD_SEC`：为对准计划开混点最多等待的时长。 */
const AUTOMIX_MAX_ALIGN_HOLD_MS = 1000

function getScheduleTime(roomId: string): number {
  const maxRTT = roomRepo.getP90RTT(roomId)
  const delay = Math.min(Math.max(maxRTT * 1.5 + 100, NTP.MIN_SCHEDULE_DELAY_MS), NTP.MAX_SCHEDULE_DELAY_MS)
  return Date.now() + delay
}

/** Build a ScheduledPlayState from a plain PlayState.
 *  Accepts an optional pre-computed scheduleTime to keep room state and
 *  broadcast payload consistent (same timestamp for both). */
function scheduled(ps: PlayState, roomId: string, scheduleTime?: number): ScheduledPlayState {
  return { ...ps, serverTimeToExecute: scheduleTime ?? getScheduleTime(roomId) }
}

// ---------------------------------------------------------------------------
// Audio quality fallback
// ---------------------------------------------------------------------------

interface ResolvedStreamUrl {
  url: string
  /** Quality tier attempted by our fallback chain. */
  attemptedBitrate: AudioQuality
  /** Bitrate actually reported/selected by the upstream provider. */
  actualBitrate: number | null
  actualQuality?: AudioQuality
  providerFormat?: string
  streamFormat?: Track['streamFormat']
  fileSize?: number
  requiresServerProxy?: boolean
  fromCache: boolean
}

const SOURCE_LABELS: Record<MusicSource, string> = {
  netease: '网易云音乐',
  tencent: 'QQ 音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
  bilibili: 'B站',
}

function formatAudioQuality(bitrate: AudioQuality | number | null): string {
  if (bitrate === null) return '未知（上游未返回）'
  const labels: Partial<Record<AudioQuality, string>> = {
    highest: '尽量高',
    netease_dolby: '杜比全景声',
    netease_hires: 'Hi-Res',
    netease_jyeffect: '高清臻音',
    netease_master: '超清母带',
    netease_spatial: '沉浸环绕声',
    tencent_flac: '无损',
    tencent_master: '臻品母带',
    kugou_hires: '酷狗 Hi-Res',
    kugou_master: '酷狗蝰蛇母带 2.0',
    bilibili_64: 'B站 64K',
    bilibili_132: 'B站 132K',
    bilibili_192: 'B站 192K',
    bilibili_hires: 'B站 Hi-Res',
  }
  if (typeof bitrate === 'string') return labels[bitrate] ?? bitrate
  if (bitrate === 999) return '无损'
  return `${bitrate} kbps`
}

function formatResolvedAudioQuality(stream: ResolvedStreamUrl): string {
  const quality = formatAudioQuality(stream.actualQuality ?? stream.actualBitrate)
  const details = [
    stream.providerFormat,
    stream.actualBitrate !== null ? `平均约 ${stream.actualBitrate} kbps` : null,
  ].filter(Boolean)
  return details.length ? `${quality}（${details.join('，')}）` : quality
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '未知'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function isQualityDowngraded(source: MusicSource, requested: AudioQuality, stream: ResolvedStreamUrl): boolean {
  if (requested === 'highest') return false

  const desired = getEffectiveQuality(source, requested, 2)
  if (providerQualityRank(source, stream.attemptedBitrate) < providerQualityRank(source, desired)) return true
  if (stream.actualQuality !== undefined) {
    return providerQualityRank(source, stream.actualQuality) < providerQualityRank(source, stream.attemptedBitrate)
  }
  if (typeof stream.attemptedBitrate === 'number' && stream.actualBitrate !== null) {
    return stream.actualBitrate < stream.attemptedBitrate
  }
  return false
}

/**
 * Resolve one provider quality after applying the current membership cap.
 * Providers select the best track format at or below that quality in one request.
 */
async function resolveStreamUrl(
  source: MusicSource,
  urlId: string,
  bitrate: AudioQuality,
  cookie?: string,
  forceRefresh = false,
  vipType: MembershipTier = 0,
): Promise<ResolvedStreamUrl | null> {
  return (await resolveStreamUrlDetailed(source, urlId, bitrate, cookie, forceRefresh, vipType)).result
}

async function resolveStreamUrlDetailed(
  source: MusicSource,
  urlId: string,
  bitrate: AudioQuality,
  cookie?: string,
  forceRefresh = false,
  vipType: MembershipTier = 0,
): Promise<{
  result: ResolvedStreamUrl | null
  failure: import('./musicProvider.js').ProviderStreamFailure | null
}> {
  const attemptedBitrate = getEffectiveQuality(source, bitrate, vipType)
  if (attemptedBitrate !== bitrate && bitrate !== 'highest') {
    logger.info('已根据平台会员等级调整请求音质', {
      source,
      urlId,
      requestedBitrate: bitrate,
      attemptedBitrate,
      vipType,
    })
  }
  const outcome = await resolveStreamDetailed(source, urlId, attemptedBitrate, { cookie, forceRefresh, vipType })
  return {
    result: outcome.result ? { ...outcome.result, attemptedBitrate } : null,
    failure: outcome.failure,
  }
}

const failureSkipTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearFailureSkip(roomId: string): void {
  const timer = failureSkipTimers.get(roomId)
  if (!timer) return
  clearTimeout(timer)
  failureSkipTimers.delete(roomId)
}

function scheduleFailureSkip(io: TypedServer, roomId: string, trackId: string, delayMs: number): void {
  clearFailureSkip(roomId)
  const timer = setTimeout(() => {
    failureSkipTimers.delete(roomId)
    const room = roomRepo.get(roomId)
    if (!room || room.currentTrack?.id !== trackId) return
    void playNextTrackInRoom(io, roomId, room.playMode, { expectedTrackId: trackId, skipDebounce: true })
  }, delayMs)
  failureSkipTimers.set(roomId, timer)
}

/** Park the room on the failed track and tell every client why it stopped. */
function publishPlaybackFailure(
  io: TypedServer,
  roomId: string,
  room: RoomData,
  track: Track,
  failure: PlaybackFailure,
): void {
  const action = decideFailureAction(failure, true)
  room.currentTrack = track
  room.playState = {
    isPlaying: false,
    currentTime: 0,
    serverTimestamp: Date.now(),
    revision: nextPlaybackRevision(room.playState),
  }
  roomRepo.persist(roomId)
  io.to(roomId).emit(EVENTS.PLAYER_PAUSE, {
    playState: { ...room.playState, serverTimeToExecute: room.playState.serverTimestamp },
  })
  io.to(roomId).emit(EVENTS.PLAYER_PLAYBACK_FAILURE, {
    trackId: track.id,
    track,
    failure,
    nextAction: action.nextAction,
    ...(action.autoActionInMs ? { autoActionInMs: action.autoActionInMs } : {}),
  })
  io.to(roomId).emit(EVENTS.ROOM_STATE, toPublicRoomState(room))
  broadcastRoomList(io)
  if (action.nextAction === 'skip' && action.autoActionInMs) {
    scheduleFailureSkip(io, roomId, track.id, action.autoActionInMs)
  }
}

/**
 * 预热下一首的播放地址：只填 provider 的 URL 缓存，不下载音频、不改房间状态。
 * 切歌时 `_playTrackInRoom` 仍会重新解析，但命中缓存后省掉一次上游往返。
 * Bilibili 的 DASH 地址每次都要新解析，带 cookie 的 VIP 地址也不会进缓存，
 * 这两类直接跳过。
 */
/**
 * 队列里只剩少量漫游曲目时后台补一批，避免下一首切歌时同步等推荐接口。
 * 只有“当前曲之后全是漫游曲目”才补，用户自己的点歌仍然优先。
 */
const roamingRefillTasks = new Map<string, Promise<Track[]>>()

function refillRoamingTail(io: TypedServer, roomId: string): Promise<Track[]> {
  const existing = roamingRefillTasks.get(roomId)
  if (existing) return existing

  const task = (async (): Promise<Track[]> => {
    const room = roomRepo.get(roomId)
    if (!room?.roamingEnabled) return []
    const currentIndex = room.currentTrack
      ? room.queue.findIndex((track) => track.id === room.currentTrack?.id)
      : -1
    const upcoming = room.queue.slice(currentIndex + 1)
    if (upcoming.some((track) => !isRoamingTrack(track))) return []
    if (upcoming.filter((track) => isRoamingTrack(track)).length > 2) return []

    try {
      const tracks = await roamingService.getBatch(room)
      if (tracks.length === 0) return []
      const added = queueService.addBatchTracks(roomId, tracks)
      if (added === 0) return []
      const updated = roomRepo.get(roomId)
      if (updated) io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: updated.queue })
      return tracks.slice(0, added)
    } catch (error) {
      logger.warn('房间漫游后台补货失败', { roomId, source: room.roamingSource, error })
      return []
    }
  })()

  roamingRefillTasks.set(roomId, task)
  void task.finally(() => {
    if (roamingRefillTasks.get(roomId) === task) roamingRefillTasks.delete(roomId)
  })
  return task
}

async function preResolveNextStream(roomId: string): Promise<void> {
  try {
    const room = roomRepo.get(roomId)
    if (!room) return
    const next = queueService.getNextTrack(roomId, room.playMode)
    if (!next || next.id === room.currentTrack?.id || next.source === 'bilibili') return
    const auth = authService.getBestAuth(next.source, roomId)
    if (auth?.cookie) return
    // 这是后台预热，不是用户点歌：必须走 prefetch 语义，否则上游 5xx 时
    // 会把整个平台的点歌一起冷却。
    await resolveStream(next.source, next.urlId, room.audioQuality, { purpose: 'prefetch' })
  } catch (error) {
    logger.debug('下一首播放地址预解析失败', { roomId, error })
  }
}

/**
 * Re-arm the room's transition point from the current play state. `loop-one`
 * never crossfades into itself; with roaming enabled the batch refill will
 * normally leave a queued successor behind.
 */
function rescheduleAutomix(io: TypedServer, roomId: string): void {
  const room = roomRepo.get(roomId)
  if (!room) return
  const next = room.playMode === 'loop-one' ? null : queueService.getNextTrack(room.id, room.playMode)
  const successor = next && next.id !== room.currentTrack?.id ? next : null
  automixService.scheduleAutomix(
    roomId,
    successor,
    (decision, trackId) => {
      void playNextTrackInRoom(io, roomId, room.playMode, {
        skipDebounce: true,
        expectedTrackId: trackId,
        automixOverlapSec: decision.overlapSec,
        automixStyle: decision.style,
        automixInStartSec: decision.inStartSec,
        automixStretch: decision.stretch,
        automixTiltDb: decision.tiltDb,
        automixEchoThrow: decision.echoThrow,
        automixCrossover: decision.crossover,
        automixBpm: decision.bpm,
        automixShapeBands: decision.shapeBands,
        automixSweepOut: decision.sweepOut,
        automixTogether: decision.together,
        automixTrimDb: decision.trimDb,
        automixOutgoingReferenceDb: decision.outgoingReferenceDb,
        automixIncomingReferenceDb: decision.incomingReferenceDb,
        automixRelation: decision.relation,
        automixOutgoingBarSec: decision.outgoingBarSec,
        automixIncomingBarSec: decision.incomingBarSec,
        automixOutgoingDownbeatOffset: decision.outgoingDownbeatOffset,
        automixIncomingSectionStart: decision.incomingSectionStart,
        automixIncomingLeadInSec: decision.incomingLeadInSec,
        automixExpansion: decision.expansion,
        automixOutgoingBeatsPerBar: decision.outgoingBeatsPerBar,
        automixDueAt: decision.dueAt,
      })
    },
    (decision, fromTrackId, toTrackId) => {
      io.to(roomId).emit(EVENTS.PLAYER_AUTOMIX_PLAN, {
        fromTrackId,
        toTrackId,
        overlapMs: Math.round(decision.overlapSec * 1000),
        outStartMs: Math.round(decision.outStartSec * 1000),
        inStartMs: Math.round(decision.inStartSec * 1000),
        style: decision.style,
        stretch: decision.stretch,
        tiltDb: decision.tiltDb,
        echoThrow: decision.echoThrow,
        crossover: decision.crossover,
        bpm: decision.bpm,
        shapeBands: decision.shapeBands,
        sweepOut: decision.sweepOut,
        together: decision.together,
        trimDb: decision.trimDb,
        relation: decision.relation,
        outgoingBarSec: decision.outgoingBarSec,
        incomingBarSec: decision.incomingBarSec,
        outgoingDownbeatOffset: decision.outgoingDownbeatOffset,
        incomingSectionStart: decision.incomingSectionStart,
        incomingLeadInSec: decision.incomingLeadInSec,
        expansion: decision.expansion,
        outgoingBeatsPerBar: decision.outgoingBeatsPerBar,
        reason: decision.reason,
      })
    },
  )
}

/**
 * 队列在播放期间新增曲目时补排过渡点；没有后继时原本不会安排定时器。
 */
export function refreshAutomixScheduling(io: TypedServer, roomId: string): void {
  rescheduleAutomix(io, roomId)
}

/**
 * Resolve stream URL / cover, set current track, and broadcast PLAYER_PLAY.
 * Returns true on success, false on failure.
 * Serialized per room via mutex to prevent concurrent state corruption.
 */
export function playTrackInRoom(io: TypedServer, roomId: string, track: Track): Promise<boolean> {
  return withPlayMutex(roomId, () => _playTrackInRoom(io, roomId, track))
}

/**
 * Auto-play when the queue was empty. Re-checks `room.currentTrack` inside
 * the mutex so that concurrent QUEUE_ADD handlers don't both trigger playback
 * (the second caller sees the track set by the first and bails out).
 */
export function autoPlayIfEmpty(io: TypedServer, roomId: string, track: Track): Promise<boolean> {
  return withPlayMutex(roomId, async () => {
    const room = roomRepo.get(roomId)
    if (!room || room.currentTrack) return false
    return _playTrackInRoom(io, roomId, track)
  })
}

interface AutomixTransition {
  overlapMs: number
  fromTrackId: string
  style?: import('@music-together/shared').TransitionStyle
  /** 新曲进入的媒体时间（已写入 playState.currentTime）。 */
  startAtMs: number
  stretch: number
  tiltDb: [number, number]
  echoThrow: boolean
  crossover: number
  bpm: number | null
  shapeBands: boolean
  sweepOut: boolean
  together: number
  trimDb: number
  outgoingReferenceDb: number | null
  incomingReferenceDb: number | null
  relation: import('@music-together/shared').KeyRelation
  outgoingBarSec: number | null
  incomingBarSec: number | null
  outgoingDownbeatOffset: number | null
  incomingSectionStart: number | null
  incomingLeadInSec: number | null
  expansion: number | null
  outgoingBeatsPerBar: number | null
}

async function _playTrackInRoom(
  io: TypedServer,
  roomId: string,
  track: Track,
  transition?: AutomixTransition,
  /** 自动混音的计划开混时刻；不早于房间最小下发提前量，最多等 1 秒（上游 MAX_ALIGN_HOLD_SEC）。 */
  alignAt?: number,
): Promise<boolean> {
  const room = roomRepo.get(roomId)
  if (!room) return false
  clearFailureSkip(roomId)
  // 新的曲目接管时间线，之前排好的过渡点作废。
  automixService.cancelAutomix(roomId)

  // Never trust/reuse a client-provided URL here. Resolving on the server is
  // what lets us record the provider's actual bitrate and refresh expired URLs.
  const resolved: Track = {
    ...track,
    streamUrl: undefined,
    streamFormat: undefined,
    requiresServerProxy: undefined,
  }
  let streamResolution: ResolvedStreamUrl | null = null
  let usedAuthenticatedAccount = false
  let streamFailure: import('./musicProvider.js').ProviderStreamFailure | null = null

  // Always resolve on the server so the URL is fresh and actual quality is known.
  if (!resolved.streamUrl) {
    try {
      const platformAuth = authService.getBestAuth(resolved.source, roomId)
      const cookie = platformAuth?.cookie
      const resolution = await resolveStreamUrlDetailed(
        resolved.source,
        resolved.urlId,
        room.audioQuality,
        cookie,
        false,
        platformAuth?.vipType ?? 0,
      )
      const url = resolution.result
      streamFailure = resolution.failure
      if (url) usedAuthenticatedAccount = Boolean(platformAuth)

      if (!url) {
        const isVip = resolved.vip
        logger.warn('无法获取歌曲播放地址，准备尝试跨平台匹配', {
          roomId,
          trackId: resolved.id,
          title: resolved.title,
          source: resolved.source,
          requestedBitrate: room.audioQuality,
          vip: Boolean(isVip),
          authenticated: Boolean(cookie),
        })

        // -------------------------------------------------------------------
        // Auto fallback (netease <-> tencent)
        // -------------------------------------------------------------------
        if (
          config.autoFallback.enabled &&
          (resolved.source === 'netease' ||
            resolved.source === 'tencent' ||
            resolved.source === 'kugou' ||
            resolved.source === 'kugou_concept') &&
          canAutoFallback(roomId, resolved.id)
        ) {
          // Prevent repeated fallback attempts for this queue item
          markAutoFallback(roomId, resolved.id, 60_000)
          const fromSource = resolved.source
          const trackTitle = resolved.title
          const toSource = trackFallbackService.getFallbackTargetSource(fromSource)
          if (toSource) {
            recordAutoFallbackAttempt()
            const attemptId = nanoid()
            io.to(roomId).emit(EVENTS.ROOM_AUTO_FALLBACK, {
              attemptId,
              status: 'trying',
              fromSource,
              toSource,
              trackTitle,
              reasonType: isVip && !cookie ? 'VIP_REQUIRED' : 'UNKNOWN',
              reasonDetail: isVip && !cookie ? 'VIP 歌曲未登录' : undefined,
            })

            try {
              const best = await trackFallbackService.findBestAlternativeTrack(resolved, toSource)
              if (best) {
                const fallbackAuth = authService.getBestAuth(best.track.source, roomId)
                const url2 = await resolveStreamUrl(
                  best.track.source,
                  best.track.urlId,
                  room.audioQuality,
                  fallbackAuth?.cookie,
                  false,
                  fallbackAuth?.vipType ?? 0,
                )
                if (url2) {
                  const replacement: Track = {
                    ...best.track,
                    id: resolved.id, // keep stable id so queue/current references remain consistent
                    requestedBy: resolved.requestedBy,
                    streamUrl: url2.url,
                    streamFormat: url2.streamFormat,
                    requiresServerProxy: url2.requiresServerProxy,
                  }
                  streamResolution = url2
                  usedAuthenticatedAccount = Boolean(fallbackAuth)

                  // Replace in queue (if present) before playing
                  const roomBefore = roomRepo.get(roomId)
                  if (roomBefore) {
                    roomBefore.queue = roomBefore.queue.map((t) => (t.id === resolved.id ? replacement : t))
                    io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: roomBefore.queue })
                  }

                  io.to(roomId).emit(EVENTS.ROOM_AUTO_FALLBACK, {
                    attemptId,
                    status: 'success',
                    fromSource,
                    toSource,
                    trackTitle,
                  })

                  // Continue playback with replacement
                  resolved.source = replacement.source
                  resolved.sourceId = replacement.sourceId
                  resolved.urlId = replacement.urlId
                  resolved.lyricId = replacement.lyricId
                  resolved.picId = replacement.picId
                  resolved.metadataSource = replacement.metadataSource
                  resolved.vip = replacement.vip
                  resolved.album = replacement.album
                  resolved.artist = replacement.artist
                  resolved.title = replacement.title
                  resolved.cover = replacement.cover
                  recordAutoFallbackSuccess()
                  resolved.streamUrl = replacement.streamUrl
                  resolved.streamFormat = replacement.streamFormat
                  resolved.requiresServerProxy = replacement.requiresServerProxy
                }
              }
            } catch (fallbackErr) {
              logger.error('跨平台自动匹配歌曲失败', fallbackErr, { roomId, trackId: resolved.id })
            }

            if (!resolved.streamUrl) {
              recordAutoFallbackFailed()
              io.to(roomId).emit(EVENTS.ROOM_AUTO_FALLBACK, {
                attemptId,
                status: 'failed',
                fromSource,
                toSource,
                trackTitle,
                reasonType: isVip && !cookie ? 'VIP_REQUIRED' : 'UNKNOWN',
              })
            }
          }
        }

        // If still no streamUrl, keep the track as the current item and let the
        // room decide what to do with the structured failure.
        if (!resolved.streamUrl) {
          publishPlaybackFailure(
            io,
            roomId,
            room,
            resolved,
            toPlaybackFailure(resolved.source, streamFailure ?? { reason: 'unknown' }),
          )
          return false
        }
      }
      if (url) streamResolution = url
      resolved.streamUrl = url?.url ?? resolved.streamUrl
      resolved.streamFormat = url?.streamFormat ?? resolved.streamFormat
      resolved.requiresServerProxy = url?.requiresServerProxy ?? resolved.requiresServerProxy
    } catch (err) {
      logger.error('解析歌曲播放地址时发生异常', err, {
        roomId,
        trackId: resolved.id,
        source: resolved.source,
        urlId: resolved.urlId,
      })
      // Auto-remove on unexpected failure too
      queueService.removeTrack(roomId, resolved.id)
      const room2 = roomRepo.get(roomId)
      if (room2) io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room2.queue })
      return false
    }
  }

  if (!resolved.streamUrl || !streamResolution) return false

  // Fetch cover if missing
  if (!resolved.cover && resolved.picId) {
    try {
      const cover = await musicProvider.getCover(resolved.metadataSource ?? resolved.source, resolved.picId)
      if (cover) resolved.cover = cover
    } catch {
      // Non-critical, leave cover empty
    }
  }

  // A stream/metadata lookup may discover artwork that was missing from the
  // original queue entry. Keep the visible playlist row in sync with the
  // fully resolved current track instead of showing a permanent placeholder.
  if (resolved.cover) {
    const updatedQueueTrack = queueService.updateTrackArtwork(roomId, resolved.id, {
      cover: resolved.cover,
      thumbnailCover: resolved.thumbnailCover,
    })
    if (updatedQueueTrack) {
      io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room.queue })
    }
  }

  // 实际音质随当前曲目下发（可选字段）：客户端据此显示音质标签与降级提示。
  resolved.audioQuality = streamResolution?.actualQuality
  resolved.audioBitrate = streamResolution?.actualBitrate ?? null
  resolved.qualityDowngraded = streamResolution
    ? isQualityDowngraded(resolved.source, room.audioQuality, streamResolution)
    : false

  // Update room state — align serverTimestamp with the scheduled execution time
  // so estimateCurrentTime() is accurate from the first scheduled frame.
  room.currentTrack = resolved
  lastStreamUrlRefreshAt.set(roomId, Date.now())
  const minimumScheduleTime = getScheduleTime(roomId)
  const scheduleTime =
    transition && alignAt
      ? Math.max(minimumScheduleTime, Math.min(alignAt, Date.now() + AUTOMIX_MAX_ALIGN_HOLD_MS))
      : minimumScheduleTime
  room.playState = {
    isPlaying: true,
    // 过渡时从上游 planner 给的 inStart 进入，跳过前奏静音；普通播放从 0 开始。
    currentTime: transition ? transition.startAtMs / 1000 : 0,
    serverTimestamp: scheduleTime,
    revision: nextPlaybackRevision(room.playState),
  }
  roomRepo.persist(roomId)

  io.to(roomId).emit(EVENTS.PLAYER_PLAY, {
    track: resolved,
    playState: scheduled(room.playState, roomId, scheduleTime),
    ...(transition ? { automix: transition } : {}),
  })

  // 预解析下一首的播放地址（只填 provider 的 URL 缓存，不下载音频）：
  // 切歌时省掉一次上游 URL 解析往返，过渡更接近无缝。异步执行，失败静默。
  void preResolveNextStream(roomId)

  // 自动混音：在当前曲目结束前 overlap 秒推进，新旧两首在客户端重叠。
  rescheduleAutomix(io, roomId)

  // 听歌打卡只针对“提供音源且在线并主动开启”的网易云账号。
  listeningReportService.beginListeningReport(roomId, room)

  // 通知大厅用户当前播放曲目变化
  broadcastRoomList(io)
  void refillRoamingTail(io, roomId)

  const artistLabel = (Array.isArray(resolved.artist) ? resolved.artist : []).filter(Boolean).join(' / ') || '未知歌手'
  const requestedQuality = formatAudioQuality(room.audioQuality)
  const actualQuality = formatResolvedAudioQuality(streamResolution)
  const qualityDowngraded = isQualityDowngraded(resolved.source, room.audioQuality, streamResolution)
  const qualityDetail = qualityDowngraded ? `${actualQuality}（房间期望 ${requestedQuality}，已降级）` : actualQuality

  logger.info(
    `开始播放《${resolved.title}》 - ${artistLabel}｜平台：${SOURCE_LABELS[resolved.source]}｜实际音质：${qualityDetail}`,
    {
      event: 'player.track_started',
      roomId,
      trackId: resolved.id,
      source: resolved.source,
      urlId: resolved.urlId,
      title: resolved.title,
      artists: resolved.artist,
      album: resolved.album || '未知专辑',
      duration: formatDuration(resolved.duration),
      requestedBy: resolved.requestedBy ?? '未知',
      requestedBitrate: room.audioQuality,
      attemptedBitrate: streamResolution.attemptedBitrate,
      actualBitrate: streamResolution.actualBitrate,
      actualQuality: streamResolution.actualQuality ?? null,
      providerFormat: streamResolution.providerFormat ?? null,
      streamFileSize: streamResolution.fileSize ?? null,
      requiresServerProxy: Boolean(resolved.requiresServerProxy),
      qualityDowngraded,
      streamUrlFromCache: streamResolution.fromCache,
      authenticated: usedAuthenticatedAccount,
      scheduledDelayMs: Math.max(0, scheduleTime - Date.now()),
    },
  )
  return true
}

/**
 * Resume the current track. Returns false when there is nothing to resume.
 *
 * Resuming while already playing would rewind the timeline to the position
 * recorded at the last pause. Clients mute before calling play(), and Howler
 * ignores play() on an already-playing sound, so they would also stay silent
 * until the next hard seek. Treat it as a no-op instead (vote reports failure).
 */
export function resumeTrack(io: TypedServer, roomId: string, _initiatorSocket?: TypedSocket): boolean {
  const room = roomRepo.get(roomId)
  if (!room || !room.currentTrack) return false
  if (room.playState.isPlaying) {
    logger.debug('房间已在播放中，忽略恢复播放请求', {
      event: 'player.resume_ignored',
      roomId,
      trackId: room.currentTrack.id,
    })
    return false
  }

  const scheduleTime = getScheduleTime(roomId)
  room.playState = {
    ...room.playState,
    isPlaying: true,
    serverTimestamp: scheduleTime,
    revision: nextPlaybackRevision(room.playState),
  }
  roomRepo.persist(roomId)
  // All clients (including initiator) must execute at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_RESUME, { playState: scheduled(room.playState, roomId, scheduleTime) })
  listeningReportService.resumeListeningReport(roomId)
  rescheduleAutomix(io, roomId)
  return true
}

export function pauseTrack(io: TypedServer, roomId: string, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room) return

  // Snapshot estimated position before pausing so resume starts from the correct point
  const scheduleTime = getScheduleTime(roomId)
  const snapshotTime = estimateCurrentTimeAt(roomId, scheduleTime)
  room.playState = {
    isPlaying: false,
    currentTime: snapshotTime,
    serverTimestamp: scheduleTime,
    revision: nextPlaybackRevision(room.playState),
  }
  roomRepo.persist(roomId)
  // All clients must pause at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_PAUSE, { playState: scheduled(room.playState, roomId, scheduleTime) })
  listeningReportService.pauseListeningReport(roomId)
  automixService.cancelAutomix(roomId)
}

export function seekTrack(
  io: TypedServer,
  roomId: string,
  requestedTime: number,
  _initiatorSocket?: TypedSocket,
  expectedTrackId?: string,
): void {
  const room = roomRepo.get(roomId)
  if (!room || !room.currentTrack) return
  if (expectedTrackId !== undefined && expectedTrackId !== room.currentTrack.id) {
    logger.debug('忽略切歌竞态中的迟到 seek', { event: 'player.seek_stale_track', roomId, expectedTrackId })
    return
  }
  const currentTime = clampPlaybackPosition(requestedTime, room.currentTrack.duration)

  const scheduleTime = getScheduleTime(roomId)
  // When playing, align serverTimestamp with scheduled time so estimateCurrentTime() is accurate
  room.playState = {
    ...room.playState,
    currentTime,
    serverTimestamp: room.playState.isPlaying ? scheduleTime : Date.now(),
    revision: nextPlaybackRevision(room.playState),
  }
  roomRepo.persist(roomId)
  // All clients must seek at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_SEEK, { playState: scheduled(room.playState, roomId, scheduleTime) })
  listeningReportService.seekListeningReport(roomId, currentTime)
  // 拖动改变剩余时间，过渡点必须按新位置重排。
  rescheduleAutomix(io, roomId)
}

export function updatePlayState(roomId: string, update: Partial<PlayState>): void {
  const room = roomRepo.get(roomId)
  if (room) {
    room.playState = { ...room.playState, ...update, serverTimestamp: Date.now() }
    roomRepo.persist(roomId)
  }
}

export function setCurrentTrack(roomId: string, track: Track | null): void {
  const room = roomRepo.get(roomId)
  if (room) {
    room.currentTrack = track
    if (!track?.streamUrl) lastStreamUrlRefreshAt.delete(roomId)
    room.playState = {
      isPlaying: track !== null,
      currentTime: 0,
      serverTimestamp: Date.now(),
      revision: nextPlaybackRevision(room.playState),
    }
    roomRepo.persist(roomId)
  }
}

/**
 * Stop playback: clear current track, emit PLAYER_PAUSE with a stopped state,
 * broadcast full ROOM_STATE so clients clear stale track, and notify lobby.
 * Used when no next track is available (queue empty, track removed, queue cleared).
 */
export function stopPlayback(io: TypedServer, roomId: string): void {
  clearFailureSkip(roomId)
  listeningReportService.finishListeningReport(roomId, 'stop')
  automixService.cancelAutomix(roomId)
  setCurrentTrack(roomId, null)
  const room = roomRepo.get(roomId)
  const stoppedState = room?.playState ?? {
    isPlaying: false,
    currentTime: 0,
    serverTimestamp: Date.now(),
    revision: 0,
  }
  io.to(roomId).emit(EVENTS.PLAYER_PAUSE, {
    playState: { ...stoppedState, serverTimeToExecute: stoppedState.serverTimestamp },
  })
  if (room) {
    io.to(roomId).emit(EVENTS.ROOM_STATE, toPublicRoomState(room))
  }
  broadcastRoomList(io)
}

/**
 * Mutex-protected variant of `stopPlayback`. Use when the caller is NOT
 * already inside the per-room mutex (e.g. QUEUE_CLEAR) to prevent races
 * with concurrent `autoPlayIfEmpty` / `_playTrackInRoom` operations.
 */
export function stopPlaybackSafe(io: TypedServer, roomId: string): Promise<void> {
  return withPlayMutex(roomId, async () => {
    stopPlayback(io, roomId)
  })
}

// ---------------------------------------------------------------------------
// Next / Previous track (debounce + queue navigation inside mutex)
// ---------------------------------------------------------------------------

function removePreviousTrackAfterAdvance(roomId: string, previousTrack: Track | null): boolean {
  const room = roomRepo.get(roomId)
  if (
    !room ||
    !previousTrack ||
    !shouldRemovePlayedTrackAfterAdvance(room.removePlayedTracks, previousTrack, room.currentTrack)
  ) {
    return false
  }
  return queueService.removeTrack(roomId, previousTrack.id)
}

/**
 * Advance to the next track in the queue. Debounce check and queue navigation
 * run inside the per-room mutex so two rapid NEXT events can never both pass
 * the debounce in the same event loop tick.
 */
export function playNextTrackInRoom(
  io: TypedServer,
  roomId: string,
  playMode: PlayMode,
  options?: {
    skipDebounce?: boolean
    expectedTrackId?: string
    forceRoaming?: boolean
    /** 自动混音预先决定的重叠时长（秒）；由服务端调度器传入。 */
    automixOverlapSec?: number
    /** 上游 `transitionChooser` 选出的过渡类型。 */
    automixStyle?: import('@music-together/shared').TransitionStyle
    /** 新曲进入点（秒），过渡时跳过前奏静音。 */
    automixInStartSec?: number
    automixStretch?: number
    automixTiltDb?: [number, number]
    automixEchoThrow?: boolean
    automixCrossover?: number
    automixBpm?: number | null
    automixShapeBands?: boolean
    automixSweepOut?: boolean
    automixTogether?: number
    automixTrimDb?: number
    automixOutgoingReferenceDb?: number | null
    automixIncomingReferenceDb?: number | null
    automixRelation?: import('@music-together/shared').KeyRelation
    automixOutgoingBarSec?: number | null
    automixIncomingBarSec?: number | null
    automixOutgoingDownbeatOffset?: number | null
    automixIncomingSectionStart?: number | null
    automixIncomingLeadInSec?: number | null
    automixExpansion?: number | null
    automixOutgoingBeatsPerBar?: number | null
    /** 出歌到达 outStart 的服务端时刻；新曲按它排定开播。 */
    automixDueAt?: number
  },
): Promise<void> {
  return withPlayMutex(roomId, async () => {
    clearFailureSkip(roomId)
    // Checked inside the mutex: the track may have advanced naturally while
    // this request waited, and skipping then would drop the new track too.
    if (options?.expectedTrackId) {
      const roomBefore = roomRepo.get(roomId)
      const currentId = roomBefore?.currentTrack?.id
      if (currentId && currentId !== options.expectedTrackId) {
        logger.debug('切歌请求指向的曲目已不在播放，忽略', {
          event: 'player.next_stale',
          roomId,
          expectedTrackId: options.expectedTrackId,
          currentTrackId: currentId,
        })
        return
      }
    }
    if (options?.skipDebounce) {
      // Still update the timestamp so a normal NEXT right after is debounced
      lastSkipTimestamp.set(roomId, { action: 'next', timestamp: Date.now() })
    } else if (_isSkipDebounced(roomId, 'next')) {
      return
    }

    const room = roomRepo.get(roomId)
    if (!room) return
    const previousTrack = room.currentTrack

    let roamingAttempted = false
    const tryRoaming = async (): Promise<boolean> => {
      roamingAttempted = true
      try {
        const roamingTracks = await roamingService.getBatch(room)
        if (roamingTracks.length === 0) return false
        // 一批一起入队：正常的下一次切歌会直接从队列里取到它们，
        // 不必每首歌再打一次推荐接口。入队失败（容量满）时放弃漫游，
        // 交给下面的队列回绕/停止逻辑。
        const added = queueService.addBatchTracks(roomId, roamingTracks)
        if (added === 0) return false
        const roomAfterQueue = roomRepo.get(roomId)
        if (roomAfterQueue) io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: roomAfterQueue.queue })
        return true
      } catch (error) {
        logger.warn('房间漫游推荐不可用', { roomId, source: room.roamingSource, error })
      }
      return false
    }

    // Explicit roam action (queue header button): insert the recommendation
    // right after the current track and play that queued entry. The queue then
    // shows the song that is actually playing, and NEXT continues with the
    // user's own queue instead of treating the queue as if nothing was playing.
    if (options?.forceRoaming) {
      try {
        // 一次取整批：只播第一条，其余留在当前曲之后。这样起播后的补货
        // 不会再立刻打第二次推荐接口（上游 FM 同样是流式批量补）。
        const roamingTracks = await roamingService.getBatch(room)
        if (roamingTracks.length === 0) {
          // 后台补货在飞时 getBatch 会被同账号节流直接返回空；等它落队后
          // 走下面的普通导航，队列里已经有可播的漫游曲。
          const pendingRefill = roamingRefillTasks.get(roomId)
          if (pendingRefill) await pendingRefill
        }
        if (roamingTracks.length > 0) {
          const queuedTracks = roamingTracks.map((track) => ({
            ...track,
            streamUrl: undefined,
            requiresServerProxy: undefined,
            streamFormat: undefined,
          }))
          const [first, ...rest] = queuedTracks
          const inserted = first ? queueService.insertTracksAfterCurrent(roomId, [first]) : []
          if (inserted.length > 0) {
            // 其余推荐放到队尾：显式漫游仍然只插一首到当前曲之后，NEXT 继续
            // 走用户自己的队列；同时队列里已有后续漫游曲，起播后的补货不会
            // 立刻再打一次推荐接口。
            const beforeAppend = roomRepo.get(roomId)?.queue.length ?? 0
            if (rest.length > 0) queueService.addBatchTracks(roomId, rest)
            const appended = roomRepo.get(roomId)?.queue.slice(beforeAppend) ?? []
            if (await _playTrackInRoom(io, roomId, inserted[0]!)) {
              removePreviousTrackAfterAdvance(roomId, previousTrack)
              const roomAfterQueue = roomRepo.get(roomId)
              if (roomAfterQueue) {
                io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: roomAfterQueue.queue })
              }
              lastSkipTimestamp.set(roomId, { action: 'next', timestamp: Date.now() })
              return
            }
            // 播放失败：撤销刚插入的队列项，保持队列与当前播放一致。
            for (const track of [...inserted, ...appended]) queueService.removeTrack(roomId, track.id)
            const roomAfterQueue = roomRepo.get(roomId)
            if (roomAfterQueue) {
              io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: roomAfterQueue.queue })
            }
          }
        }
      } catch (error) {
        logger.warn('房间漫游推荐不可用', { roomId, source: room.roamingSource, error })
      }
      // fall through to normal navigation when roaming cannot produce a track
    }

    // loop-all would otherwise wrap to the first queued song before roaming
    // gets a chance. At the queue tail (and after a roaming song), refill the
    // queue with a recommendation batch, then let the normal navigation pick
    // the first new track. A failed request falls back to the playback mode.
    if (shouldPreferRoamingForNext(room, playMode)) {
      // 起播后的后台补货可能正在飞：等它落队，避免把“同账号请求在飞”误判成
      // 没有下一首而停播。
      const pendingRefill = roamingRefillTasks.get(roomId)
      if (pendingRefill) await pendingRefill
      else await tryRoaming()
    }

    let nextTrack = queueService.getNextTrack(roomId, playMode)
    if (!nextTrack && !roamingAttempted && room.roamingEnabled) {
      if (await tryRoaming()) nextTrack = queueService.getNextTrack(roomId, playMode)
    }
    if (!nextTrack) {
      stopPlayback(io, roomId)
      return
    }

    // A failed track is removed from the queue, so each retry asks for a fresh
    // successor. Without the attempt cap and the final stopPlayback, a queue of
    // unplayable tracks (e.g. VIP-only with nobody logged in) would leave the
    // room reporting isPlaying with a track that already finished everywhere.
    // In loop-one, getNextTrack keeps returning the failed track itself, so
    // fall back to sequential order once it has failed.
    const MAX_ADVANCE_ATTEMPTS = 5
    const transition: AutomixTransition | undefined = options?.automixOverlapSec
      ? {
          overlapMs: Math.round(options.automixOverlapSec * 1000),
          fromTrackId: previousTrack?.id ?? '',
          style: options.automixStyle,
          startAtMs: Math.round((options.automixInStartSec ?? 0) * 1000),
          stretch: options.automixStretch ?? 1,
          tiltDb: options.automixTiltDb ?? [0, 0],
          echoThrow: options.automixEchoThrow ?? false,
          crossover: options.automixCrossover ?? 0.5,
          bpm: options.automixBpm ?? null,
          shapeBands: options.automixShapeBands ?? false,
          sweepOut: options.automixSweepOut ?? false,
          together: options.automixTogether ?? 0,
          trimDb: options.automixTrimDb ?? 0,
          outgoingReferenceDb: options.automixOutgoingReferenceDb ?? null,
          incomingReferenceDb: options.automixIncomingReferenceDb ?? null,
          relation: options.automixRelation ?? 'unknown',
          outgoingBarSec: options.automixOutgoingBarSec ?? null,
          incomingBarSec: options.automixIncomingBarSec ?? null,
          outgoingDownbeatOffset: options.automixOutgoingDownbeatOffset ?? null,
          incomingSectionStart: options.automixIncomingSectionStart ?? null,
          incomingLeadInSec: options.automixIncomingLeadInSec ?? null,
          expansion: options.automixExpansion ?? null,
          outgoingBeatsPerBar: options.automixOutgoingBeatsPerBar ?? null,
        }
      : undefined
    let success = await _playTrackInRoom(io, roomId, nextTrack, transition, options?.automixDueAt)
    let attemptedTrackId = nextTrack.id
    for (let attempt = 1; !success && attempt < MAX_ADVANCE_ATTEMPTS; attempt += 1) {
      const retryMode = playMode === 'loop-one' ? 'sequential' : playMode
      const skipTrack = queueService.getNextTrack(roomId, retryMode)
      if (!skipTrack || skipTrack.id === attemptedTrackId) break
      attemptedTrackId = skipTrack.id
      success = await _playTrackInRoom(io, roomId, skipTrack)
    }
    if (!success) {
      logger.warn('连续解析播放地址失败，已停止房间播放', {
        event: 'player.advance_exhausted',
        roomId,
        playMode,
        queueSize: roomRepo.get(roomId)?.queue.length ?? 0,
      })
      stopPlayback(io, roomId)
      return
    }
    if (removePreviousTrackAfterAdvance(roomId, previousTrack)) {
      const roomAfterRemoval = roomRepo.get(roomId)
      if (roomAfterRemoval) io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: roomAfterRemoval.queue })
    }

    // Refresh debounce timestamp after async work completes.
    // Without this, a second PLAYER_NEXT waiting on the mutex could pass
    // the debounce check if _playTrackInRoom took longer than 500ms (e.g.
    // stream URL resolution), causing a double-skip.
    lastSkipTimestamp.set(roomId, { action: 'next', timestamp: Date.now() })
  })
}

/**
 * Go to the previous track in the queue. Same mutex serialization as next.
 */
export function playPrevTrackInRoom(
  io: TypedServer,
  roomId: string,
  options?: { skipDebounce?: boolean },
): Promise<void> {
  return withPlayMutex(roomId, async () => {
    if (options?.skipDebounce) {
      lastSkipTimestamp.set(roomId, { action: 'prev', timestamp: Date.now() })
    } else if (_isSkipDebounced(roomId, 'prev')) {
      return
    }

    const prevTrack = queueService.getPreviousTrack(roomId)
    if (!prevTrack) return

    const success = await _playTrackInRoom(io, roomId, prevTrack)
    if (!success) {
      const skipTrack = queueService.getPreviousTrack(roomId)
      if (skipTrack) await _playTrackInRoom(io, roomId, skipTrack)
    }

    // Refresh debounce timestamp after async work (same rationale as playNextTrackInRoom)
    lastSkipTimestamp.set(roomId, { action: 'prev', timestamp: Date.now() })
  })
}

// ---------------------------------------------------------------------------
// Playback sync for newly-joined clients
// ---------------------------------------------------------------------------

/** Refresh an old permanent-room URL only when a user joins. */
export function refreshStreamUrlForJoin(roomId: string): Promise<boolean> {
  return withPlayMutex(roomId, async () => {
    const room = roomRepo.get(roomId)
    const track = room?.currentTrack
    if (!room || !track) return false
    // 上游 3da604b：网易云链接已按 CDN 时间戳过期时，任何房间都立即刷新，不受节流限制。
    const expired = !!track.streamUrl && isStreamUrlExpired(track.source, track.streamUrl)
    if (!room.permanent && !expired) return false

    const now = Date.now()
    const lastRefreshAt = lastStreamUrlRefreshAt.get(roomId) ?? 0
    const refreshInterval = track.streamUrl
      ? TIMING.STREAM_URL_REFRESH_INTERVAL_MS
      : TIMING.STREAM_URL_REFRESH_RETRY_INTERVAL_MS
    if (!expired && now - lastRefreshAt < refreshInterval) return false

    // Record the attempt up front so failed upstream requests are also throttled.
    lastStreamUrlRefreshAt.set(roomId, now)
    try {
      const platformAuth = authService.getBestAuth(track.source, roomId)
      const refreshed = await resolveStreamUrl(
        track.source,
        track.urlId,
        room.audioQuality,
        platformAuth?.cookie,
        true,
        platformAuth?.vipType ?? 0,
      )
      if (!refreshed) {
        if (room.currentTrack?.id === track.id) {
          room.currentTrack = {
            ...room.currentTrack,
            streamUrl: undefined,
            streamFormat: undefined,
            requiresServerProxy: undefined,
          }
        }
        return false
      }

      if (room.currentTrack?.id !== track.id) return false
      room.currentTrack = {
        ...room.currentTrack,
        streamUrl: refreshed.url,
        streamFormat: refreshed.streamFormat,
        requiresServerProxy: refreshed.requiresServerProxy,
      }
      logger.info('Refreshed stale stream URL when user joined permanent room', {
        event: 'player.stream_url_refreshed_on_join',
        roomId,
        trackId: track.id,
      })
      return true
    } catch (err) {
      if (room.currentTrack?.id === track.id) {
        room.currentTrack = {
          ...room.currentTrack,
          streamUrl: undefined,
          streamFormat: undefined,
          requiresServerProxy: undefined,
        }
      }
      logger.warn('Failed to refresh stale stream URL when user joined permanent room', {
        roomId,
        trackId: track.id,
        err,
      })
      return false
    }
  })
}

/**
 * A client's media element failed (expired CDN URL). Re-resolve the current
 * track's stream URL and hand it to the room. Throttled per room so a roomful
 * of clients hitting the same dead URL only causes one upstream request.
 */
const MANUAL_STREAM_REFRESH_MIN_INTERVAL_MS = 10_000
const lastManualStreamRefreshAt = new Map<string, number>()
const lastManualStreamRefreshOkAt = new Map<string, number>()
const manualStreamRefreshInFlight = new Map<string, Promise<Track | null>>()

export function refreshCurrentStreamUrl(
  roomId: string,
  requestedTrackId?: string,
  options?: { degrade?: boolean },
): Promise<Track | null> {
  const inFlight = manualStreamRefreshInFlight.get(roomId)
  if (inFlight) return inFlight

  const room = roomRepo.get(roomId)
  const track = room?.currentTrack
  if (!room || !track) return Promise.resolve(null)
  if (requestedTrackId && requestedTrackId !== track.id) return Promise.resolve(null)

  const now = Date.now()
  const lastRefreshAt = lastManualStreamRefreshAt.get(roomId) ?? 0
  if (now - lastRefreshAt < MANUAL_STREAM_REFRESH_MIN_INTERVAL_MS) {
    // A refresh just ran: hand the already-refreshed URL to the next failing
    // client instead of leaving it to skip the track. Only if that refresh
    // succeeded (failing refreshes leave the old, dead URL in place).
    const refreshedRecently = (lastManualStreamRefreshOkAt.get(roomId) ?? 0) >= lastRefreshAt
    return Promise.resolve(refreshedRecently ? (room.currentTrack ?? null) : null)
  }
  lastManualStreamRefreshAt.set(roomId, now)

  const task = (async (): Promise<Track | null> => {
    try {
      const auth = authService.getBestAuth(track.source, roomId)
      const quality = options?.degrade
        ? degradeQuality(track.source, room.audioQuality, auth?.vipType ?? 0)
        : room.audioQuality
      const refreshed = await resolveStreamUrl(
        track.source,
        track.urlId,
        quality,
        auth?.cookie,
        true,
        auth?.vipType ?? 0,
      )
      if (!refreshed || room.currentTrack?.id !== track.id) return null
      room.currentTrack = {
        ...room.currentTrack,
        streamUrl: refreshed.url,
        streamFormat: refreshed.streamFormat,
        requiresServerProxy: refreshed.requiresServerProxy,
      }
      lastManualStreamRefreshOkAt.set(roomId, Date.now())
      logger.info('Refreshed stream URL after playback failure', {
        event: 'player.stream_url_refreshed',
        roomId,
        trackId: track.id,
        degraded: options?.degrade === true,
        quality,
      })
      return room.currentTrack
    } catch (err) {
      logger.warn('Failed to refresh stream URL after playback failure', { roomId, trackId: track.id, err })
      return null
    } finally {
      manualStreamRefreshInFlight.delete(roomId)
    }
  })()

  manualStreamRefreshInFlight.set(roomId, task)
  return task
}

/**
 * 用户从失败提示里点“重试”：绕过负缓存重新解析，并重新开始当前曲目。
 * 登录/购买后调用同一入口即可。
 */
export function retryFailedTrack(
  io: TypedServer,
  roomId: string,
  requestedTrackId?: string,
  options?: { degrade?: boolean },
): Promise<boolean> {
  return withPlayMutex(roomId, async () => {
    clearFailureSkip(roomId)
    const room = roomRepo.get(roomId)
    const track = room?.currentTrack
    if (!room || !track) return false
    if (requestedTrackId && requestedTrackId !== track.id) return false

    const auth = authService.getBestAuth(track.source, roomId)
    const quality = options?.degrade
      ? degradeQuality(track.source, room.audioQuality, auth?.vipType ?? 0)
      : room.audioQuality
    const resolution = await resolveStreamUrlDetailed(
      track.source,
      track.urlId,
      quality,
      auth?.cookie,
      true,
      auth?.vipType ?? 0,
    )
    if (!resolution.result) {
      publishPlaybackFailure(
        io,
        roomId,
        room,
        track,
        toPlaybackFailure(track.source, resolution.failure ?? { reason: 'unknown' }),
      )
      return false
    }

    const updated: Track = {
      ...track,
      streamUrl: resolution.result.url,
      streamFormat: resolution.result.streamFormat,
      requiresServerProxy: resolution.result.requiresServerProxy,
    }
    room.currentTrack = updated
    const queueIndex = room.queue.findIndex((item) => item.id === track.id)
    if (queueIndex >= 0) room.queue[queueIndex] = updated
    const scheduleTime = getScheduleTime(roomId)
    room.playState = {
      isPlaying: true,
      currentTime: 0,
      serverTimestamp: scheduleTime,
      revision: nextPlaybackRevision(room.playState),
    }
    roomRepo.persist(roomId)
    io.to(roomId).emit(EVENTS.PLAYER_PLAY, {
      track: updated,
      playState: scheduled(room.playState, roomId, scheduleTime),
    })
    io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room.queue })
    broadcastRoomList(io)
    return true
  })
}

export type SourceSwitchResult =
  { ok: true; track: Track } | { ok: false; reason: 'NOT_CURRENT' | 'INVALID_SOURCE' | 'NO_RESOURCE' }

/**
 * Replace the current track with an equivalent track from another provider while
 * keeping the queue identity and the room's playback position untouched.
 */
export function switchCurrentTrackSource(
  io: TypedServer,
  roomId: string,
  trackId: string,
  candidate: Track,
  trigger: 'manual' | 'automatic' = 'manual',
): Promise<SourceSwitchResult> {
  return withPlayMutex(roomId, async () => {
    clearFailureSkip(roomId)
    const room = roomRepo.get(roomId)
    const current = room?.currentTrack
    if (!room || !current || current.id !== trackId) return { ok: false, reason: 'NOT_CURRENT' as const }
    if (!trackFallbackService.isFallbackSource(candidate.source) || candidate.source === current.source) {
      recordSourceSwitchFailed()
      return { ok: false, reason: 'INVALID_SOURCE' as const }
    }

    const auth = authService.getBestAuth(candidate.source, roomId)
    const resolved = await resolveStreamUrl(
      candidate.source,
      candidate.urlId,
      room.audioQuality,
      auth?.cookie,
      true,
      auth?.vipType ?? 0,
    )
    if (!resolved) {
      recordSourceSwitchFailed()
      return { ok: false, reason: 'NO_RESOURCE' as const }
    }

    const replacement: Track = {
      ...candidate,
      id: current.id,
      requestedBy: current.requestedBy,
      streamUrl: resolved.url,
      streamFormat: resolved.streamFormat,
      requiresServerProxy: resolved.requiresServerProxy,
    }

    room.currentTrack = replacement
    const queueIndex = room.queue.findIndex((track) => track.id === trackId)
    if (queueIndex >= 0) room.queue[queueIndex] = replacement
    roomRepo.persist(roomId)

    const currentTime = estimateCurrentTimeAt(roomId, Date.now())
    io.to(roomId).emit(EVENTS.PLAYER_SOURCE_SWITCHED, {
      track: replacement,
      currentTime,
      isPlaying: room.playState.isPlaying,
    })
    io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room.queue })
    io.to(roomId).emit(EVENTS.ROOM_STATE, toPublicRoomState(room))
    logger.info('Room switched the current track source', {
      event: 'player.source_switched',
      roomId,
      trackId,
      fromSource: current.source,
      toSource: replacement.source,
      trigger,
    })
    recordSourceSwitch(trigger)
    return { ok: true, track: replacement }
  })
}

/**
 * Resume a paused track before the first room state is sent to a user joining
 * an empty room. The client uses that initial state to recover playback when
 * the following PLAYER_PLAY event arrives before its player listeners mount.
 */
export function preparePlaybackForJoiningRoom(roomId: string, room: RoomData): void {
  const isFirstUserInRoom = room.users.length === 1
  if (!isFirstUserInRoom || !room.currentTrack?.streamUrl || room.playState.isPlaying) return

  room.playState = {
    ...room.playState,
    isPlaying: true,
    serverTimestamp: Date.now(),
    revision: nextPlaybackRevision(room.playState),
  }
  roomRepo.persist(roomId)
}

/**
 * Send current playback state to a socket that just joined a room.
 * Handles auto-resume when alone, and auto-play from queue.
 */
export async function syncPlaybackToSocket(
  io: TypedServer,
  socket: TypedSocket,
  roomId: string,
  room: RoomData,
): Promise<void> {
  const isAloneInRoom = room.users.length === 1

  if (room.currentTrack?.streamUrl) {
    // Keep this idempotent fallback for callers that do not prepare the room
    // state before syncing playback.
    preparePlaybackForJoiningRoom(roomId, room)
    const shouldAutoPlay = isAloneInRoom || room.playState.isPlaying
    // 空房期间过渡定时器已被取消；恢复播放后必须按新的时间线重排。
    if (shouldAutoPlay) rescheduleAutomix(io, roomId)

    const snapshotTimestamp = Date.now()
    const joinCalibrationDelayMs = NTP.INITIAL_INTERVAL_MS * NTP.MAX_INITIAL_SAMPLES + 100
    const scheduleTime = shouldAutoPlay
      ? Math.max(getScheduleTime(roomId), snapshotTimestamp + joinCalibrationDelayMs)
      : snapshotTimestamp
    const snapshotCurrentTime = clampPlaybackPosition(
      shouldAutoPlay ? estimateCurrentTimeAt(roomId, scheduleTime) : estimateCurrentTime(roomId),
      room.currentTrack.duration,
    )

    socket.emit(EVENTS.PLAYER_PLAY, {
      track: room.currentTrack,
      playState: {
        isPlaying: shouldAutoPlay,
        currentTime: snapshotCurrentTime,
        serverTimestamp: scheduleTime,
        serverTimeToExecute: scheduleTime,
        revision: room.playState.revision ?? 0,
      },
    })
  } else if (isAloneInRoom && !room.currentTrack && room.queue.length > 0) {
    // No current track but queue has items → start playing from queue
    const firstTrack = room.queue[0]
    await playTrackInRoom(io, roomId, firstTrack)
  }
}

// ---------------------------------------------------------------------------
// Room cleanup and debounce
// ---------------------------------------------------------------------------

/** Debounce duplicate skips without blocking an immediate direction reversal. */
const lastSkipTimestamp = new Map<string, { action: 'next' | 'prev'; timestamp: number }>()

/** Remove per-room entries for a deleted room */
export function cleanupRoom(roomId: string): void {
  // 冷却条目只在下次查询时过期删除；房间销毁后不会再查，需要在这里清掉。
  for (const key of autoFallbackCooldown.keys()) {
    if (key.startsWith(`${roomId}:`)) autoFallbackCooldown.delete(key)
  }
  lastSkipTimestamp.delete(roomId)
  lastStreamUrlRefreshAt.delete(roomId)
  playMutexes.delete(roomId)
  automixService.cancelAutomix(roomId)
  automixService.clearTrackProfiles(roomId)
}

/**
 * Check and update the next-track debounce for a room.
 * Returns true if the action should be SKIPPED (too soon), false if allowed.
 * Internal: called inside mutex to prevent same-tick race conditions.
 */
function _isSkipDebounced(roomId: string, action: 'next' | 'prev'): boolean {
  const now = Date.now()
  const last = lastSkipTimestamp.get(roomId)
  if (last?.action === action && now - last.timestamp < config.player.nextDebounceMs) return true
  lastSkipTimestamp.set(roomId, { action, timestamp: now })
  return false
}
