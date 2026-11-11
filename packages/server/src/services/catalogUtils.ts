import type { Artist, Playlist } from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import { getCoverArtwork } from './coverArtwork.js'

/** 网易云目录类服务（歌手主页、发现页）共用的工具：松散的上游数据进，干净的值出。 */

export type Raw = Record<string, unknown>

export type CatalogErrorKind = 'unsupported' | 'not-found' | 'upstream'

/**
 * 脱敏后的目录错误：固定 `code` 与 HTTP `status`，消息里不带上游响应。
 * 上游失败统一 503，避免 Cloudflare 用无 CORS 头的错误页替换 502/504。
 */
export class CatalogError extends Error {
  constructor(
    readonly kind: CatalogErrorKind,
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
    this.name = 'CatalogError'
  }
}

export const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
export const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export function numericId(value: unknown): string | null {
  const raw = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''
  return /^\d{1,20}$/.test(raw) ? raw : null
}

export function neteaseCover(raw: Raw): { cover: string; thumbnailCover?: string } {
  const cover = text(raw.picUrl) || text(raw.img1v1Url) || text(raw.coverImgUrl) || text(raw.cover)
  return cover ? getCoverArtwork('netease', cover) : { cover: '' }
}

export function neteaseArtist(raw: Raw, options: { description?: boolean } = {}): Artist | null {
  const id = numericId(raw.id)
  const name = text(raw.name)
  if (!id || !name) return null
  return {
    id,
    name,
    ...neteaseCover(raw),
    source: 'netease',
    albumCount: count(raw.albumSize),
    songCount: count(raw.musicSize),
    ...(options.description && text(raw.briefDesc) ? { description: text(raw.briefDesc) } : {}),
  }
}

/** 网易云专辑，以歌单形状返回（曲目用 `type: 'album'` 读取）。 */
export function neteaseAlbum(raw: Raw): Playlist | null {
  const id = numericId(raw.id)
  const name = text(raw.name)
  if (!id || !name) return null
  return {
    id,
    name,
    ...neteaseCover(raw),
    trackCount: count(raw.size) ?? 0,
    source: 'netease',
    creator: isRecord(raw.artist) ? text(raw.artist.name) : '',
  }
}

export function pick<T>(raw: unknown, map: (item: Raw) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const mapped = isRecord(item) ? map(item) : null
    return mapped ? [mapped] : []
  })
}

/** 在 `ms` 内完成，否则以 `onTimeout()` 拒绝；SDK 请求无法取消，超时后的迟到失败不能变成未处理拒绝。 */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms)
  })
  work.catch(() => {})
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/** 带 TTL 的缓存，同一 key 的并发未命中共享一次上游请求；失败结果不缓存。 */
export function sharedCache<T extends object>(max: number, ttl: number) {
  const cache = new LRUCache<string, T>({ max, ttl })
  const inflight = new Map<string, Promise<T>>()
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key)
    if (hit) return Promise.resolve(hit)
    const running = inflight.get(key)
    if (running) return running
    const started = load()
      .then((value) => {
        cache.set(key, value)
        return value
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, started)
    return started
  }
}

type NcmCall = (query: Record<string, unknown>) => Promise<{ body?: Record<string, unknown> }>

/** 调用网易云接口：超时、非 200 业务码或畸形响应都视为失败，并映射为调用方的错误。 */
export function createNcmCaller(
  timeoutMs: number,
  errors: { upstream: () => CatalogError; notFound: () => CatalogError },
  log: (label: string, code?: unknown) => void,
) {
  return async (label: string, fn: NcmCall, query: Record<string, unknown>): Promise<Raw> => {
    try {
      const response = await withDeadline(fn(query), timeoutMs, errors.upstream)
      const body = response?.body
      if (!isRecord(body)) throw errors.upstream()
      if (body.code !== undefined && body.code !== 200) {
        log(label, body.code)
        throw body.code === 404 ? errors.notFound() : errors.upstream()
      }
      return body
    } catch (error) {
      if (error instanceof CatalogError) throw error
      log(label)
      throw errors.upstream()
    }
  }
}
