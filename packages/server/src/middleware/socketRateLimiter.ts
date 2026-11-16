import { RateLimiterMemory } from 'rate-limiter-flexible'
import { EVENTS, ERROR_CODE, LIMITS } from '@music-together/shared'
import type { TypedSocket } from './types.js'

const RATE_LIMIT_POINTS = 10
const RATE_LIMIT_DURATION_S = 5

/**
 * Per-socket rate limiter for critical socket events.
 * Shared across all controllers to prevent event spam.
 *
 * Separate limiter from chat (which has its own) — this covers
 * VOTE_START, QUEUE_ADD, PLAYER_PLAY, PLAYER_SEEK, etc.
 */
const socketEventLimiter = new RateLimiterMemory({
  points: RATE_LIMIT_POINTS,
  duration: RATE_LIMIT_DURATION_S,
})

const authEventLimiter = new RateLimiterMemory({
  points: 30,
  duration: 60,
})

const roomEntryLimiter = new RateLimiterMemory({
  points: 10,
  duration: 10,
})

const joinPasswordFailureLimiter = new RateLimiterMemory({
  points: LIMITS.ROOM_JOIN_PASSWORD_MAX_FAILURES,
  duration: 60,
})

/**
 * Consume a rate limit point for the given socket's user.
 * Keyed by userId (not socket.id) to prevent bypass via multiple connections.
 * Returns true if allowed, false if rate-limited (error already emitted).
 */
async function consumeLimiter(socket: TypedSocket, limiter: RateLimiterMemory, keySuffix = ''): Promise<boolean> {
  const key = `${socket.data.identityUserId ?? socket.id}${keySuffix}`
  try {
    await limiter.consume(key)
    return true
  } catch {
    socket.emit(EVENTS.ROOM_ERROR, {
      code: ERROR_CODE.RATE_LIMITED,
      message: '操作过于频繁，请稍后再试',
    })
    return false
  }
}

export function checkSocketRateLimit(socket: TypedSocket): Promise<boolean> {
  return consumeLimiter(socket, socketEventLimiter)
}

/** QR polling has its own budget and does not consume player-control points. */
export function checkAuthRateLimit(socket: TypedSocket): Promise<boolean> {
  return consumeLimiter(socket, authEventLimiter, ':auth')
}

/** ROOM_CREATE / ROOM_JOIN 共用的额度；携带重连凭证的入房不经过它，弱网反复重连不会被误限。 */
export function checkRoomEntryRateLimit(socket: TypedSocket): Promise<boolean> {
  return consumeLimiter(socket, roomEntryLimiter, ':room-entry')
}

/**
 * Clean up rate limiter entries for a disconnected socket.
 * Call this in the disconnect handler to prevent memory growth.
 */
export function cleanupSocketRateLimit(socket: TypedSocket): void {
  // Identity-scoped entries must survive one tab disconnecting while another
  // tab for the same user is still active. RateLimiterMemory expires them
  // automatically, so only socket-scoped anonymous entries are removed here.
  if (socket.data.identityUserId) return
  const key = socket.id
  void Promise.all([socketEventLimiter.delete(key), authEventLimiter.delete(`${key}:auth`), roomEntryLimiter.delete(`${key}:room-entry`)]).catch(() => undefined)
}

function joinFailureKey(socket: TypedSocket, roomId: string): string {
  return `${socket.data.identityUserId ?? socket.id}:join-password:${roomId}`
}

/** 同一身份一分钟内对同一房间输错密码达上限后锁定；锁定期间不再校验任何密码。 */
export async function isJoinPasswordLocked(socket: TypedSocket, roomId: string): Promise<boolean> {
  const state = await joinPasswordFailureLimiter.get(joinFailureKey(socket, roomId))
  return state !== null && state.consumedPoints >= LIMITS.ROOM_JOIN_PASSWORD_MAX_FAILURES
}

export async function recordJoinPasswordFailure(socket: TypedSocket, roomId: string): Promise<void> {
  try {
    await joinPasswordFailureLimiter.consume(joinFailureKey(socket, roomId))
  } catch {
    // 已达上限，锁定已生效
  }
}

export async function clearJoinPasswordFailures(socket: TypedSocket, roomId: string): Promise<void> {
  await joinPasswordFailureLimiter.delete(joinFailureKey(socket, roomId))
}
