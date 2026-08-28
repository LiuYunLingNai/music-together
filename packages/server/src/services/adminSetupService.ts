import { config } from '../config.js'
import { userRepo, type PersistedUser } from '../repositories/userRepository.js'
import { RESERVED_ACCOUNT_IDS } from '../routes/account.js'

export type SetupResult =
  | { success: true; user: PersistedUser }
  | { success: false; reason: 'already_initialized' | 'reserved_id' | 'account_conflict' }

/** 服务器尚未产生任何管理员（数据库无 admin 角色且未配置 SERVER_ADMIN_IDS）时需要首次初始化 */
export function isSetupNeeded(): boolean {
  return !userRepo.hasAdmin() && config.serverAdminIds.size === 0
}

/**
 * 创建首个服务器管理员。仅在未完成初始化时可用；
 * 事务内的二次检查保证并发请求下只会有一个管理员被创建。
 */
export function createInitialAdmin(input: { accountId: string; nickname: string; passwordHash: string; avatarUrl?: string | null }): SetupResult {
  if (!isSetupNeeded()) return { success: false, reason: 'already_initialized' }
  if (RESERVED_ACCOUNT_IDS.has(input.accountId.toLowerCase())) return { success: false, reason: 'reserved_id' }

  const created = userRepo.createAdmin({ id: input.accountId, nickname: input.nickname, passwordHash: input.passwordHash, avatarUrl: input.avatarUrl ?? null })
  if (!created.success) {
    return { success: false, reason: created.reason === 'admin_exists' ? 'already_initialized' : 'account_conflict' }
  }
  return { success: true, user: created.user }
}
