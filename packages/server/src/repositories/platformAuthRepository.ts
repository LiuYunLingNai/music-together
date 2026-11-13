import type { MusicSource } from '@music-together/shared'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { db } from './database.js'

export interface PersistedPlatformAuth {
  userId: string
  platform: MusicSource
  cookie: string
  nickname: string
  vipType: number
  vipLabel?: string
  vipLevel?: number
  avatarUrl?: string
  /** 是否把该账号的权益共享给所在房间；缺省 true。 */
  shareWithRoom?: boolean
  /** 是否允许房间把完整播放的网易云歌曲写入该账号的播放记录；缺省 false。 */
  reportListening?: boolean
  credentialRefreshAttemptedAt?: number
}

interface PlatformAuthRow {
  user_id: string
  platform: MusicSource
  cookie_encrypted: string
  nickname_snapshot: string | null
  vip_type: number | null
  vip_label: string | null
  vip_level: number | null
  avatar_url: string | null
  share_with_room: number | null
  report_listening: number | null
  credential_refresh_attempted_at: number | null
  updated_at: number
}

const upsertAuth = db.prepare(`
  INSERT INTO platform_auth (
    id,
    user_id,
    platform,
    cookie_encrypted,
    nickname_snapshot,
    vip_type,
    vip_label,
    vip_level,
    avatar_url,
    share_with_room,
    report_listening,
    credential_refresh_attempted_at,
    created_at,
    updated_at
  )
  VALUES (@id, @userId, @platform, @cookie, @nickname, @vipType, @vipLabel, @vipLevel, @avatarUrl, COALESCE(@shareWithRoom, 1), COALESCE(@reportListening, 0), @refreshAttemptedAt, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    cookie_encrypted = excluded.cookie_encrypted,
    nickname_snapshot = excluded.nickname_snapshot,
    vip_type = excluded.vip_type,
    vip_label = excluded.vip_label,
    vip_level = excluded.vip_level,
    avatar_url = excluded.avatar_url,
    share_with_room = COALESCE(@shareWithRoom, platform_auth.share_with_room),
    report_listening = COALESCE(@reportListening, platform_auth.report_listening),
    credential_refresh_attempted_at = COALESCE(
      excluded.credential_refresh_attempted_at,
      platform_auth.credential_refresh_attempted_at
    ),
    updated_at = excluded.updated_at
`)
const loadUserAuth = db.prepare<[string], PlatformAuthRow>(
  'SELECT user_id, platform, cookie_encrypted, nickname_snapshot, vip_type, vip_label, vip_level, avatar_url, share_with_room, report_listening, credential_refresh_attempted_at, updated_at FROM platform_auth WHERE user_id = ? ORDER BY updated_at DESC',
)
const loadDuePlatformAuth = db.prepare<[string, number], PlatformAuthRow>(
  `SELECT user_id, platform, cookie_encrypted, nickname_snapshot, vip_type, vip_label, vip_level, avatar_url, share_with_room, report_listening, credential_refresh_attempted_at, updated_at
   FROM platform_auth
   WHERE platform = ? AND (credential_refresh_attempted_at IS NULL OR credential_refresh_attempted_at <= ?)
   ORDER BY updated_at ASC`,
)
const listAllAuth = db.prepare<[], Pick<PlatformAuthRow, 'user_id' | 'platform' | 'cookie_encrypted' | 'updated_at'>>(
  'SELECT user_id, platform, cookie_encrypted, updated_at FROM platform_auth',
)
const deleteUserPlatformAuth = db.prepare('DELETE FROM platform_auth WHERE user_id = ? AND platform = ?')
const markCredentialRefreshAttempt = db.prepare(
  'UPDATE platform_auth SET credential_refresh_attempted_at = ?, updated_at = ? WHERE user_id = ? AND platform = ?',
)

function authId(userId: string, platform: MusicSource): string {
  return `account:${userId}:${platform}`
}

const encryptionKey = createHash('sha256').update(config.identity.secret).digest()
/** 不可逆的密钥指纹：多个实例或多次启动对比它，就能判断是否使用了同一个 IDENTITY_SECRET。 */
const keyFingerprint = createHmac('sha256', encryptionKey).update('platform-auth-key-fingerprint').digest('hex').slice(0, 8)

