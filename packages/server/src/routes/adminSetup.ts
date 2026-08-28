import { Router } from 'express'
import bcrypt from 'bcryptjs'
import * as z from 'zod/v4'
import { issueIdentityCookie } from '../services/identityService.js'
import { createInitialAdmin, isSetupNeeded } from '../services/adminSetupService.js'
import { logger } from '../utils/logger.js'

const setupSchema = z.object({
  accountId: z
    .string()
    .trim()
    .min(3, '账号 ID 至少需要 3 个字符')
    .max(32, '账号 ID 不能超过 32 个字符')
    .regex(/^[a-z0-9_-]+$/, '账号 ID 只能包含小写字母、数字、下划线和连字符'),
  nickname: z.string().trim().min(1, '昵称不能为空').max(40),
  password: z.string().min(8, '密码至少需要 8 个字符').max(128),
  avatarUrl: z.string().max(2 * 1024 * 1024).optional(),
})

/**
 * 首次初始化端点：无需任何身份即可访问，仅在服务器尚无管理员时可用。
 * 必须挂载在受保护的 /api/admin 路由之前。
 */
export function createAdminSetupRoutes(): Router {
  const router = Router()

  router.get('/setup-status', (_req, res) => {
    res.json({ needed: isSetupNeeded() })
  })

  router.post('/setup', async (req, res) => {
    const parsed = setupSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' })
      return
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const result = createInitialAdmin({
      accountId: parsed.data.accountId,
      nickname: parsed.data.nickname,
      passwordHash,
      avatarUrl: parsed.data.avatarUrl,
    })

    if (!result.success) {
      const errors = {
        already_initialized: { status: 409, error: '服务器已完成初始化' },
        reserved_id: { status: 400, error: '该账号 ID 为系统保留名称' },
        account_conflict: { status: 409, error: '该账号 ID 已被使用' },
      } as const
      const failure = errors[result.reason]
      logger.warn('首个管理员初始化被拒绝', {
        event: 'admin.setup_rejected',
        reason: result.reason,
        requestIp: req.ip,
      })
      res.status(failure.status).json({ error: failure.error })
      return
    }

    const issued = issueIdentityCookie(req, res, result.user.id)
    logger.info(`已完成服务器初始化，首个管理员账号为 ${result.user.id}`, {
      event: 'admin.setup_completed',
      accountId: result.user.id,
      nickname: result.user.nickname,
      requestIp: req.ip,
    })
    res.json({
      id: result.user.id,
      nickname: result.user.nickname,
      avatarUrl: result.user.avatarUrl,
      hasPassword: true,
      role: result.user.role,
      expiresAt: issued.expiresAt,
    })
  })

  return router
}
