import { Router, type Router as RouterType } from 'express'
import { kugouListeningSchema } from '@music-together/shared'
import type { Track } from '@music-together/shared'
import { createKugouListeningService } from '../services/kugouListeningService.js'
import { listeningReportRateLimit } from '../middleware/httpRateLimiter.js'

interface Dependencies {
  getRoom: (id: string) => { users: { id: string }[]; currentTrack: Track | null } | undefined
  getCookie: (userId: string, roomId: string) => string | null
  service: ReturnType<typeof createKugouListeningService>
}

export function createKugouListeningRouter({ getRoom, getCookie, service }: Dependencies): RouterType {
  const router = Router()
  router.post('/kugou-listening', listeningReportRateLimit, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    if (!req.identityUserId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    const parsed = kugouListeningSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid listening report' })
      return
    }
    const room = getRoom(parsed.data.roomId)
    if (!room?.users.some((user) => user.id === req.identityUserId)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    // Never borrow the room's best/VIP cookie or the Concept Edition authorization.
    const cookie = getCookie(req.identityUserId, parsed.data.roomId)
    if (!cookie) {
      res.json({ status: 'not_logged_in' })
      return
    }
    try {
      const result = await service.report(parsed.data, {
        userId: req.identityUserId,
        cookie,
        currentTrackId: room.currentTrack?.source === 'kugou' ? room.currentTrack.id : null,
      })
      res.json(result)
    } catch {
      res.status(503).json({ status: 'unavailable' })
    }
  })
  return router
}
