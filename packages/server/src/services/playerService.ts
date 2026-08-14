import type { AudioQuality, MusicSource, PlayMode, PlayState, ScheduledPlayState, Track } from '@music-together/shared'
import { EVENTS, ERROR_CODE, NTP, TIMING, clampPlaybackPosition, nextPlaybackRevision } from '@music-together/shared'
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
import { getEffectiveQuality, providerQualityRank, type MembershipTier } from './audioQualityPolicy.js'

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
  const result = await musicProvider.getStreamInfo(source, urlId, attemptedBitrate, cookie, forceRefresh, vipType)
  return result ? { ...result, attemptedBitrate } : null
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
  const resolved: Track = {
    ...track,
    streamUrl: undefined,
    streamFormat: undefined,
    requiresServerProxy: undefined,
  }
  let streamResolution: ResolvedStreamUrl | null = null
  let usedAuthenticatedAccount = false

  // Always resolve on the server so the URL is fresh and actual quality is known.
  if (!resolved.streamUrl) {
    try {
      const platformAuth = authService.getBestAuth(resolved.source, roomId)
      const cookie = platformAuth?.cookie
      const url = await resolveStreamUrl(
        resolved.source,
        resolved.urlId,
        room.audioQuality,
        cookie,
        false,
        platformAuth?.vipType ?? 0,
      )
      if (url) usedAuthenticatedAccount = Boolean(platformAuth)

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
                  resolved.streamUrl = replacement.streamUrl
                  resolved.streamFormat = replacement.streamFormat
                  resolved.requiresServerProxy = replacement.requiresServerProxy
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

  // Update room state — align serverTimestamp with the scheduled execution time
  // so estimateCurrentTime() is accurate from the first scheduled frame.
  room.currentTrack = resolved
  lastStreamUrlRefreshAt.set(roomId, Date.now())
  const scheduleTime = getScheduleTime(roomId)
  room.playState = {
    isPlaying: true,
    currentTime: 0,
    serverTimestamp: scheduleTime,
    revision: nextPlaybackRevision(room.playState),
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

export function resumeTrack(io: TypedServer, roomId: string, _initiatorSocket?: TypedSocket): void {
  const room = roomRepo.get(roomId)
  if (!room || !room.currentTrack) return

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
    revision: nextPlaybackRevision(room.playState),
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
      lastSkipTimestamp.set(roomId, { action: 'next', timestamp: Date.now() })
    } else if (_isSkipDebounced(roomId, 'next')) {
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
    if (!room?.permanent || !track) return false

    const now = Date.now()
    const lastRefreshAt = lastStreamUrlRefreshAt.get(roomId) ?? 0
    const refreshInterval = track.streamUrl
      ? TIMING.STREAM_URL_REFRESH_INTERVAL_MS
      : TIMING.STREAM_URL_REFRESH_RETRY_INTERVAL_MS
    if (now - lastRefreshAt < refreshInterval) return false

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
  lastSkipTimestamp.delete(roomId)
  lastStreamUrlRefreshAt.delete(roomId)
  playMutexes.delete(roomId)
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
