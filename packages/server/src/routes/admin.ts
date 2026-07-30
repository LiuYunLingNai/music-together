import { Router, type NextFunction, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import * as z from 'zod/v4'
import type { TypedServer } from '../middleware/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { userRepo } from '../repositories/userRepository.js'
import { audioProxyPolicyRepo } from '../repositories/audioProxyPolicyRepository.js'
import { destroyRoom } from '../services/roomLifecycleService.js'
import { logger } from '../utils/logger.js'
import { EVENTS } from '@music-together/shared'

function auditContext(req: Request): Record<string, unknown> {
  return {
    operatorId: req.identityUserId ?? null,
    requestIp: req.ip,
    method: req.method,
    path: req.originalUrl,
  }
}

function requireServerAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.identityUserId || !userRepo.isServerAdmin(req.identityUserId)) {
    logger.warn('非服务器管理员尝试访问管理接口', {
      event: 'admin.access_denied',
      ...auditContext(req),
    })
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  next()
}

const resetPasswordSchema = z.object({
  password: z.string().min(8, '密码至少需要 8 个字符').max(128),
})

const audioProxyPolicyPatchSchema = z
  .object({
    bilibiliForceProxy: z.boolean().optional(),
    kugouForceProxy: z.boolean().optional(),
  })
  .refine((value) => value.bilibiliForceProxy !== undefined || value.kugouForceProxy !== undefined, {
    message: '至少需要提供一个代理策略字段',
  })

export function createAdminRoutes(io: TypedServer): Router {
  const router = Router()
  router.use(requireServerAdmin)

  router.get('/audio-proxy-policy', (req, res) => {
    const policy = audioProxyPolicyRepo.get()
    logger.info('服务器管理员查看了音频代理策略', {
      event: 'admin.audio_proxy_policy_viewed',
      ...auditContext(req),
    })
    res.json(policy)
  })

  router.patch('/audio-proxy-policy', (req, res) => {
    const parsed = audioProxyPolicyPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid audio proxy policy' })
      return
    }
    const policy = audioProxyPolicyRepo.update(parsed.data)
    io.to('lobby').emit(EVENTS.SERVER_AUDIO_PROXY_POLICY, policy)
    logger.info('服务器管理员更新了音频代理策略', {
      event: 'admin.audio_proxy_policy_updated',
      ...auditContext(req),
      ...policy,
    })
    res.json(policy)
  })

  router.get('/users', (req, res) => {
    const users = userRepo.list()
    logger.info('服务器管理员查看了账号列表', {
      event: 'admin.users_viewed',
      ...auditContext(req),
      resultCount: users.length,
    })
    res.json({
      users: users.map((user) => ({
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        role: user.role,
        hasPassword: Boolean(user.passwordHash),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastSeenAt: user.lastSeenAt,
      })),
    })
  })

  router.delete('/users/:userId', (req, res) => {
    if (req.params.userId === req.identityUserId) {
      logger.warn('服务器管理员删除账号操作被拒绝', {
        event: 'admin.user_delete_rejected',
        ...auditContext(req),
        targetUserId: req.params.userId,
        reason: 'self_delete',
      })
      res.status(400).json({ error: '不能删除当前登录的管理员账号' })
      return
    }
    const target = userRepo.get(req.params.userId)
    if (!target) {
      logger.warn('服务器管理员删除账号操作失败', {
        event: 'admin.user_delete_failed',
        ...auditContext(req),
        targetUserId: req.params.userId,
        reason: 'not_found',
      })
      res.status(404).json({ error: 'User not found' })
      return
    }
    userRepo.delete(target.id)
    logger.info(`服务器管理员删除了账号 ${target.id}`, {
      event: 'admin.user_deleted',
      ...auditContext(req),
      targetUserId: target.id,
      targetNickname: target.nickname,
      targetRole: target.role,
      targetHadPassword: Boolean(target.passwordHash),
    })
    res.status(204).send()
  })

  router.post('/users/:userId/reset-password', async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      logger.warn('服务器管理员重置账号密码操作被拒绝', {
        event: 'admin.user_password_reset_rejected',
        ...auditContext(req),
        targetUserId: req.params.userId,
        reason: 'invalid_password',
      })
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid password' })
      return
    }
    const user = userRepo.get(req.params.userId)
    if (!user) {
      logger.warn('服务器管理员重置账号密码操作失败', {
        event: 'admin.user_password_reset_failed',
        ...auditContext(req),
        targetUserId: req.params.userId,
        reason: 'not_found',
      })
      res.status(404).json({ error: 'User not found' })
      return
    }

    userRepo.setPasswordHash(user.id, await bcrypt.hash(parsed.data.password, 12))
    logger.info(`服务器管理员重置了账号 ${user.id} 的密码`, {
      event: 'admin.user_password_reset',
      ...auditContext(req),
      targetUserId: user.id,
      targetNickname: user.nickname,
      targetRole: user.role,
    })
    res.status(204).send()
  })

  router.get('/rooms', (req, res) => {
    // Read the complete repository directly; the lobby projection intentionally filters hidden rooms.
    const rooms = Array.from(roomRepo.getAll().values())
    logger.info('服务器管理员查看了活跃房间列表', {
      event: 'admin.rooms_viewed',
      ...auditContext(req),
      resultCount: rooms.length,
    })
    res.json({
      rooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        creatorId: room.creatorId,
        userCount: room.users.length,
        hasPassword: room.password !== null,
        hidden: room.hidden,
        permanent: room.permanent,
        currentTrackTitle: room.currentTrack?.title ?? null,
      })),
    })
  })

  router.post('/rooms/:roomId/dissolve', (req, res) => {
    const room = roomRepo.get(req.params.roomId)
    if (!room) {
      logger.warn('服务器管理员解散房间操作失败', {
        event: 'admin.room_dissolve_failed',
        ...auditContext(req),
        targetRoomId: req.params.roomId,
        reason: 'not_found',
      })
      res.status(404).json({ error: 'Room not found' })
      return
    }
    const roomAudit = {
      targetRoomId: room.id,
      targetRoomName: room.name,
      creatorId: room.creatorId,
      userCount: room.users.length,
      passwordProtected: room.password !== null,
    }
    destroyRoom(room.id, io)
    logger.info(`服务器管理员解散了房间 ${room.id}`, {
      event: 'admin.room_dissolved',
      ...auditContext(req),
      ...roomAudit,
    })
    res.status(204).send()
  })

  return router
}
