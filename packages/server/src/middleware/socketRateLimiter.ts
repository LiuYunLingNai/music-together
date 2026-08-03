import { RateLimiterMemory } from 'rate-limiter-flexible'
import { EVENTS, ERROR_CODE } from '@music-together/shared'
import type { TypedSocket } from './types.js'
import { roomRepo } from '../repositories/roomRepository.js'

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

/** Separate auth budget so normal 2-second QR polling is not mixed with player controls. */
export function checkAuthRateLimit(socket: TypedSocket): Promise<boolean> {
  return consumeLimiter(socket, authEventLimiter, ':auth')
}

/**
 * Clean up rate limiter entries for a disconnected socket.
 * Call this in the disconnect handler to prevent memory growth.
 */
export function cleanupSocketRateLimit(socket: TypedSocket): void {
  const userId = socket.data.identityUserId
  if (userId) {
    for (const roomId of roomRepo.getAllIds()) {
      if (roomRepo.getSocketIdForUser(roomId, userId)) return
    }
  }
  const key = userId ?? socket.id
  void Promise.all([socketEventLimiter.delete(key), authEventLimiter.delete(`${key}:auth`)]).catch(() => {
    // Ignore — keys may not exist if the socket never triggered a limited event
  })
}
