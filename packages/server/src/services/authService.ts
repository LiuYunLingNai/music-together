import type { MusicSource, PlatformAuthStatus, MyPlatformAuth } from '@music-together/shared'
import { platformAuthRepo } from '../repositories/platformAuthRepository.js'
import { logger } from '../utils/logger.js'

/**
 * Room-scoped cookie pool for music platform authentication.
 * Cookies are stored per-room so a user's VIP only benefits the room they're in.
 * Cookies are NOT removed when a user disconnects — they stay until the room is destroyed.
 * This ensures queued VIP songs can still play after the contributor leaves.
 */

interface CookieEntry {
  cookie: string
  userId: string
  nickname: string
  /** 0 = no VIP, 1 = VIP, 11 = 黑胶 (Netease specific) */
  vipType: number
}

/** roomId -> (platform -> list of cookie entries) */
const roomCookiePool = new Map<string, Map<MusicSource, CookieEntry[]>>()

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getRoomPool(roomId: string): Map<MusicSource, CookieEntry[]> {
  let pool = roomCookiePool.get(roomId)
  if (!pool) {
    pool = new Map()
    roomCookiePool.set(roomId, pool)
  }
  return pool
}

function getPlatformEntries(roomId: string, platform: MusicSource): CookieEntry[] {
  const pool = getRoomPool(roomId)
  let entries = pool.get(platform)
  if (!entries) {
    entries = []
    pool.set(platform, entries)
  }
  return entries
}

// ---------------------------------------------------------------------------
// Pool management
// ---------------------------------------------------------------------------

export function addCookie(
  roomId: string,
  platform: MusicSource,
  userId: string,
  cookie: string,
  nickname: string,
  vipType: number,
  persist = true,
): void {
  const entries = getPlatformEntries(roomId, platform)
  // Dedup by cookie value (same account) or by userId (same socket)
  const idx = entries.findIndex((e) => e.cookie === cookie || e.userId === userId)
  if (idx !== -1) entries.splice(idx, 1)
  entries.push({ cookie, userId, nickname, vipType })
  if (persist) {
    platformAuthRepo.save({ userId, platform, cookie, nickname, vipType })
  }
  logger.info(`用户“${nickname}”已在房间 ${roomId} 登录 ${platform}`, {
    event: 'auth.account_added',
    roomId,
    userId,
    nickname,
    platform,
    vipType,
  })
}

export function removeCookie(roomId: string, platform: MusicSource, userId: string): boolean {
  const removedPersisted = platformAuthRepo.remove(userId, platform)
  const pool = roomCookiePool.get(roomId)
  if (!pool) return removedPersisted
  const entries = pool.get(platform)
  if (!entries) return removedPersisted
  const idx = entries.findIndex((e) => e.userId === userId)
  if (idx === -1) return removedPersisted
  const removed = entries.splice(idx, 1)[0]
  logger.info(`用户“${removed.nickname}”已在房间 ${roomId} 退出 ${platform}`, {
    event: 'auth.account_removed',
    roomId,
    userId,
    nickname: removed.nickname,
    platform,
  })
  return true
}

/** Restore a user's server-persisted platform accounts into a room pool. */
export function restoreUserCookies(roomId: string, userId: string): number {
  const entries = platformAuthRepo.loadUser(userId)
  for (const entry of entries) {
    addCookie(roomId, entry.platform, userId, entry.cookie, entry.nickname, entry.vipType, false)
  }
  return entries.length
}

export function persistUserCookieFromRoom(roomId: string, platform: MusicSource, userId: string): boolean {
  const entry = roomCookiePool
    .get(roomId)
    ?.get(platform)
    ?.find((item) => item.userId === userId)
  if (!entry) return false
  platformAuthRepo.save({
    userId,
    platform,
    cookie: entry.cookie,
    nickname: entry.nickname,
    vipType: entry.vipType,
  })
  return true
}

export function replaceUserId(oldUserId: string, newUserId: string): void {
  for (const pool of roomCookiePool.values()) {
    for (const entries of pool.values()) {
      for (const entry of entries) {
        if (entry.userId === oldUserId) entry.userId = newUserId
      }
    }
  }
}

/**
 * Clean up all cookies for a room. Called when the room is destroyed.
 */
export function cleanupRoom(roomId: string): void {
  if (roomCookiePool.delete(roomId)) {
    logger.debug('已清理销毁房间的账号凭据池', { roomId })
  }
}

/**
 * Check if a specific cookie value already exists for the given room + platform.
 * Used to skip redundant validation on auto-resend.
 */
export function hasCookie(roomId: string, platform: MusicSource, cookie: string): boolean {
  const pool = roomCookiePool.get(roomId)
  if (!pool) return false
  const entries = pool.get(platform)
  if (!entries) return false
  return entries.some((e) => e.cookie === cookie)
}

// ---------------------------------------------------------------------------
// Cookie retrieval
// ---------------------------------------------------------------------------

/**
 * Get any available cookie for a platform in a specific room.
 * Prefers VIP cookies over non-VIP.
 */
export function getAnyCookie(platform: MusicSource, roomId: string): string | null {
  const pool = roomCookiePool.get(roomId)
  if (!pool) return null
  const entries = pool.get(platform)
  if (!entries || entries.length === 0) return null

  // 单次遍历取最高 vipType 的 cookie（O(n) 替代排序 O(n log n)）
  let best = entries[0]
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].vipType > best.vipType) best = entries[i]
  }
  return best.cookie
}

/**
 * Get a specific user's cookie for a platform in a specific room.
 * Used for user-private operations like fetching personal playlists.
 */
export function getUserCookie(userId: string, platform: MusicSource, roomId: string): string | null {
  const pool = roomCookiePool.get(roomId)
  if (!pool) return null
  const entries = pool.get(platform)
  if (!entries) return null
  const entry = entries.find((e) => e.userId === userId)
  return entry?.cookie ?? null
}

// ---------------------------------------------------------------------------
// Status for frontend
// ---------------------------------------------------------------------------

/**
 * Get aggregated auth status for all platforms in a specific room.
 */
export function getAllPlatformStatus(roomId: string): PlatformAuthStatus[] {
  const platforms: MusicSource[] = ['netease', 'tencent', 'kugou', 'bilibili']
  const pool = roomCookiePool.get(roomId)
  return platforms.map((platform) => {
    const entries = pool?.get(platform) ?? []
    const maxVipType = entries.reduce((max, e) => Math.max(max, e.vipType), 0)
    return {
      platform,
      loggedInCount: entries.length,
      hasVip: maxVipType > 0,
      maxVipType,
    }
  })
}

/**
 * Get a specific user's auth status across all platforms in a specific room.
 */
export function getUserAuthStatus(userId: string, roomId: string): MyPlatformAuth[] {
  const platforms: MusicSource[] = ['netease', 'tencent', 'kugou', 'bilibili']
  const pool = roomCookiePool.get(roomId)
  return platforms.map((platform) => {
    const entries = pool?.get(platform) ?? []
    const entry = entries.find((e) => e.userId === userId)
    return {
      platform,
      loggedIn: !!entry,
      nickname: entry?.nickname,
      vipType: entry?.vipType,
    }
  })
}
