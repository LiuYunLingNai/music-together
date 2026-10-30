import { RateLimiterMemory } from 'rate-limiter-flexible'
import type { NextFunction, Request, Response } from 'express'

interface RateLimitOptions {
  points: number
  durationSeconds: number
  message: string
  suffix: string
}

function requestKey(req: Request, suffix: string): string {
  if (suffix === 'password-work') return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}:${suffix}`
  const identity = req.identityUserId?.trim()
  if (identity) return `identity:${identity}:${suffix}`
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}:${suffix}`
}

function createHttpRateLimit({ points, durationSeconds, message, suffix }: RateLimitOptions) {
  const limiter = new RateLimiterMemory({ points, duration: durationSeconds })

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await limiter.consume(requestKey(req, suffix))
      next()
    } catch {
      res.status(429).json({ error: message })
    }
  }
}

/** Metadata endpoints are bursty during search and playlist pagination. */
export const musicMetadataRateLimit = createHttpRateLimit({
  points: 120,
  durationSeconds: 60,
  message: '音乐接口请求过于频繁，请稍后再试',
  suffix: 'music-metadata',
})

/**
 * Audio proxies serve byte ranges, so seeking and visualiser analysis issue
 * several requests per track. Native players often send no identity cookie and
 * fall back to the IP key, which a same-host reverse proxy shares across users.
 */
export const audioProxyRateLimit = createHttpRateLimit({
  points: 300,
  durationSeconds: 60,
  message: '音频代理请求过于频繁，请稍后再试',
  suffix: 'audio-proxy',
})

/** Password hashing admission must not be bypassed by minting another identity. */
export const passwordWorkRateLimit = createHttpRateLimit({
  points: 10,
  durationSeconds: 60,
  message: '密码操作过于频繁，请稍后再试',
  suffix: 'password-work',
})
