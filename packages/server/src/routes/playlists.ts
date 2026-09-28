import { Router, type Request, type Response, type NextFunction } from 'express'
import {
  userPlaylistCreateSchema,
  userPlaylistRenameSchema,
  userPlaylistAddTracksSchema,
} from '@music-together/shared'
import { userRepo } from '../repositories/userRepository.js'
import { userPlaylistRepo } from '../repositories/playlistRepository.js'

/**
 * 本地账户歌单仅面向已登录账号（设置了密码的用户）。访客与未识别身份一律拒绝，
 * 与设置页「请先在账号里设置密码」的引导保持一致。
 */
function requireAccount(req: Request, res: Response, next: NextFunction): void {
  const userId = req.identityUserId
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const user = userRepo.get(userId)
  if (!user || !user.passwordHash) {
    res.status(403).json({ error: '本地歌单仅对已设置密码的账号开放' })
    return
  }
  next()
}

export function createPlaylistRoutes(): Router {
  const router = Router()

  router.use(requireAccount)

  router.get('/', (req, res) => {
    res.json({ playlists: userPlaylistRepo.list(req.identityUserId!) })
  })

  router.post('/', (req, res) => {
    const parsed = userPlaylistCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid playlist name' })
      return
    }
    const result = userPlaylistRepo.create(req.identityUserId!, parsed.data.name)
    if (!result.success) {
      res.status(409).json({ error: '歌单数量已达上限' })
      return
    }
    res.status(201).json({ playlist: result.playlist })
  })

  router.get('/:id', (req, res) => {
    const detail = userPlaylistRepo.get(req.identityUserId!, req.params.id)
    if (!detail) {
      res.status(404).json({ error: '歌单不存在' })
      return
    }
    res.json({ playlist: detail })
  })

  router.patch('/:id', (req, res) => {
    const parsed = userPlaylistRenameSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid playlist name' })
      return
    }
    const playlist = userPlaylistRepo.rename(req.identityUserId!, req.params.id, parsed.data.name)
    if (!playlist) {
      res.status(404).json({ error: '歌单不存在' })
      return
    }
    res.json({ playlist })
  })

  router.delete('/:id', (req, res) => {
    const removed = userPlaylistRepo.remove(req.identityUserId!, req.params.id)
    if (!removed) {
      res.status(404).json({ error: '歌单不存在' })
      return
    }
    res.json({ success: true })
  })

  router.post('/:id/tracks', (req, res) => {
    const parsed = userPlaylistAddTracksSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid tracks' })
      return
    }
    const result = userPlaylistRepo.addTracks(req.identityUserId!, req.params.id, parsed.data.tracks)
    if (!result.success) {
      res.status(result.reason === 'not_found' ? 404 : 409).json({
        error: result.reason === 'not_found' ? '歌单不存在' : '歌单曲目数量已达上限',
      })
      return
    }
    res.json({ added: result.added, trackCount: result.trackCount })
  })

  router.delete('/:id/tracks/:trackId', (req, res) => {
    const removed = userPlaylistRepo.removeTrack(req.identityUserId!, req.params.id, req.params.trackId)
    if (!removed) {
      res.status(404).json({ error: '歌单或曲目不存在' })
      return
    }
    res.json({ success: true })
  })

  return router
}
