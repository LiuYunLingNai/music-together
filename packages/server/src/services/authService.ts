import type { MusicSource, PlatformAuthStatus, MyPlatformAuth } from '@music-together/shared'
import { platformAuthRepo } from '../repositories/platformAuthRepository.js'
import { logger } from '../utils/logger.js'
import { AUTH_PROVIDERS, type GetUserInfoResult } from './authProvider.js'

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
  /** Normalized membership tier: 0 = none, 1 = VIP, 2 = SVIP. */
  vipType: number
  vipLabel?: string
  vipLevel?: number
}

export interface MembershipDetails {
  vipLabel?: string
  vipLevel?: number
}

function normalizeVipType(platform: MusicSource, vipType: number): 0 | 1 | 2 {
  if (vipType <= 0) return 0
  // Older Netease records stored profile.vipType (usually 10/11). That value
  // means vinyl VIP, not SVIP, so only the new normalized value 2 is SVIP.
  if (platform === 'netease') return vipType === 2 ? 2 : 1
  return vipType >= 2 ? 2 : 1
}

function normalizeMembershipDetails(details?: MembershipDetails): MembershipDetails {
  const vipLabel =
    details?.vipLabel
      ?.replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 32) || undefined
  const level = Number(details?.vipLevel)
  const vipLevel = Number.isInteger(level) && level > 0 && level <= 100 ? level : undefined
  return { vipLabel, vipLevel }
}

function isHigherMembership(candidate: CookieEntry, current: CookieEntry | undefined): boolean {
  if (!current) return true
  if (candidate.vipType !== current.vipType) return candidate.vipType > current.vipType
  return (candidate.vipLevel ?? 0) > (current.vipLevel ?? 0)
}

