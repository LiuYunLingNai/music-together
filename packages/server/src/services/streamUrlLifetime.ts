import type { MusicSource } from '@music-together/shared'

const HOUR = 60 * 60 * 1000
const EXPIRY_MARGIN = 30 * 1000

/** 上游 3da604b：只解读网易云 CDN 路径里的时间戳，签名链接本身不动。 */
export function getStreamUrlExpiresAt(source: MusicSource, url: string): number | null {
  if (source !== 'netease') return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (parsed.hostname !== 'music.126.net' && !parsed.hostname.endsWith('.music.126.net')) return null
    const timestamp = parsed.pathname.split('/')[1]
    if (!timestamp || !/^\d{14}$/.test(timestamp)) return null
    const year = Number(timestamp.slice(0, 4))
    const month = Number(timestamp.slice(4, 6))
    const day = Number(timestamp.slice(6, 8))
    const hour = Number(timestamp.slice(8, 10))
    const minute = Number(timestamp.slice(10, 12))
    const second = Number(timestamp.slice(12, 14))
    if (year < 1) return null
    const date = new Date(0)
    date.setUTCFullYear(year, month - 1, day)
    date.setUTCHours(hour, minute, second, 0)
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second
    )
      return null
    // CDN 时间戳是北京时间（UTC+8），与服务器所在时区无关。
    return date.getTime() - 8 * HOUR
  } catch {
    return null
  }
}

export function isStreamUrlExpired(source: MusicSource, url: string, now = Date.now()): boolean {
  const expiresAt = getStreamUrlExpiresAt(source, url)
  return expiresAt !== null && expiresAt - now <= EXPIRY_MARGIN
}

/** 缓存时长：网易云按链接真实过期时间收短，其余来源维持默认。 */
export function getStreamUrlCacheTtl(source: MusicSource, url: string, fallbackMs: number, now = Date.now()): number {
  const expiresAt = getStreamUrlExpiresAt(source, url)
  return expiresAt === null ? fallbackMs : Math.max(1, Math.min(fallbackMs, expiresAt - now - EXPIRY_MARGIN))
}
