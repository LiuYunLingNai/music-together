import {
  EVENTS,
  ERROR_CODE,
  TIMING,
  defineAbilityFor,
  voteStartSchema,
  voteCastSchema,
  playerSetModeSchema,
} from '@music-together/shared'
import type { Actions, Subjects, PlayMode, VoteAction } from '@music-together/shared'
import { createWithRoom } from '../middleware/withRoom.js'
import { checkSocketRateLimit } from '../middleware/socketRateLimiter.js'
import { roomRepo } from '../repositories/roomRepository.js'
import * as voteService from '../services/voteService.js'
import * as playerService from '../services/playerService.js'
import * as queueService from '../services/queueService.js'
import * as roomService from '../services/roomService.js'
import { logger } from '../utils/logger.js'
import type { TypedServer, TypedSocket } from '../middleware/types.js'

const ACTION_LABELS: Record<VoteAction, string> = {
  pause: '暂停播放',
  resume: '继续播放',
  next: '播放下一首',
  prev: '播放上一首',
  'set-mode': '切换播放模式',
  'play-track': '播放指定歌曲',
  'remove-track': '移除歌曲',
}

/**
 * Execute the voted action on the player.
 * No initiatorSocket — broadcast to everyone since this is a collective decision.
 */
async function executeAction(
  io: TypedServer,
  roomId: string,
  action: VoteAction,
  payload?: Record<string, unknown>,
): Promise<void> {
  switch (action) {
    case 'pause':
      playerService.pauseTrack(io, roomId)
      break
    case 'resume':
      playerService.resumeTrack(io, roomId)
      break
    case 'next': {
      const room = roomRepo.get(roomId)
      await playerService.playNextTrackInRoom(io, roomId, room?.playMode ?? 'sequential', { skipDebounce: true })
      break
    }
    case 'prev': {
      await playerService.playPrevTrackInRoom(io, roomId, { skipDebounce: true })
      break
    }
    case 'set-mode': {
      const parsed = playerSetModeSchema.safeParse(payload)
      if (!parsed.success) {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的播放模式' })
        break
      }
      const room = roomRepo.get(roomId)
      if (!room) break
      room.playMode = parsed.data.mode
      roomRepo.persist(roomId)
      io.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
      logger.info(`投票通过：房间 ${roomId} 的播放模式已切换为 ${parsed.data.mode}`, {
        event: 'player.mode_changed_by_vote',
        roomId,
        playMode: parsed.data.mode,
      })
      break
    }
    case 'play-track': {
      const trackId = payload?.trackId
      if (typeof trackId !== 'string') {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的歌曲 ID' })
        break
      }
      const room = roomRepo.get(roomId)
      if (!room) break
      const track = room.queue.find((t) => t.id === trackId)
      if (track) {
        await playerService.playTrackInRoom(io, roomId, track)
        logger.debug('投票操作已触发指定歌曲播放', { roomId, trackId })
      } else {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '歌曲不在播放列表中' })
      }
      break
    }
    case 'remove-track': {
      const trackId = payload?.trackId
      if (typeof trackId !== 'string') {
        io.to(roomId).emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的歌曲 ID' })
        break
      }
      const room = roomRepo.get(roomId)
      if (!room) break
      const isCurrentTrack = room.currentTrack?.id === trackId
      queueService.removeTrack(roomId, trackId)
      io.to(roomId).emit(EVENTS.QUEUE_UPDATED, { queue: room.queue })
      if (isCurrentTrack) {
        await playerService.playNextTrackInRoom(io, roomId, room.playMode, { skipDebounce: true })
      }
      logger.info(`投票操作已从队列移除歌曲 ${trackId}`, {
        event: 'queue.track_removed_by_vote',
        roomId,
        trackId,
        wasPlaying: isCurrentTrack,
      })
      break
    }
  }
}