function encryptCookie(cookie: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

/** 已报告过无法解密的行；同一行只警告一次，重新保存成功后清除，避免高频读取时刷屏。 */
const reportedUndecryptable = new Set<string>()

function decryptCookie(value: string, row?: { user_id: string; platform: string; updated_at?: number }): string | null {
  // Existing fork databases stored plaintext in this column. Keep those rows readable.
  if (!value.startsWith('v1:')) return value
  const [, iv, tag, encrypted] = value.split(':')
  try {
    if (!iv || !tag || !encrypted) throw new Error('malformed ciphertext')
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
  } catch (error) {
    const key = row ? authId(row.user_id, row.platform as MusicSource) : ''
    if (!reportedUndecryptable.has(key)) {
      reportedUndecryptable.add(key)
      logger.warn('Failed to decrypt persisted platform cookie', {
        event: 'platform_auth.decrypt_failed',
        userId: row?.user_id,
        platform: row?.platform,
        updatedAt: row?.updated_at,
        errorMessage: error instanceof Error ? error.message : String(error),
        keyFingerprint,
      })
    }
    return null
  }
}

function toEntry(row: PlatformAuthRow, cookie: string): PersistedPlatformAuth {
  return {
    userId: row.user_id,
    platform: row.platform,
    cookie,
    nickname: row.nickname_snapshot ?? row.user_id,
    vipType: row.vip_type ?? 0,
    vipLabel: row.vip_label ?? undefined,
    vipLevel: row.vip_level ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    shareWithRoom: (row.share_with_room ?? 1) !== 0,
    reportListening: (row.report_listening ?? 0) !== 0,
    credentialRefreshAttemptedAt: row.credential_refresh_attempted_at ?? undefined,
  }
}

export const platformAuthRepo = {
  save(entry: PersistedPlatformAuth, options?: { resetCredentialRefreshSchedule?: boolean }): void {
    const now = Date.now()
    reportedUndecryptable.delete(authId(entry.userId, entry.platform))
    upsertAuth.run({
      id: authId(entry.userId, entry.platform),
      userId: entry.userId,
      platform: entry.platform,
      cookie: encryptCookie(entry.cookie),
      nickname: entry.nickname,
      vipType: entry.vipType,
      vipLabel: entry.vipLabel ?? null,
      vipLevel: entry.vipLevel ?? null,
      avatarUrl: entry.avatarUrl ?? null,
      shareWithRoom: entry.shareWithRoom === undefined ? null : entry.shareWithRoom ? 1 : 0,
      reportListening: entry.reportListening === undefined ? null : entry.reportListening ? 1 : 0,
      refreshAttemptedAt: options?.resetCredentialRefreshSchedule ? now : (entry.credentialRefreshAttemptedAt ?? null),
      now,
    })
  },

  loadUser(userId: string): PersistedPlatformAuth[] {
    const seen = new Set<MusicSource>()
    return loadUserAuth
      .all(userId)
      .filter((row) => {
        if (seen.has(row.platform)) return false
        seen.add(row.platform)
        return true
      })
      .flatMap((row) => {
        const cookie = decryptCookie(row.cookie_encrypted, row)
        return cookie ? [toEntry(row, cookie)] : []
      })
  },

  remove(userId: string, platform: MusicSource): boolean {
    return deleteUserPlatformAuth.run(userId, platform).changes > 0
  },

  loadDue(platform: MusicSource, cutoff: number): PersistedPlatformAuth[] {
    return loadDuePlatformAuth.all(platform, cutoff).flatMap((row) => {
      const cookie = decryptCookie(row.cookie_encrypted, row)
      if (!cookie) {
        // 解不开的凭据无法刷新；记一次尝试时间，避免每个周期都被重新取出。
        const now = Date.now()
        markCredentialRefreshAttempt.run(now, now, row.user_id, row.platform)
        return []
      }
      return [toEntry(row, cookie)]
    })
  },

  /** 启动时统计无法解密的行，并输出密钥指纹，便于判断是否发生了密钥不一致。 */
  auditDecryptability(): { total: number; undecryptable: number } {
    const rows = listAllAuth.all()
    const undecryptable = rows.filter((row) => decryptCookie(row.cookie_encrypted, row) === null).length
    if (undecryptable > 0) {
      logger.warn('Persisted platform cookies cannot be decrypted with the current IDENTITY_SECRET', {
        event: 'platform_auth.undecryptable_summary',
        total: rows.length,
        undecryptable,
        keyFingerprint,
      })
    }
    return { total: rows.length, undecryptable }
  },

  markCredentialRefreshAttempt(userId: string, platform: MusicSource, attemptedAt = Date.now()): void {
    markCredentialRefreshAttempt.run(attemptedAt, attemptedAt, userId, platform)
  },
}
