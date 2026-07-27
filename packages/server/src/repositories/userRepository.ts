import { db } from './database.js'
import { config } from '../config.js'

export type ServerUserRole = 'user' | 'admin'

export interface PersistedUser {
  id: string
  nickname: string
  avatarUrl: string | null
  passwordHash: string | null
  role: ServerUserRole
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

interface UserRow {
  id: string
  nickname: string
  avatar_url: string | null
  password_hash: string | null
  role: ServerUserRole
  created_at: number
  updated_at: number
  last_seen_at: number
}

interface PlatformAuthRenameRow {
  platform: string
  cookie_encrypted: string
  nickname_snapshot: string | null
  vip_type: number
  created_at: number
  updated_at: number
}

export type RenameUserResult =
  | { success: true; user: PersistedUser }
  | { success: false; reason: 'not_found' | 'conflict' }

function toUser(row: UserRow): PersistedUser {
  return {
    id: row.id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  }
}

const selectUser = db.prepare<string, UserRow>('SELECT * FROM users WHERE id = ?')
const selectUserCaseInsensitive = db.prepare<string, UserRow>('SELECT * FROM users WHERE id = ? COLLATE NOCASE LIMIT 1')
const insertUser = db.prepare(`
  INSERT INTO users (id, nickname, avatar_url, password_hash, role, created_at, updated_at, last_seen_at)
  VALUES (@id, @nickname, NULL, NULL, @role, @now, @now, @now)
`)
const touchUser = db.prepare('UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?')
const updateProfile = db.prepare(
  'UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?',
)
const setPasswordHash = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
const setRole = db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
const listUsers = db.prepare<[], UserRow>('SELECT * FROM users ORDER BY created_at DESC')
const deleteUser = db.prepare('DELETE FROM users WHERE id = ?')
const insertRenamedUser = db.prepare(`
  INSERT INTO users (id, nickname, avatar_url, password_hash, role, created_at, updated_at, last_seen_at)
  VALUES (@id, @nickname, @avatarUrl, @passwordHash, @role, @createdAt, @now, @now)
`)
const selectPlatformAuthForRename = db.prepare<[string], PlatformAuthRenameRow>(`
  SELECT platform, cookie_encrypted, nickname_snapshot, vip_type, created_at, updated_at
  FROM platform_auth
  WHERE user_id = ?
  ORDER BY updated_at DESC
`)
const deletePlatformAuthForRename = db.prepare('DELETE FROM platform_auth WHERE user_id = ?')
const insertRenamedPlatformAuth = db.prepare(`
  INSERT INTO platform_auth (
    id, user_id, platform, cookie_encrypted, nickname_snapshot, vip_type, created_at, updated_at
  )
  VALUES (@id, @userId, @platform, @cookie, @nickname, @vipType, @createdAt, @updatedAt)
`)

const renameUser = db.transaction((oldUserId: string, newUserId: string): RenameUserResult => {
  const current = selectUser.get(oldUserId)
  if (!current) return { success: false, reason: 'not_found' }
  if (oldUserId === newUserId) return { success: true, user: toUser(current) }

  const conflict = selectUserCaseInsensitive.get(newUserId)
  if (conflict && conflict.id !== oldUserId) return { success: false, reason: 'conflict' }

  const authRows = selectPlatformAuthForRename.all(oldUserId)
  const now = Date.now()
  insertRenamedUser.run({
    id: newUserId,
    nickname: current.nickname,
    avatarUrl: current.avatar_url,
    passwordHash: current.password_hash,
    role: current.role,
    createdAt: current.created_at,
    now,
  })

  deletePlatformAuthForRename.run(oldUserId)
  const seenPlatforms = new Set<string>()
  for (const row of authRows) {
    if (seenPlatforms.has(row.platform)) continue
    seenPlatforms.add(row.platform)
    insertRenamedPlatformAuth.run({
      id: `account:${newUserId}:${row.platform}`,
      userId: newUserId,
      platform: row.platform,
      cookie: row.cookie_encrypted,
      nickname: row.nickname_snapshot,
      vipType: row.vip_type,
      createdAt: row.created_at,
      updatedAt: Math.max(row.updated_at, now),
    })
  }

  deleteUser.run(oldUserId)
  return { success: true, user: toUser(selectUser.get(newUserId)!) }
})

export const userRepo = {
  get(userId: string): PersistedUser | null {
    const row = selectUser.get(userId)
    return row ? toUser(row) : null
  },

  touch(userId: string): PersistedUser | null {
    const existing = this.get(userId)
    if (!existing) return null

    const now = Date.now()
    touchUser.run(now, now, userId)
    if (config.serverAdminIds.has(userId) && existing.role !== 'admin') {
      setRole.run('admin', now, userId)
    }
    return this.get(userId)
  },

  ensure(userId: string, defaults?: { nickname?: string }): PersistedUser {
    const existing = this.touch(userId)
    const now = Date.now()
    if (existing) return existing

    insertUser.run({
      id: userId,
      nickname: defaults?.nickname?.trim() ?? '',
      role: config.serverAdminIds.has(userId) ? 'admin' : 'user',
      now,
    })
    return this.get(userId)!
  },

  updateProfile(userId: string, data: { nickname?: string; avatarUrl?: string }): PersistedUser {
    this.ensure(userId)
    updateProfile.run(data.nickname?.trim() || null, data.avatarUrl ?? null, Date.now(), userId)
    return this.get(userId)!
  },

  setPasswordHash(userId: string, passwordHash: string): PersistedUser {
    this.ensure(userId)
    setPasswordHash.run(passwordHash, Date.now(), userId)
    return this.get(userId)!
  },

  list(): PersistedUser[] {
    return listUsers.all().map(toUser)
  },

  delete(userId: string): boolean {
    return deleteUser.run(userId).changes > 0
  },

  rename(oldUserId: string, newUserId: string): RenameUserResult {
    return renameUser(oldUserId, newUserId)
  },

  isServerAdmin(userId: string): boolean {
    return config.serverAdminIds.has(userId) || this.get(userId)?.role === 'admin'
  },
}