export function registerVoteController(io: TypedServer, socket: TypedSocket) {
  const withRoom = createWithRoom(io)

  socket.on(
    EVENTS.VOTE_START,
    withRoom(async (ctx, raw) => {
      if (!(await checkSocketRateLimit(ctx.socket))) return
      const parsed = voteStartSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的投票请求' })
        return
      }

      const { action, payload } = parsed.data

      // Check if user has direct permission (owner/admin don't need to vote).
      // VoteAction includes 'resume' which is not in CASL Actions — cast is intentional.
      // Some vote actions map to a different CASL action for permission checks
      // (e.g. 'play-track' requires the same 'play' permission as normal playback).
      // Safety net: if the client mistakenly routes through VOTE_START (e.g. due to
      // client-server role desync), execute the action directly instead of returning an error.
      const PERM_MAP: Partial<Record<VoteAction, { action: string; subject: string }>> = {
        'play-track': { action: 'play', subject: 'Player' },
        'remove-track': { action: 'remove', subject: 'Queue' },
      }
      const ability = defineAbilityFor(ctx.user.role)
      const perm = PERM_MAP[action]
      const permAction = perm?.action ?? action
      const permSubject = perm?.subject ?? 'Player'
      if (ability.can(permAction as Actions, permSubject as Subjects)) {
        await executeAction(io, ctx.roomId, action, payload)
        logger.debug(`有权限的用户“${ctx.user.nickname}”直接执行：${ACTION_LABELS[action]}`, {
          roomId: ctx.roomId,
          userId: ctx.user.id,
          role: ctx.user.role,
          action,
        })
        return
      }

      // Check if user can vote
      if (!ability.can('vote', 'Player')) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.NO_PERMISSION, message: '你没有投票权限' })
        return
      }

      const vote = voteService.createVote(ctx.roomId, ctx.room.hostId, ctx.user, action, ctx.room.users.length, payload)

      if (!vote) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.VOTE_IN_PROGRESS, message: '已有投票正在进行中' })
        return
      }

      // Check if the vote is already decided (e.g. only 1-2 users in the room)
      const approveCount = Object.values(vote.votes).filter(Boolean).length
      if (approveCount >= vote.requiredVotes) {
        // Auto-pass: execute immediately
        clearTimeout(vote.timeoutHandle)
        await executeAction(io, ctx.roomId, action, vote.payload)
        io.to(ctx.roomId).emit(EVENTS.VOTE_RESULT, { passed: true, action })
        voteService.cancelVote(ctx.roomId)
        return
      }

      // Set timeout for auto-reject
      vote.timeoutHandle = setTimeout(() => {
        io.to(ctx.roomId).emit(EVENTS.VOTE_RESULT, { passed: false, action, reason: 'timeout' })
        voteService.cancelVote(ctx.roomId)
        logger.info(`房间 ${ctx.roomId} 的“${ACTION_LABELS[action]}”投票已超时`, {
          event: 'vote.timed_out',
          roomId: ctx.roomId,
          action,
        })
      }, TIMING.VOTE_TIMEOUT_MS)

      // Broadcast vote started
      io.to(ctx.roomId).emit(EVENTS.VOTE_STARTED, voteService.toVoteState(vote))
    }),
  )

  socket.on(
    EVENTS.VOTE_CAST,
    withRoom(async (ctx, raw) => {
      const parsed = voteCastSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INVALID_INPUT, message: '无效的投票数据' })
        return
      }

      const result = voteService.castVote(ctx.roomId, ctx.user.id, parsed.data.approve)
      if (!result) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.ALREADY_VOTED, message: '你已经投过票了' })
        return
      }

      // Broadcast updated vote state
      io.to(ctx.roomId).emit(EVENTS.VOTE_STARTED, voteService.toVoteState(result.vote))

      if (result.decided) {
        clearTimeout(result.vote.timeoutHandle)

        if (result.passed) {
          await executeAction(io, ctx.roomId, result.vote.action, result.vote.payload)
        }

        io.to(ctx.roomId).emit(EVENTS.VOTE_RESULT, {
          passed: result.passed,
          action: result.vote.action,
          reason: result.reason,
        })

        voteService.cancelVote(ctx.roomId)
      }
    }),
  )
}
