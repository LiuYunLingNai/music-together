import { Router } from 'express'
import bcrypt from 'bcryptjs'
import * as z from 'zod/v4'
import type { TypedServer } from '../middleware/types.js'
import { config } from '../config.js'
import { userRepo } from '../repositories/userRepository.js'
import { issueIdentityCookie } from '../services/identityService.js'
import { replaceActiveUserId } from '../services/accountService.js'

const RESERVED_ACCOUNT_IDS = new Set([
  'admin',
  'api',
  'root',
  'server',
  'support',
  'system',
  ...Array.from(config.serverAdminIds, (id) => id.toLowerCase()),
])

const renameAccountSchema = z.object({
  accountId: z
    .string()
    .trim()
    .min(3, '账号 ID 至少需要 3 个字符')
    .max(32, '账号 ID 不能超过 32 个字符')
    .regex(/^[a-z0-9_-]+$/, '账号 ID 只能包含小写字母、数字、下划线和连字符'),
  currentPassword: z.string().max(128).optional(),
})

export function createAccountRoutes(io: TypedServer): Router {
  const router = Router()

  router.patch('/me/account-id', async (req, res) => {
    if (!req.identityUserId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    const parsed = renameAccountSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid account ID' })
      return
    }
    if (RESERVED_ACCOUNT_IDS.has(parsed.data.accountId)) {
      res.status(400).json({ error: '该账号 ID 为系统保留名称' })
      return
    }

    const oldUserId = req.identityUserId
    const current = userRepo.get(oldUserId)
    if (!current) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (current.passwordHash) {
      const password = parsed.data.currentPassword ?? ''
      if (!password || !(await bcrypt.compare(password, current.passwordHash))) {
        res.status(401).json({ error: '当前密码错误' })
        return
      }
    }

    const result = userRepo.rename(oldUserId, parsed.data.accountId)
    if (!result.success) {
      res.status(result.reason === 'conflict' ? 409 : 404).json({
        error: result.reason === 'conflict' ? '该账号 ID 已被使用' : 'User not found',
      })
      return
    }

    replaceActiveUserId(oldUserId, result.user.id, io)
    const issued = issueIdentityCookie(req, res, result.user.id)
    req.identityUserId = result.user.id
    res.json({
      id: result.user.id,
      nickname: result.user.nickname,
      avatarUrl: result.user.avatarUrl,
      hasPassword: Boolean(result.user.passwordHash),
      role: result.user.role,
      expiresAt: issued.expiresAt,
    })
  })

  return router
}
