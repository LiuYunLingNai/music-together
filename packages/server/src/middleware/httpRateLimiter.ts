import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import type { Request } from 'express'

function identityOrIp(req: Request): string {
  return req.identityUserId ? `identity:${req.identityUserId}` : `ip:${ipKeyGenerator(req.ip ?? '', 56)}`
}

export const musicApiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: identityOrIp,
  message: { error: 'Too many music API requests' },
})

export const coverProxyRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: identityOrIp,
  message: { error: 'Too many cover requests' },
})
