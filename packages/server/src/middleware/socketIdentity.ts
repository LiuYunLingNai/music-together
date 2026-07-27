import type { TypedServer, TypedSocket } from './types.js'
import { getIdentityFromCookieHeader } from '../services/identityService.js'
import { logger } from '../utils/logger.js'
import { userRepo } from '../repositories/userRepository.js'

/**
 * Socket identity guard: every websocket connection must carry a valid
 * mt_identity cookie signed by the server.
 */
export function attachSocketIdentity(io: TypedServer): void {
  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie
    const identity = getIdentityFromCookieHeader(typeof cookieHeader === 'string' ? cookieHeader : undefined)
    if (!identity) {
      logger.warn('Socket identity verification failed', {
        socketId: socket.id,
        hasCookieHeader: Boolean(cookieHeader),
        origin: socket.handshake.headers.origin ?? null,
      })
      next(new Error('UNAUTHENTICATED'))
      return
    }
    userRepo.touch(identity.userId)
    socket.data.identityUserId = identity.userId
    logger.debug('实时连接身份验证通过', {
      socketId: socket.id,
      userId: identity.userId,
    })
    next()
  })
}