/** roomId -> (platform -> list of cookie entries) */
const roomCookiePool = new Map<string, Map<MusicSource, CookieEntry[]>>()
const membershipRefreshPool = new Map<string, Promise<boolean>>()

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
  membership?: MembershipDetails,
): void {
  vipType = normalizeVipType(platform, vipType)
  const { vipLabel, vipLevel } = normalizeMembershipDetails(membership)
  const entries = getPlatformEntries(roomId, platform)
  // Dedup by cookie value (same account) or by userId (same socket)
  const idx = entries.findIndex((e) => e.cookie === cookie || e.userId === userId)
  if (idx !== -1) entries.splice(idx, 1)
  entries.push({ cookie, userId, nickname, vipType, vipLabel, vipLevel })
  if (persist) {
    platformAuthRepo.save({ userId, platform, cookie, nickname, vipType, vipLabel, vipLevel })
  }
  logger.info(`用户“${nickname}”已在房间 ${roomId} 登录 ${platform}`, {
    event: 'auth.account_added',
    roomId,
    userId,
    nickname,
    platform,
    vipType,
    vipLabel,
    vipLevel,
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
    addCookie(roomId, entry.platform, userId, entry.cookie, entry.nickname, entry.vipType, false, {
      vipLabel: entry.vipLabel,
      vipLevel: entry.vipLevel,
    })
  }
  return entries.length
}

export type MembershipInfoLoader = (platform: MusicSource, cookie: string) => Promise<GetUserInfoResult>

async function refreshMembershipEntry(
  roomId: string,
  platform: MusicSource,
  userId: string,
  cookie: string,
  loadInfo: MembershipInfoLoader,
): Promise<boolean> {
  const refreshKey = `${roomId}:${platform}:${userId}`
  const inFlight = membershipRefreshPool.get(refreshKey)
  if (inFlight) return inFlight

  const refresh = (async () => {
    try {
      let result = await loadInfo(platform, cookie)
      if (!result.ok && result.reason === 'error') {
        result = await loadInfo(platform, cookie)
      }
      if (!result.ok) {
        logger.warn('恢复平台账号时未能刷新会员详情，保留原有账号信息', {
          event: 'auth.membership_refresh_failed',
          roomId,
          userId,
          platform,
          reason: result.reason,
        })
        return false
      }

      const current = roomCookiePool
        .get(roomId)
        ?.get(platform)
        ?.find((entry) => entry.userId === userId)
      // The user may have logged out or replaced the credential while the
      // provider request was in flight. Never restore a stale credential.
      if (!current || current.cookie !== cookie || current.vipLabel) return false

      const userInfo = result.data
      addCookie(roomId, platform, userId, cookie, userInfo.nickname, userInfo.vipType, true, {
        vipLabel: userInfo.vipLabel,
        vipLevel: userInfo.vipLevel,
      })
      logger.info('已自动刷新恢复账号的会员详情', {
        event: 'auth.membership_refreshed',
        roomId,
        userId,
        platform,
        vipType: userInfo.vipType,
        vipLabel: userInfo.vipLabel,
        vipLevel: userInfo.vipLevel,
      })
      return true
    } catch (error) {
      logger.warn('恢复平台账号时刷新会员详情发生异常，保留原有账号信息', {
        event: 'auth.membership_refresh_failed',
        roomId,
        userId,
        platform,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    } finally {
      membershipRefreshPool.delete(refreshKey)
    }
  })()

  membershipRefreshPool.set(refreshKey, refresh)
  return refresh
}

/** Refresh legacy restored accounts whose detailed membership fields are empty. */
export async function refreshMissingMembershipDetails(
  roomId: string,
  userId: string,
  loadInfo: MembershipInfoLoader = (platform, cookie) => AUTH_PROVIDERS[platform].getUserInfo(cookie),
): Promise<MusicSource[]> {
  const candidates = [...(roomCookiePool.get(roomId)?.entries() ?? [])].flatMap(([platform, entries]) =>
    entries
      .filter((entry) => entry.userId === userId && entry.vipType > 0 && !entry.vipLabel)
      .map((entry) => ({ platform, cookie: entry.cookie })),
  )

  const results = await Promise.all(
    candidates.map(async ({ platform, cookie }) => ({
      platform,
      refreshed: await refreshMembershipEntry(roomId, platform, userId, cookie, loadInfo),
    })),
  )
  return results.filter((result) => result.refreshed).map((result) => result.platform)
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
    vipLabel: entry.vipLabel,
    vipLevel: entry.vipLevel,
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
  return getBestAuth(platform, roomId)?.cookie ?? null
}

export interface BestPlatformAuth {
  cookie: string
  vipType: 0 | 1 | 2
}

/** Return the credential with the highest normalized membership tier. */
export function getBestAuth(platform: MusicSource, roomId: string): BestPlatformAuth | null {
  const pool = roomCookiePool.get(roomId)
  if (!pool) return null
  const entries = pool.get(platform)
  if (!entries || entries.length === 0) return null

  // 单次遍历取最高 vipType 的 cookie（O(n) 替代排序 O(n log n)）
  let best = entries[0]
  for (let i = 1; i < entries.length; i++) {
    if (isHigherMembership(entries[i], best)) best = entries[i]
  }
  return { cookie: best.cookie, vipType: normalizeVipType(platform, best.vipType) }
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

/** Existing VIP records without a detailed label should be revalidated once after upgrades. */
export function needsMembershipRefresh(userId: string, platform: MusicSource, roomId: string): boolean {
  const entry = roomCookiePool
    .get(roomId)
    ?.get(platform)
    ?.find((item) => item.userId === userId)
  return Boolean(entry && entry.vipType > 0 && !entry.vipLabel)
}

// ---------------------------------------------------------------------------
// Status for frontend
// ---------------------------------------------------------------------------

/**
 * Get aggregated auth status for all platforms in a specific room.
 */
export function getAllPlatformStatus(roomId: string): PlatformAuthStatus[] {
  const platforms: MusicSource[] = ['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili']
  const pool = roomCookiePool.get(roomId)
  return platforms.map((platform) => {
    const entries = pool?.get(platform) ?? []
    const best = entries.reduce<CookieEntry | undefined>(
      (current, entry) => (isHigherMembership(entry, current) ? entry : current),
      undefined,
    )
    const maxVipType = best?.vipType ?? 0
    return {
      platform,
      loggedInCount: entries.length,
      hasVip: maxVipType > 0,
      maxVipType,
      maxVipLabel: best?.vipLabel,
      maxVipLevel: best?.vipLevel,
    }
  })
}

/**
 * Get a specific user's auth status across all platforms in a specific room.
 */
export function getUserAuthStatus(userId: string, roomId: string): MyPlatformAuth[] {
  const platforms: MusicSource[] = ['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili']
  const pool = roomCookiePool.get(roomId)
  return platforms.map((platform) => {
    const entries = pool?.get(platform) ?? []
    const entry = entries.find((e) => e.userId === userId)
    return {
      platform,
      loggedIn: !!entry,
      nickname: entry?.nickname,
      vipType: entry?.vipType,
      vipLabel: entry?.vipLabel,
      vipLevel: entry?.vipLevel,
    }
  })
}
