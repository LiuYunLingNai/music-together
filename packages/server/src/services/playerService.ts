import type { AudioQuality, MusicSource, PlayMode, PlayState, ScheduledPlayState, Track } from '@music-together/shared'
import { EVENTS, ERROR_CODE, NTP } from '@music-together/shared'
import { roomRepo } from '../repositories/roomRepository.js'
import { nanoid } from 'nanoid'
import { musicProvider } from './musicProvider.js'
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

// ---------------------------------------------------------------------------
// Per-room mutex for playTrackInRoom (prevents concurrent execution)
// ---------------------------------------------------------------------------

const playMutexes = new Map<string, Promise<unknown>>()

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
  next.finally(() => {
    if (playMutexes.get(roomId) === next) playMutexes.delete(roomId)
  })
  return next
}

// ---------------------------------------------------------------------------
// Scheduled execution helpers
// ---------------------------------------------------------------------------

/**
 * Compute the future server-time at which all clients should execute an
 * action, based on the P90 RTT in the room.
 */
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

/** Ordered fallback bitrates for each quality tier */
type BitrateQuality = 128 | 192 | 320 | 999

const BITRATE_FALLBACKS: Record<BitrateQuality, BitrateQuality[]> = {
  999: [320, 192, 128],
  320: [192, 128],
  192: [128],
  128: [],
}

const QUALITY_FALLBACKS: Partial<Record<AudioQuality, AudioQuality[]>> = {
  tencent_master: ['tencent_flac', 320, 192, 128],
  tencent_flac: [320, 192, 128],
}

interface ResolvedStreamUrl {
  url: string
  /** Quality tier attempted by our fallback chain. */
  attemptedBitrate: AudioQuality
  /** Bitrate actually reported/selected by the upstream provider. */
  actualBitrate: number | null
  actualQuality?: AudioQuality
  providerFormat?: string
  fileSize?: number
  fromCache: boolean
}

const SOURCE_LABELS: Record<MusicSource, string> = {
  netease: '网易云音乐',
  tencent: 'QQ 音乐',
  kugou: '酷狗音乐',
  bilibili: 'B站',
}

function qualityToBitrate(quality: AudioQuality): BitrateQuality {
  return typeof quality === 'number' ? quality : 999
}

