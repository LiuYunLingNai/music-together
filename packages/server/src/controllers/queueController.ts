import {
  EVENTS,
  ERROR_CODE,
  queueAddSchema,
  queueAddBatchSchema,
  queueInsertAfterCurrentSchema,
  queueRemoveSchema,
  queueReorderSchema,
  queueUpdateMetadataSchema,
} from '@music-together/shared'
import type { Track } from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { createWithPermission } from '../middleware/withControl.js'
import { checkSocketRateLimit } from '../middleware/socketRateLimiter.js'
import * as chatService from '../services/chatService.js'
import * as playerService from '../services/playerService.js'
import * as queueService from '../services/queueService.js'
import { userRepo } from '../repositories/userRepository.js'
import { logger } from '../utils/logger.js'

export function registerQueueController(io: TypedServer, socket: TypedSocket) {
  const withPermission = createWithPermission(io)
  const canManageQueue = (
    userId: string,
    room: { temporaryAdminUserId: string | null },
    allowedForTemporaryAdmin: boolean,
  ) => room.temporaryAdminUserId !== userId || allowedForTemporaryAdmin || userRepo.isServerAdmin(userId)

  socket.on(
    EVENTS.QUEUE_ADD,
    withPermission('add', 'Queue', async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = queueAddSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '无效的歌曲数据' })
        return
      }
      const track: Track = { ...parsed.data.track, requestedBy: ctx.user.nickname }

      const added = queueService.addTrack(ctx.roomId, track)
      if (!added) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.QUEUE_FULL, message: '播放队列已满' })
        return
      }
      io.to(ctx.roomId).emit(EVENTS.QUEUE_UPDATED, { queue: ctx.room.queue })

      // System message
      const msg = chatService.createSystemMessage(ctx.roomId, `${ctx.user.nickname} 点了一首「${track.title}」`)
      io.to(ctx.roomId).emit(EVENTS.CHAT_MESSAGE, msg)

      // If nothing was playing, auto-play this track.
      // Uses autoPlayIfEmpty which re-checks room.currentTrack inside the
      // per-room mutex, preventing concurrent QUEUE_ADD handlers from both
      // triggering playback.
      await playerService.autoPlayIfEmpty(io, ctx.roomId, track)

      logger.info(`“${ctx.user.nickname}”点歌：《${track.title}》`, {
        event: 'queue.track_added',
        roomId: ctx.roomId,
        trackId: track.id,
        title: track.title,
        artists: track.artist,
        source: track.source,
        requestedBy: ctx.user.nickname,
        queueSize: ctx.room.queue.length,
      })
    }),
  )

  socket.on(
    EVENTS.QUEUE_INSERT_AFTER_CURRENT,
    withPermission('add', 'Queue', async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = queueInsertAfterCurrentSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '无效的歌曲数据' })
        return
      }
      const track: Track = { ...parsed.data.track, requestedBy: ctx.user.nickname }

      const added = queueService.insertAfterCurrent(ctx.roomId, track)
      if (!added) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.QUEUE_FULL, message: '播放队列已满' })
        return
      }
      io.to(ctx.roomId).emit(EVENTS.QUEUE_UPDATED, { queue: ctx.room.queue })

      // System message
      const msg = chatService.createSystemMessage(ctx.roomId, `${ctx.user.nickname} 置顶了一首「${track.title}」`)
      io.to(ctx.roomId).emit(EVENTS.CHAT_MESSAGE, msg)

      // If nothing was playing, auto-play this track.
      await playerService.autoPlayIfEmpty(io, ctx.roomId, track)

      logger.info(`“${ctx.user.nickname}”置顶下一首：《${track.title}》`, {
        event: 'queue.track_inserted_next',
        roomId: ctx.roomId,
        trackId: track.id,
        title: track.title,
        artists: track.artist,
        source: track.source,
        requestedBy: ctx.user.nickname,
        queueSize: ctx.room.queue.length,
      })
    }),
  )

  socket.on(
    EVENTS.QUEUE_ADD_BATCH,
    withPermission('add', 'Queue', async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = queueAddBatchSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '无效的歌曲数据' })
        return
      }
      const { tracks: rawTracks, playlistName } = parsed.data
      const tracks: Track[] = rawTracks.map((t) => ({ ...t, requestedBy: ctx.user.nickname }))

      const addedCount = queueService.addBatchTracks(ctx.roomId, tracks)
      if (addedCount === 0) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.QUEUE_FULL, message: '播放队列已满' })
        return
      }
      io.to(ctx.roomId).emit(EVENTS.QUEUE_UPDATED, { queue: ctx.room.queue })

      const label = playlistName ? `歌单「${playlistName}」` : '歌单'
      const msg = chatService.createSystemMessage(
        ctx.roomId,
        `${ctx.user.nickname} 从${label}导入了 ${addedCount} 首歌`,
      )
      io.to(ctx.roomId).emit(EVENTS.CHAT_MESSAGE, msg)

      // Auto-play first added track if nothing is playing
      if (addedCount > 0) {
        await playerService.autoPlayIfEmpty(io, ctx.roomId, tracks[0])
      }

      logger.info(`“${ctx.user.nickname}”从歌单批量加入 ${addedCount} 首歌曲`, {
        event: 'queue.batch_added',
        roomId: ctx.roomId,
        playlistName: playlistName ?? '未命名歌单',
        requestedCount: rawTracks.length,
        addedCount,
        requestedBy: ctx.user.nickname,
        queueSize: ctx.room.queue.length,
      })
    }),
  )

  socket.on(
    EVENTS.QUEUE_REMOVE,
    withPermission('remove', 'Queue', async (ctx, raw) => {
      if (!canManageQueue(ctx.user.id, ctx.room, ctx.room.allowTemporaryAdminTrackRemoval)) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.NO_PERMISSION,
          message: '房主未允许临时管理员删除歌曲',
        })
        return
      }
      const parsed = queueRemoveSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '无效的移除请求' })
        return
      }
      const { trackId } = parsed.data
      const removedTrack = ctx.room.queue.find((track) => track.id === trackId)
      const isCurrentTrack = ctx.room.currentTrack?.id === trackId

      queueService.removeTrack(ctx.roomId, trackId)
      io.to(ctx.roomId).emit(EVENTS.QUEUE_UPDATED, { queue: ctx.room.queue })

      // If the removed track was currently playing, skip to next or stop.
      // skipDebounce: removing current track must always advance, regardless
      // of how recently the last NEXT was triggered.
      if (isCurrentTrack) {
        await playerService.playNextTrackInRoom(io, ctx.roomId, ctx.room.playMode, { skipDebounce: true })
      }

      logger.info(`已从播放队列移除《${removedTrack?.title ?? trackId}》`, {
        event: 'queue.track_removed',
        roomId: ctx.roomId,
        trackId,
        title: removedTrack?.title,
        operatorId: ctx.user.id,
        operator: ctx.user.nickname,
        wasPlaying: isCurrentTrack,
        queueSize: ctx.room.queue.length,
      })
    }),
  )

  socket.on(
    EVENTS.QUEUE_REORDER,
    withPermission('reorder', 'Queue', (ctx, raw) => {
      const parsed = queueReorderSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '无效的排序数据' })
        return
      }
      const { trackIds } = parsed.data
      queueService.reorderTracks(ctx.roomId, trackIds)
      io.to(ctx.roomId).emit(EVENTS.QUEUE_UPDATED, { queue: ctx.room.queue })
      logger.info(`房间 ${ctx.roomId} 的播放队列顺序已调整`, {
        event: 'queue.reordered',
        roomId: ctx.roomId,
        operatorId: ctx.user.id,
        operator: ctx.user.nickname,
        queueSize: ctx.room.queue.length,
      })
    }),
  )

  socket.on(
    EVENTS.QUEUE_UPDATE_METADATA,
    withPermission('add', 'Queue', async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = queueUpdateMetadataSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '无效的歌词和封面数据' })
        return
      }

      const { trackId, metadataSource, lyricId, picId, cover, clearMetadata } = parsed.data
      const existing = ctx.room.queue.find((track) => track.id === trackId)
      if (!existing || existing.source !== 'bilibili') {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '只能更新队列中的 B 站视频' })
        return
      }
      if (!clearMetadata && (!metadataSource || !cover)) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '无效的歌词和封面数据' })
        return
      }

      const updated = queueService.updateBilibiliMetadata(ctx.roomId, trackId, {
        metadataSource: clearMetadata ? undefined : metadataSource,
        lyricId: clearMetadata ? undefined : lyricId,
        picId: clearMetadata ? undefined : picId,
        cover: clearMetadata ? existing.bilibiliCover || existing.cover : cover!,
      })
      if (!updated) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_DATA, message: '只能更新队列中的 B 站视频' })
        return
      }

      io.to(ctx.roomId).emit(EVENTS.QUEUE_UPDATED, { queue: ctx.room.queue })
      if (ctx.room.currentTrack?.id === trackId) {
        io.to(ctx.roomId).emit(EVENTS.PLAYER_TRACK_METADATA_UPDATED, { track: ctx.room.currentTrack })
      }
      logger.info(`“${ctx.user.nickname}”更新了《${updated.title}》的歌词和封面`, {
        event: 'queue.bilibili_metadata_updated',
        roomId: ctx.roomId,
        trackId,
        metadataSource: metadataSource ?? 'bilibili',
        operatorId: ctx.user.id,
      })
    }),
  )

  socket.on(
    EVENTS.QUEUE_CLEAR,
    withPermission('remove', 'Queue', async (ctx) => {
      if (!canManageQueue(ctx.user.id, ctx.room, ctx.room.allowTemporaryAdminQueueClear)) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.NO_PERMISSION,
          message: '房主未允许临时管理员清空播放列表',
        })
        return
      }
      queueService.clearQueue(ctx.roomId)
      io.to(ctx.roomId).emit(EVENTS.QUEUE_UPDATED, { queue: [] })

      // Stop playback via mutex-protected variant to prevent races with
      // concurrent autoPlayIfEmpty from a simultaneous QUEUE_ADD.
      await playerService.stopPlaybackSafe(io, ctx.roomId)

      logger.info(`“${ctx.user.nickname}”清空了房间 ${ctx.roomId} 的播放队列`, {
        event: 'queue.cleared',
        roomId: ctx.roomId,
        operatorId: ctx.user.id,
        operator: ctx.user.nickname,
      })
    }),
  )
}
