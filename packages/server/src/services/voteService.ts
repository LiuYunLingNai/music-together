import { nanoid } from 'nanoid'
import type { VoteAction, VoteState, User } from '@music-together/shared'
import { TIMING } from '@music-together/shared'
import { logger } from '../utils/logger.js'

interface Vote {
  id: string
  roomId: string
  action: VoteAction
  initiatorId: string
  initiatorNickname: string
  votes: Record<string, boolean>
  requiredVotes: number
  totalUsers: number
  expiresAt: number
  timeoutHandle: ReturnType<typeof setTimeout>
  hostId: string
  payload?: Record<string, unknown>
}

export interface VoteDecision {
  vote: Vote
  decided: boolean
  passed: boolean
  reason?: 'host_veto' | 'rejected'
}

/** Active vote per room (at most one at a time) */
const activeVotes = new Map<string, Vote>()

/**
 * Create a new vote. Returns null if a vote is already in progress.
 * The initiator automatically votes "approve".
 */
export function createVote(
  roomId: string,
  hostId: string,
  initiator: User,
  action: VoteAction,
  totalUsers: number,
  payload?: Record<string, unknown>,
): Vote | null {
  if (activeVotes.has(roomId)) return null

  const requiredVotes = Math.floor(totalUsers / 2) + 1

  const vote: Vote = {
    id: nanoid(8),
    roomId,
    action,
    initiatorId: initiator.id,
    initiatorNickname: initiator.nickname,
    votes: { [initiator.id]: true }, // auto-approve by initiator
    requiredVotes,
    totalUsers,
    expiresAt: Date.now() + TIMING.VOTE_TIMEOUT_MS,
    timeoutHandle: null as unknown as ReturnType<typeof setTimeout>, // set by controller
    hostId,
    payload,
  }

  activeVotes.set(roomId, vote)
  logger.info(`用户“${initiator.nickname}”在房间 ${roomId} 发起投票：${action}`, {
    event: 'vote.created',
    roomId,
    voteId: vote.id,
    action,
    initiatorId: initiator.id,
    initiator: initiator.nickname,
    requiredVotes,
    totalUsers,
  })
  return vote
}

/**
 * Cast a vote. Returns the result or null if no active vote.
 * Conductor veto: if conductor (hostId) votes reject, immediately decided as failed.
 */
function evaluateVote(vote: Vote): VoteDecision {
  if (vote.votes[vote.hostId] === false) {
    return { vote, decided: true, passed: false, reason: 'host_veto' }
  }

  const approveCount = Object.values(vote.votes).filter(Boolean).length
  const rejectCount = Object.values(vote.votes).filter((value) => !value).length

  if (approveCount >= vote.requiredVotes) return { vote, decided: true, passed: true }
  if (rejectCount > vote.totalUsers - vote.requiredVotes) {
    return { vote, decided: true, passed: false, reason: 'rejected' }
  }
  return { vote, decided: false, passed: false }
}

export function castVote(roomId: string, userId: string, approve: boolean): VoteDecision | null {
  const vote = activeVotes.get(roomId)
  if (!vote) return null

  // Already voted
  if (userId in vote.votes) return null

  vote.votes[userId] = approve

  // Conductor veto check
  if (userId === vote.hostId && !approve) {
    return { vote, decided: true, passed: false, reason: 'host_veto' }
  }

  return evaluateVote(vote)
}

/** Reconcile votes, threshold and veto authority against current online membership. */
export function reconcileVote(
  roomId: string,
  currentUserIds: readonly string[],
  currentHostId: string,
): VoteDecision | null {
  const vote = activeVotes.get(roomId)
  if (!vote) return null

  const onlineUsers = new Set(currentUserIds)
  for (const userId of Object.keys(vote.votes)) {
    if (!onlineUsers.has(userId)) delete vote.votes[userId]
  }
  vote.totalUsers = currentUserIds.length
  vote.requiredVotes = Math.floor(vote.totalUsers / 2) + 1
  vote.hostId = currentHostId
  return evaluateVote(vote)
}

/**
 * Update the vote threshold when users leave during an active vote.
 * Recalculates requiredVotes based on current user count and removes
 * the departing user's vote if they had cast one.
 *
 * Returns true if the vote state was modified (caller should broadcast updated state).
 */
export function updateVoteThreshold(roomId: string, currentUserCount: number, departedUserId?: string): boolean {
  const vote = activeVotes.get(roomId)
  if (!vote) return false

  // Remove departed user's vote if they had cast one
  if (departedUserId && departedUserId in vote.votes) {
    delete vote.votes[departedUserId]
  }

  const newRequired = Math.floor(currentUserCount / 2) + 1
  vote.requiredVotes = newRequired
  vote.totalUsers = currentUserCount
  logger.debug('房间人数变化，投票通过门槛已更新', {
    roomId,
    requiredVotes: newRequired,
    totalUsers: currentUserCount,
  })
  return true
}

export function getActiveVote(roomId: string): Vote | null {
  return activeVotes.get(roomId) ?? null
}

/** Atomically remove a decided vote before awaiting its side effect. */
export function claimVote(roomId: string, voteId: string): Vote | null {
  const vote = activeVotes.get(roomId)
  if (!vote || vote.id !== voteId) return null
  activeVotes.delete(roomId)
  clearTimeout(vote.timeoutHandle)
  return vote
}

export function cancelVote(roomId: string, voteId?: string): void {
  const vote = activeVotes.get(roomId)
  if (!vote || (voteId !== undefined && vote.id !== voteId)) return
  clearTimeout(vote.timeoutHandle)
  activeVotes.delete(roomId)
}

export function cleanupRoom(roomId: string): void {
  cancelVote(roomId)
}

/** Convert internal Vote to client-safe VoteState */
export function toVoteState(vote: Vote): VoteState {
  return {
    id: vote.id,
    action: vote.action,
    initiatorId: vote.initiatorId,
    initiatorNickname: vote.initiatorNickname,
    votes: { ...vote.votes },
    requiredVotes: vote.requiredVotes,
    totalUsers: vote.totalUsers,
    expiresAt: vote.expiresAt,
    payload: vote.payload,
  }
}
