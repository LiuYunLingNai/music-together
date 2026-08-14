import { EVENTS, ERROR_CODE, TIMING, voteStartSchema, voteCastSchema } from '@music-together/shared'
import type { Actions, Subjects, VoteAction } from '@music-together/shared'
import { createWithRoom } from '../middleware/withRoom.js'
import { defineAbilityForRoomUser } from '../middleware/withControl.js'
import { checkSocketRateLimit } from '../middleware/socketRateLimiter.js'
import * as voteService from '../services/voteService.js'
import { executeVoteAction } from '../services/voteActionService.js'
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
      const ability = defineAbilityForRoomUser(ctx.user.id, ctx.user.role)
      const perm = PERM_MAP[action]
      const permAction = perm?.action ?? action
      const permSubject = perm?.subject ?? 'Player'
      if (ability.can(permAction as Actions, permSubject as Subjects)) {
        const executed = await executeVoteAction(io, ctx.roomId, action, payload)
        if (!executed) return
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
        const claimedVote = voteService.claimVote(ctx.roomId, vote.id)
        if (!claimedVote) return
        const executed = await executeVoteAction(io, ctx.roomId, claimedVote.action, claimedVote.payload)
        io.to(ctx.roomId).emit(EVENTS.VOTE_RESULT, {
          passed: executed,
          action: claimedVote.action,
          reason: executed ? undefined : 'action_failed',
        })
        return
      }

      // Set timeout for auto-reject
      vote.timeoutHandle = setTimeout(() => {
        const claimedVote = voteService.claimVote(ctx.roomId, vote.id)
        if (!claimedVote) return
        io.to(ctx.roomId).emit(EVENTS.VOTE_RESULT, { passed: false, action, reason: 'timeout' })
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
        const claimedVote = voteService.claimVote(ctx.roomId, result.vote.id)
        if (!claimedVote) return

        const executed = result.passed
          ? await executeVoteAction(io, ctx.roomId, claimedVote.action, claimedVote.payload)
          : false

        io.to(ctx.roomId).emit(EVENTS.VOTE_RESULT, {
          passed: result.passed && executed,
          action: claimedVote.action,
          reason: result.passed && !executed ? 'action_failed' : result.reason,
        })
      }
    }),
  )
}