function formatAudioQuality(bitrate: AudioQuality | number | null): string {
  if (bitrate === null) return '未知（上游未返回）'
  if (bitrate === 'tencent_master') return 'QQ 臻品母带'
  if (bitrate === 'tencent_flac') return 'QQ 无损'
  if (typeof bitrate === 'string') return bitrate
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

function isQualityDowngraded(requested: AudioQuality, stream: ResolvedStreamUrl): boolean {
  if (stream.actualQuality !== undefined) {
    if (requested === 'tencent_master') return stream.actualQuality !== 'tencent_master'
    if (requested === 'tencent_flac') {
      return stream.actualQuality !== 'tencent_master' && stream.actualQuality !== 'tencent_flac'
    }
  }
  const requestedBitrate = qualityToBitrate(requested)
  if (stream.actualBitrate !== null) return stream.actualBitrate < requestedBitrate
  return qualityToBitrate(stream.attemptedBitrate) < requestedBitrate
}

/**
 * Try to get a stream URL at the requested bitrate. If it fails, try each
 * lower tier in order until one succeeds or all options are exhausted.
 */
async function resolveStreamUrl(
  source: MusicSource,
  urlId: string,
  bitrate: AudioQuality,
  cookie?: string,
): Promise<ResolvedStreamUrl | null> {
  const result = await musicProvider.getStreamInfo(source, urlId, bitrate, cookie)
  if (result) return { ...result, attemptedBitrate: bitrate }

  // Fallback to lower bitrates
  const fallbacks = QUALITY_FALLBACKS[bitrate] ?? BITRATE_FALLBACKS[qualityToBitrate(bitrate)]
  for (const fallback of fallbacks) {
    const fallbackResult = await musicProvider.getStreamInfo(source, urlId, fallback, cookie)
    if (fallbackResult) {
      logger.warn('音质自动降级后获取到可播放资源', {
        source,
        urlId,
        requestedBitrate: bitrate,
        attemptedBitrate: fallback,
        actualBitrate: fallbackResult.actualBitrate,
      })
      return { ...fallbackResult, attemptedBitrate: fallback }
    }
  }

  return null
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

async function _playTrackInRoom(io: TypedServer, roomId: string, track: Track): Promise<boolean> {
  const room = roomRepo.get(roomId)
  if (!room) return false

  // Never trust/reuse a client-provided URL here. Resolving on the server is
  // what lets us record the provider's actual bitrate and refresh expired URLs.
  const resolved: Track = { ...track, streamUrl: undefined }
  let streamResolution: ResolvedStreamUrl | null = null
  let usedAuthenticatedAccount = false

  // Always resolve on the server so the URL is fresh and actual quality is known.
  if (!resolved.streamUrl) {
    try {
      // Get cookie from the room's pool for this platform (enables VIP access)
      const cookie = authService.getAnyCookie(resolved.source, roomId)
      const url = await resolveStreamUrl(resolved.source, resolved.urlId, room.audioQuality, cookie ?? undefined)
      if (url) usedAuthenticatedAccount = Boolean(cookie)

      if (!url) {
        const isVip = resolved.vip
        const hint = isVip && !cookie ? '（VIP 歌曲，需要有用户登录 VIP 账号）' : ''
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
          (resolved.source === 'netease' || resolved.source === 'tencent' || resolved.source === 'kugou') &&
          canAutoFallback(roomId, resolved.id)
        ) {
          // Prevent repeated fallback attempts for this queue item
          markAutoFallback(roomId, resolved.id, 60_000)
          const fromSource = resolved.source
          const trackTitle = resolved.title
          const toSource = trackFallbackService.getFallbackTargetSource(fromSource)
          if (toSource) {
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
                const cookie2 = authService.getAnyCookie(best.track.source, roomId)
                const url2 = await resolveStreamUrl(
                  best.track.source,
                  best.track.urlId,
                  room.audioQuality,
                  cookie2 ?? undefined,
                )
                if (url2) {
                  const replacement: Track = {
                    ...best.track,
                    id: resolved.id, // keep stable id so queue/current references remain consistent
                    requestedBy: resolved.requestedBy,
                    streamUrl: url2.url,
                  }
                  streamResolution = url2
                  usedAuthenticatedAccount = Boolean(cookie2)

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
                  resolved.streamUrl = replacement.streamUrl
                }
              }
            } catch (fallbackErr) {
              logger.error('跨平台自动匹配歌曲失败', fallbackErr, { roomId, trackId: resolved.id })
            }

            if (!resolved.streamUrl) {
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

        // If still no streamUrl, follow original failure path
        if (!resolved.streamUrl) {
          // Auto-remove the invalid track from the queue
          queueService.removeTrack(roomId, resolved.id)
          const room2 = roomRepo.get(roomId)
          if (room2) io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room2.queue })
          io.to(roomId).emit(EVENTS.ROOM_ERROR, {
            code: ERROR_CODE.STREAM_FAILED,
            message: `无法获取「${resolved.title}」的播放链接${hint}，已从列表移除`,
          })
          return false
        }
      }
      if (url) streamResolution = url
      resolved.streamUrl = url?.url ?? resolved.streamUrl
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

  // Update room state — align serverTimestamp with the scheduled execution time
  // so estimateCurrentTime() is accurate from the first scheduled frame.
  room.currentTrack = resolved
  const scheduleTime = getScheduleTime(roomId)
  room.playState = {
    isPlaying: true,
    currentTime: 0,
    serverTimestamp: scheduleTime,
  }
  roomRepo.persist(roomId)

  io.to(roomId).emit(EVENTS.PLAYER_PLAY, {
    track: resolved,
    playState: scheduled(room.playState, roomId, scheduleTime),
  })

  // 通知大厅用户当前播放曲目变化
  broadcastRoomList(io)

  const artistLabel = resolved.artist.filter(Boolean).join(' / ') || '未知歌手'
  const requestedQuality = formatAudioQuality(room.audioQuality)
  const actualQuality = formatResolvedAudioQuality(streamResolution)
  const qualityDowngraded = isQualityDowngraded(room.audioQuality, streamResolution)
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
      qualityDowngraded,
      streamUrlFromCache: streamResolution.fromCache,
      authenticated: usedAuthenticatedAccount,
      scheduledDelayMs: Math.max(0, scheduleTime - Date.now()),
    },
  )
  return true
}

export function resumeTrack(io: TypedServer, roomId: string, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room || !room.currentTrack) return

  const scheduleTime = getScheduleTime(roomId)
  room.playState = { ...room.playState, isPlaying: true, serverTimestamp: scheduleTime }
  roomRepo.persist(roomId)
  // All clients (including initiator) must execute at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_RESUME, { playState: scheduled(room.playState, roomId, scheduleTime) })
}

export function pauseTrack(io: TypedServer, roomId: string, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room) return

  // Snapshot estimated position before pausing so resume starts from the correct point
  const scheduleTime = getScheduleTime(roomId)
  const snapshotTime = estimateCurrentTimeAt(roomId, scheduleTime)
  room.playState = { isPlaying: false, currentTime: snapshotTime, serverTimestamp: scheduleTime }
  roomRepo.persist(roomId)
  // All clients must pause at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_PAUSE, { playState: scheduled(room.playState, roomId, scheduleTime) })
}

