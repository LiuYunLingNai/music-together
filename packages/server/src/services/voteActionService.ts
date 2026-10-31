import { ERROR_CODE, EVENTS, playerSetModeSchema } from '@music-together/shared'
import type { VoteAction } from '@music-together/shared'
import type { TypedServer } from '../middleware/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import type { RoomData } from '../repositories/types.js'
import { toPublicRoomState } from '../utils/roomUtils.js'
import { logger } from '../utils/logger.js'
import * as playerService from './playerService.js'
import * as queueService from './queueService.js'

/**
 * 投票期间歌曲自然播完时，这次「下一首/上一首」已经指向另一首歌。
 * 没有记录曲目（例如旧流程）或房间当前没有曲目时不做拦截。
 */
function isStaleTrackVote(room: RoomData, expectedTrackId?: string): boolean {
  if (!expectedTrackId) return false
  const currentId = room.currentTrack?.id
  if (!currentId || currentId === expectedTrackId) return false
  logger.debug('投票期间曲目已切换，丢弃这次切歌投票', {
    event: 'vote.stale_track_action',
    roomId: room.id,
    expectedTrackId,
    currentTrackId: currentId,
  })
  return true
}

/** Execute one action after direct permission or an atomically claimed vote. */
export async function executeVoteAction(
  io: TypedServer,
  roomId: string,
  action: VoteAction,
  payload?: Record<string, unknown>,
  /** 发起投票时的当前曲目；切歌类动作借它判断投票期间是否已经换过歌。 */
  expectedTrackId?: string,
): Promise<boolean> {
  switch (action) {
    case 'pause':
      playerService.pauseTrack(io, roomId)
      return true
    case 'resume':
      // 已经在播放时按无操作处理，避免整个房间的时间线退回暂停那一刻
      return playerService.resumeTrack(io, roomId)
    case 'next': {
      const room = roomRepo.get(roomId)
      if (!room) return false
      if (isStaleTrackVote(room, expectedTrackId)) return false
      await playerService.playNextTrackInRoom(io, roomId, room.playMode, {
        skipDebounce: true,
        expectedTrackId,
      })
      return true
    }
    case 'prev': {
      const room = roomRepo.get(roomId)
      if (!room) return false
      if (isStaleTrackVote(room, expectedTrackId)) return false
      await playerService.playPrevTrackInRoom(io, roomId, { skipDebounce: true })
      return true
    }
    case 'set-mode': {
      const parsed = playerSetModeSchema.safeParse(payload)
      if (!parsed.success) {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的播放模式' })
        return false
      }
      const room = roomRepo.get(roomId)
      if (!room) return false
      room.playMode = parsed.data.mode
      roomRepo.persist(roomId)
      io.to(roomId).emit(EVENTS.ROOM_STATE, toPublicRoomState(room))
      logger.info('Vote changed play mode', { event: 'player.mode_changed_by_vote', roomId, mode: parsed.data.mode })
      return true
    }
    case 'play-track': {
      const trackId = payload?.trackId
      if (typeof trackId !== 'string') {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的歌曲 ID' })
        return false
      }
      const room = roomRepo.get(roomId)
      const track = room?.queue.find((item) => item.id === trackId)
      if (!track) {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '歌曲不在播放列表中' })
        return false
      }
      return playerService.playTrackInRoom(io, roomId, track)
    }
    case 'remove-track': {
      const trackId = payload?.trackId
      if (typeof trackId !== 'string') {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的歌曲 ID' })
        return false
      }
      const room = roomRepo.get(roomId)
      if (!room || !room.queue.some((item) => item.id === trackId)) return false
      const isCurrentTrack = room.currentTrack?.id === trackId
      const successor = isCurrentTrack ? queueService.getSuccessorAfterRemoval(roomId, trackId, room.playMode) : null
      queueService.removeTrack(roomId, trackId)
      io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room.queue })
      if (isCurrentTrack) {
        if (successor) await playerService.playTrackInRoom(io, roomId, successor)
        else playerService.stopPlayback(io, roomId)
      }
      logger.info('Vote removed queue track', { event: 'queue.track_removed_by_vote', roomId, trackId })
      return true
    }
  }
}
