import { EVENTS, ERROR_CODE, playerSeekSchema, playerSetModeSchema } from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { createWithPermission, defineAbilityForRoomUser } from '../middleware/withControl.js'
import { createWithRoom } from '../middleware/withRoom.js'
import { checkSocketRateLimit } from '../middleware/socketRateLimiter.js'
import { roomRepo } from '../repositories/roomRepository.js'
import * as playerService from '../services/playerService.js'
import * as roomService from '../services/roomService.js'
import { estimateCurrentTimeAt } from '../services/syncService.js'
import { logger } from '../utils/logger.js'

export function registerPlayerController(io: TypedServer, socket: TypedSocket) {
  const withPermission = createWithPermission(io)

  socket.on(
    EVENTS.PLAYER_PLAY,
    withPermission('play', 'Player', async (ctx, data) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const track = data?.track ?? ctx.room.currentTrack ?? ctx.room.queue[0]
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
    withRoom(async (ctx) => {
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
      await playerService.playNextTrackInRoom(ctx.io, ctx.roomId, ctx.room.playMode)
    }),
  )

  socket.on(
    EVENTS.PLAYER_PREV,
    withPermission('prev', 'Player', async (ctx) => {
      await playerService.playPrevTrackInRoom(ctx.io, ctx.roomId)
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
