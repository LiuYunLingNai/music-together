import type { MusicSource } from '@music-together/shared'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { db } from './database.js'

export interface PersistedPlatformAuth {
  userId: string
  platform: MusicSource
  cookie: string
  nickname: string
  vipType: number
}

interface PlatformAuthRow {
  user_id: string
  platform: MusicSource
  cookie_encrypted: string
  nickname_snapshot: string | null
  vip_type: number | null
}

const upsertAuth = db.prepare(`
  INSERT INTO platform_auth (
    id,
    user_id,
    platform,
    cookie_encrypted,
    nickname_snapshot,
    vip_type,
    created_at,
    updated_at
  )
  VALUES (@id, @userId, @platform, @cookie, @nickname, @vipType, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    cookie_encrypted = excluded.cookie_encrypted,
    nickname_snapshot = excluded.nickname_snapshot,
    vip_type = excluded.vip_type,
    updated_at = excluded.updated_at
`)
const loadUserAuth = db.prepare<[string], PlatformAuthRow>(
  'SELECT user_id, platform, cookie_encrypted, nickname_snapshot, vip_type FROM platform_auth WHERE user_id = ? ORDER BY updated_at DESC',
)
const deleteUserPlatformAuth = db.prepare('DELETE FROM platform_auth WHERE user_id = ? AND platform = ?')

function authId(userId: string, platform: MusicSource): string {
  return `account:${userId}:${platform}`
}

const encryptionKey = createHash('sha256').update(config.identity.secret).digest()

function encryptCookie(cookie: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

function decryptCookie(value: string): string | null {
  // Existing fork databases stored plaintext in this column. Keep those rows readable.
  if (!value.startsWith('v1:')) return value
  const [, iv, tag, encrypted] = value.split(':')
  if (!iv || !tag || !encrypted) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
  } catch (error) {
    logger.warn('Failed to decrypt persisted platform cookie', { error })
    return null
  }
}

export const platformAuthRepo = {
  save(entry: PersistedPlatformAuth): void {
    upsertAuth.run({
      id: authId(entry.userId, entry.platform),
      userId: entry.userId,
      platform: entry.platform,
      cookie: encryptCookie(entry.cookie),
      nickname: entry.nickname,
      vipType: entry.vipType,
      now: Date.now(),
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
        const cookie = decryptCookie(row.cookie_encrypted)
        return cookie
          ? [
              {
                userId: row.user_id,
                platform: row.platform,
                cookie,
                nickname: row.nickname_snapshot ?? row.user_id,
                vipType: row.vip_type ?? 0,
              },
            ]
          : []
      })
  },

  remove(userId: string, platform: MusicSource): boolean {
    return deleteUserPlatformAuth.run(userId, platform).changes > 0
  },
}
