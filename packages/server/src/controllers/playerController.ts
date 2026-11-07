import {
  EVENTS,
  ERROR_CODE,
  playerNextSchema,
  playerPlaySchema,
  playerSeekSchema,
  playerSetModeSchema,
  playerSourceSwitchSchema,
} from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { createWithPermission, defineAbilityForRoomUser } from '../middleware/withControl.js'
import { createWithRoom } from '../middleware/withRoom.js'
import { checkSocketRateLimit } from '../middleware/socketRateLimiter.js'
import { roomRepo } from '../repositories/roomRepository.js'
import * as playerService from '../services/playerService.js'
import * as roomService from '../services/roomService.js'
import * as trackFallbackService from '../services/trackFallbackService.js'
import * as authService from '../services/authService.js'
import { inferMediaFailure } from '../services/playbackFailure.js'
import { estimateCurrentTimeAt } from '../services/syncService.js'
import { logger } from '../utils/logger.js'
import { recordMediaFallbackRequest } from '../services/playbackMetrics.js'

/** Keep a roomful of failing clients from triggering the same cross-source search repeatedly. */
const lastSourceFallbackAt = new Map<string, number>()

export function registerPlayerController(io: TypedServer, socket: TypedSocket) {
  const withPermission = createWithPermission(io)
  socket.on(
    EVENTS.PLAYER_PLAY,
    withPermission('play', 'Player', async (ctx, data) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = playerPlaySchema.safeParse(data ?? {})
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的播放请求' })
        return
      }
      const track = parsed.data.track ?? ctx.room.currentTrack ?? ctx.room.queue[0]
      if (!track) return

      // Resume: same track already loaded and has stream URL → keep position
      if (!data?.track && ctx.room.currentTrack?.id === track.id && ctx.room.currentTrack?.streamUrl) {
        playerService.resumeTrack(ctx.io, ctx.roomId, ctx.socket)
        return
      }

      await playerService.playTrackInRoom(ctx.io, ctx.roomId, track)
    }),
  )

  socket.on(
    EVENTS.PLAYER_PAUSE,
    withPermission('pause', 'Player', (ctx) => {
      playerService.pauseTrack(ctx.io, ctx.roomId, ctx.socket)
    }),
  )

  socket.on(
    EVENTS.PLAYER_SEEK,
    withPermission('seek', 'Player', (ctx, data) => {
      const parsed = playerSeekSchema.safeParse(data)
      if (!parsed.success) return
      playerService.seekTrack(ctx.io, ctx.roomId, parsed.data.currentTime, ctx.socket)
    }),
  )

  // Conductor (hostId) auto-next bypasses CASL — system behavior, not manual user action.
  // Non-conductor manual next still requires CASL permission check.
  const withRoom = createWithRoom(io)
  socket.on(
    EVENTS.PLAYER_NEXT,
    withRoom(async (ctx, raw) => {
      if (ctx.user.id !== ctx.room.hostId) {
        const ability = defineAbilityForRoomUser(ctx.user.id, ctx.user.role)
        if (!ability.can('next', 'Player')) {
          ctx.socket.emit(EVENTS.ROOM_ERROR, {
            code: ERROR_CODE.NO_PERMISSION,
            message: '你没有权限执行此操作',
          })
          return
        }
      }
      // 旧客户端不带载荷：解析失败时按不带 trackId 处理，保持原有行为
      const parsed = playerNextSchema.safeParse(raw ?? {})
      await playerService.playNextTrackInRoom(ctx.io, ctx.roomId, ctx.room.playMode, {
        expectedTrackId: parsed.success ? parsed.data.trackId : undefined,
        forceRoaming: parsed.success ? parsed.data.forceRoaming : undefined,
      })
    }),
  )

  socket.on(
    EVENTS.PLAYER_PREV,
    withPermission('prev', 'Player', async (ctx) => {
      await playerService.playPrevTrackInRoom(ctx.io, ctx.roomId)
    }),
  )

  socket.on(
    EVENTS.PLAYER_REFRESH_STREAM,
    withRoom(async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const trackId = typeof raw?.trackId === 'string' ? raw.trackId : undefined
      const degrade = raw?.degrade === true
      const track = await playerService.refreshCurrentStreamUrl(ctx.roomId, trackId, { degrade })
      if (track && (!trackId || track.id === trackId)) {
        ctx.io.to(ctx.roomId).emit(EVENTS.PLAYER_STREAM_REFRESHED, { track })
      }
    }),
  )

  socket.on(
    EVENTS.PLAYER_RETRY_TRACK,
    withPermission('play', 'Player', async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const trackId = typeof raw?.trackId === 'string' ? raw.trackId : undefined
      const degrade = raw?.degrade === true
      await playerService.retryFailedTrack(ctx.io, ctx.roomId, trackId, { degrade })
    }),
  )

  socket.on(
    EVENTS.PLAYER_SOURCE_SWITCH,
    withPermission('play', 'Player', async (ctx, data) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = playerSourceSwitchSchema.safeParse(data)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的换源请求' })
        return
      }
      const result = await playerService.switchCurrentTrackSource(
        ctx.io,
        ctx.roomId,
        parsed.data.trackId,
        parsed.data.track,
      )
      if (!result.ok) {
        const message =
          result.reason === 'NO_RESOURCE'
            ? '该平台暂时无法获取播放地址'
            : result.reason === 'INVALID_SOURCE'
              ? '不能切换到当前音源'
              : '当前歌曲已变化，请重试'
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message })
      }
    }),
  )

  socket.on(
    EVENTS.PLAYER_REQUEST_SOURCE_FALLBACK,
    withPermission('play', 'Player', async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const current = ctx.room.currentTrack
      if (!current) return
      const trackId = typeof raw?.trackId === 'string' ? raw.trackId : undefined
      if (trackId && trackId !== current.id) return

      const now = Date.now()
      if (now - (lastSourceFallbackAt.get(ctx.roomId) ?? 0) < 15_000) return
      lastSourceFallbackAt.set(ctx.roomId, now)
      recordMediaFallbackRequest()

      const candidates = await trackFallbackService.findAlternativeTracks(current, 1)
      const best = candidates[0]
      if (!best) {
        const auth = authService.getBestAuth(current.source, ctx.roomId)
        ctx.socket.emit(EVENTS.PLAYER_PLAYBACK_FAILURE, {
          trackId: current.id,
          track: current,
          failure: inferMediaFailure(current, Boolean(auth)),
          // A single client's media failure must not interrupt the rest of the
          // room; keep the room playing and let this listener choose.
          nextAction: 'stop',
        })
        return
      }

      const result = await playerService.switchCurrentTrackSource(
        ctx.io,
        ctx.roomId,
        current.id,
        best.track,
        'automatic',
      )
      if (!result.ok) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.STREAM_FAILED,
          message: '替代音源也无法播放',
        })
      }
    }),
  )

  socket.on(
    EVENTS.PLAYER_SET_MODE,
    withPermission('set-mode', 'Player', (ctx, data) => {
      const parsed = playerSetModeSchema.safeParse(data)
      if (!parsed.success) return
      ctx.room.playMode = parsed.data.mode
      roomRepo.persist(ctx.roomId)
      // Broadcast updated room state so all clients see the new play mode
      ctx.io.to(ctx.roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(ctx.room))
      logger.info(`房间 ${ctx.roomId} 的播放模式已切换为 ${parsed.data.mode}`, {
        event: 'player.mode_changed',
        roomId: ctx.roomId,
        playMode: parsed.data.mode,
        operatorId: ctx.user.id,
        operator: ctx.user.nickname,
      })
    }),
  )

  // ---------------------------------------------------------------------------
  // NTP clock synchronisation – reply instantly with server time
  // ---------------------------------------------------------------------------
  socket.on(EVENTS.NTP_PING, (data) => {
    try {
      // Store client-reported RTT for adaptive scheduling delay
      if (data?.lastRttMs != null && data.lastRttMs > 0 && data.lastRttMs <= 10_000) {
        roomRepo.setSocketRTT(socket.id, data.lastRttMs)
      }

      socket.emit(EVENTS.NTP_PONG, {
        clientPingId: data?.clientPingId ?? 0,
        serverTime: Date.now(),
      })
    } catch (err) {
      logger.error('NTP_PING handler error', err, { socketId: socket.id })
    }
  })

  socket.on(EVENTS.PLAYER_SYNC_REQUEST, () => {
    try {
      const mapping = roomRepo.getSocketMapping(socket.id)
      if (!mapping) return
      const room = roomRepo.get(mapping.roomId)
      if (!room) return

      const serverTimestamp = Date.now()
      socket.emit(EVENTS.PLAYER_SYNC_RESPONSE, {
        currentTime: estimateCurrentTimeAt(mapping.roomId, serverTimestamp),
        isPlaying: room.playState.isPlaying,
        serverTimestamp,
        trackId: room.currentTrack?.id ?? null,
      })
    } catch (err) {
      logger.error('PLAYER_SYNC_REQUEST handler error', err, {
        socketId: socket.id,
      })
    }
  })
}