export function seekTrack(io: TypedServer, roomId: string, currentTime: number, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room) return

  const scheduleTime = getScheduleTime(roomId)
  // When playing, align serverTimestamp with scheduled time so estimateCurrentTime() is accurate
  room.playState = {
    ...room.playState,
    currentTime,
    serverTimestamp: room.playState.isPlaying ? scheduleTime : Date.now(),
  }
  roomRepo.persist(roomId)
  // All clients must seek at the same scheduled moment
  io.to(roomId).emit(EVENTS.PLAYER_SEEK, { playState: scheduled(room.playState, roomId, scheduleTime) })
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
    room.playState = {
      isPlaying: track !== null,
      currentTime: 0,
      serverTimestamp: Date.now(),
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
  setCurrentTrack(roomId, null)
  io.to(roomId).emit(EVENTS.PLAYER_PAUSE, {
    playState: { isPlaying: false, currentTime: 0, serverTimestamp: Date.now(), serverTimeToExecute: Date.now() },
  })
  const room = roomRepo.get(roomId)
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

/**
 * Advance to the next track in the queue. Debounce check and queue navigation
 * run inside the per-room mutex so two rapid NEXT events can never both pass
 * the debounce in the same event loop tick.
 */
export function playNextTrackInRoom(
  io: TypedServer,
  roomId: string,
  playMode: PlayMode,
  options?: { skipDebounce?: boolean },
): Promise<void> {
  return withPlayMutex(roomId, async () => {
    if (options?.skipDebounce) {
      // Still update the timestamp so a normal NEXT right after is debounced
      lastNextTimestamp.set(roomId, Date.now())
    } else if (_isNextDebounced(roomId)) {
      return
    }

    const nextTrack = queueService.getNextTrack(roomId, playMode)
    if (!nextTrack) {
      stopPlayback(io, roomId)
      return
    }

    const success = await _playTrackInRoom(io, roomId, nextTrack)
    if (!success) {
      const skipTrack = queueService.getNextTrack(roomId, playMode)
      if (skipTrack) await _playTrackInRoom(io, roomId, skipTrack)
    }

    // Refresh debounce timestamp after async work completes.
    // Without this, a second PLAYER_NEXT waiting on the mutex could pass
    // the debounce check if _playTrackInRoom took longer than 500ms (e.g.
    // stream URL resolution), causing a double-skip.
    lastNextTimestamp.set(roomId, Date.now())
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
      lastNextTimestamp.set(roomId, Date.now())
    } else if (_isNextDebounced(roomId)) {
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
    lastNextTimestamp.set(roomId, Date.now())
  })
}

// ---------------------------------------------------------------------------
// Playback sync for newly-joined clients
// ---------------------------------------------------------------------------

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

    const snapshotTimestamp = Date.now()
    const joinCalibrationDelayMs = NTP.INITIAL_INTERVAL_MS * NTP.MAX_INITIAL_SAMPLES + 100
    const scheduleTime = shouldAutoPlay
      ? Math.max(getScheduleTime(roomId), snapshotTimestamp + joinCalibrationDelayMs)
      : snapshotTimestamp
    const snapshotCurrentTime = shouldAutoPlay
      ? estimateCurrentTimeAt(roomId, scheduleTime)
      : estimateCurrentTime(roomId)

    socket.emit(EVENTS.PLAYER_PLAY, {
      track: room.currentTrack,
      playState: {
        isPlaying: shouldAutoPlay,
        currentTime: snapshotCurrentTime,
        serverTimestamp: scheduleTime,
        serverTimeToExecute: scheduleTime,
      },
    })
  } else if (isAloneInRoom && room.queue.length > 0) {
    // No current track but queue has items → start playing from queue
    const firstTrack = room.queue[0]
    await playTrackInRoom(io, roomId, firstTrack)
  }
}

// ---------------------------------------------------------------------------
// Room cleanup and debounce
// ---------------------------------------------------------------------------

/** Debounce tracking for PLAYER_NEXT per room */
const lastNextTimestamp = new Map<string, number>()

/** Remove per-room entries for a deleted room */
export function cleanupRoom(roomId: string): void {
  lastNextTimestamp.delete(roomId)
  playMutexes.delete(roomId)
}

/**
 * Check and update the next-track debounce for a room.
 * Returns true if the action should be SKIPPED (too soon), false if allowed.
 * Internal: called inside mutex to prevent same-tick race conditions.
 */
function _isNextDebounced(roomId: string): boolean {
  const now = Date.now()
  const lastNext = lastNextTimestamp.get(roomId) ?? 0
  if (now - lastNext < config.player.nextDebounceMs) return true
  lastNextTimestamp.set(roomId, now)
  return false
}
