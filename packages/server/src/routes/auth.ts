import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { issueIdentityCookie } from '../services/identityService.js'
import { logger } from '../utils/logger.js'
import { userRepo } from '../repositories/userRepository.js'
import { databasePath } from '../repositories/database.js'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import * as z from 'zod/v4'
import { roomRepo } from '../repositories/roomRepository.js'
import type { PersistedUser } from '../repositories/userRepository.js'
import bcrypt from 'bcryptjs'

const router: RouterType = Router()

function publicProfile(user: PersistedUser) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    hasPassword: Boolean(user.passwordHash),
    role: user.role,
  }
}

function syncActiveRoomProfile(profile: PersistedUser): void {
  for (const room of roomRepo.getAll().values()) {
    const user = room.users.find((member) => member.id === profile.id)
    if (!user) continue
    user.nickname = profile.nickname
    user.avatarUrl = profile.avatarUrl
  }
}

/**
 * Ensure identity cookie exists, and renew expiry on every call.
 * Returns 204 and exposes identity metadata via headers.
 */
router.post('/identity/bootstrap', (req: Request, res: Response) => {
  const hasExistingIdentity = typeof req.identityUserId === 'string' && req.identityUserId.length > 0
  const issued = issueIdentityCookie(req, res, req.identityUserId)
  req.identityUserId = issued.userId
  res.setHeader('Access-Control-Expose-Headers', 'X-Identity-UserId, X-Identity-Expires-At')
  res.setHeader('X-Identity-UserId', issued.userId)
  res.setHeader('X-Identity-Expires-At', String(issued.expiresAt))
  logger.debug('已签发客户端身份凭据', {
    userId: issued.userId,
    reusedIdentity: hasExistingIdentity,
    expiresAt: issued.expiresAt,
    ip: req.ip,
  })
  res.status(204).send()
})

router.post('/identity/logout', (req: Request, res: Response) => {
  const issued = issueIdentityCookie(req, res)
  req.identityUserId = issued.userId
  res.json({ userId: issued.userId, expiresAt: issued.expiresAt })
})

const recoverSchema = z.object({
  accountId: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128),
})

router.post('/identity/recover', async (req: Request, res: Response) => {
  const parsed = recoverSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
    return
  }

  const user = userRepo.get(parsed.data.accountId)
  if (!user?.passwordHash || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: '账号 ID 或密码错误' })
    return
  }

  const issued = issueIdentityCookie(req, res, user.id)
  userRepo.touch(user.id)
  req.identityUserId = user.id
  res.json({ userId: user.id, expiresAt: issued.expiresAt })
})

router.get('/me', (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const user = userRepo.get(req.identityUserId)
  if (!user) {
    res.status(204).send()
    return
  }
  res.json(publicProfile(user))
})

const setPasswordSchema = z.object({
  password: z.string().min(8, '密码至少需要 8 个字符').max(128),
})

router.post('/me/password', async (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const parsed = setPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid password' })
    return
  }

  const user = userRepo.get(req.identityUserId)
  if (!user) {
    res.status(409).json({ error: '请先设置昵称后再设置密码' })
    return
  }
  if (user.passwordHash) {
    res.status(409).json({ error: '该账号已经设置过密码' })
    return
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12)
  userRepo.setPasswordHash(user.id, passwordHash)
  res.json({ accountId: user.id })
})

const updateMeSchema = z.object({
  nickname: z.string().trim().min(1).max(40),
})

router.patch('/me', (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const parsed = updateMeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile' })
    return
  }
  const user = userRepo.updateProfile(req.identityUserId, { nickname: parsed.data.nickname })
  syncActiveRoomProfile(user)
  res.json(publicProfile(user))
})

const avatarSchema = z.object({ image: z.string().min(1) })

router.post('/me/avatar', async (req: Request, res: Response) => {
  if (!req.identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!userRepo.get(req.identityUserId)) {
    res.status(409).json({ error: '请先设置昵称后再上传头像' })
    return
  }
  const parsed = avatarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid image' })
    return
  }

  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(parsed.data.image)
  if (!match) {
    res.status(400).json({ error: 'Only PNG, JPEG, and WebP images are supported' })
    return
  }
  const input = Buffer.from(match[2]!, 'base64')
  if (input.length > 5 * 1024 * 1024) {
    res.status(413).json({ error: 'Avatar must be 5MB or smaller' })
    return
  }

  try {
    const output = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'center' })
      .webp({ quality: 82 })
      .toBuffer()
    const avatarsDir = path.join(path.dirname(databasePath), 'avatars')
    await mkdir(avatarsDir, { recursive: true })
    const fileName = `${req.identityUserId}.webp`
    await writeFile(path.join(avatarsDir, fileName), output)
    const avatarUrl = `/uploads/avatars/${fileName}?v=${Date.now()}`
    const user = userRepo.updateProfile(req.identityUserId, { avatarUrl })
    syncActiveRoomProfile(user)
    res.json(publicProfile(user))
  } catch (err) {
    logger.warn('Avatar processing failed', { err, userId: req.identityUserId })
    res.status(400).json({ error: 'Invalid image data' })
  }
})

export default router
