import { judgeSongAudioForCache } from './wholeSongCheck'
import { notePlayback } from './playbackDiagnostics'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'

/**
 * 持久媒体缓存（Cache Storage）。
 *
 * 只存校验过的整曲字节：写入前按 `wholeSongCheck` 拒绝试听片段；缓存键是
 * 稳定曲目身份，绝不能带会过期的直链。容量上限与开关来自音频设置，默认
 * 300 MB；配额不足、隐私模式或 Cache API 不可用时全部 fail-open。
 */

const CACHE_NAME = 'mt-audio-v1'
const INDEX_KEY = 'mt-media-cache-index-v1'
const MIN_CACHEABLE_BYTES = 16 * 1024
const MAX_LIMIT_MB = 5000

interface CacheIndexEntry {
  bytes: number
  usedAt: number
  /** 是否经过解码时长校验；只有校验过的整曲才允许被播放侧当作完整音频预热。 */
  validated?: boolean
}

type CacheIndex = Record<string, CacheIndexEntry>

const cacheKeyFor = (key: string): string => `/audio/${encodeURIComponent(key)}`

const enabled = (): boolean => useAudioSettingsStore.getState().mediaCacheEnabled
const limitBytes = (): number => {
  const mb = useAudioSettingsStore.getState().mediaCacheLimitMb
  return Math.max(0, Math.min(MAX_LIMIT_MB, mb)) * 1024 * 1024
}

function readIndex(): CacheIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const result: CacheIndex = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as Partial<CacheIndexEntry>
      if (typeof entry.bytes !== 'number' || !Number.isFinite(entry.bytes)) continue
      result[key] = {
        bytes: Math.max(0, entry.bytes),
        usedAt: typeof entry.usedAt === 'number' ? entry.usedAt : 0,
      }
    }
    return result
  } catch {
    return {}
  }
}

function writeIndex(index: CacheIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    // 配额不足时索引失效；缓存本体仍可能命中，下次写入会重建。
  }
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

export async function getCachedAudioBytes(
  key: string,
  options: { requireValidated?: boolean } = {},
): Promise<ArrayBuffer | null> {
  if (!enabled()) return null
  const cache = await openCache()
  if (!cache) return null
  const index = readIndex()
  // 播放侧只认解码校验过的整曲：预取写入的字节还没有真实时长，可能是试听片段。
  if (options.requireValidated && index[key]?.validated !== true) return null
  try {
    const response = await cache.match(cacheKeyFor(key))
    if (!response) return null
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength < MIN_CACHEABLE_BYTES) {
      await deleteCachedAudio(key)
      return null
    }
    if (index[key]) {
      index[key].usedAt = Date.now()
      writeIndex(index)
    }
    return bytes
  } catch {
    return null
  }
}

export async function deleteCachedAudio(key: string): Promise<void> {
  const cache = await openCache()
  try {
    await cache?.delete(cacheKeyFor(key))
  } catch {
    // 已不存在。
  }
  const index = readIndex()
  if (index[key]) {
    delete index[key]
    writeIndex(index)
  }
}

/** 解码完成后校正：片段一律删除，整曲保留。 */
export async function validateCachedAudio(
  key: string,
  actualDurationSec: number | null,
  statedDurationSec: number | null,
): Promise<void> {
  const index = readIndex()
  const verdict = judgeSongAudioForCache({
    actualDurationSec,
    statedDurationSec,
    hasCopy: Boolean(index[key]),
  })
  if (verdict.distrustExisting) await deleteCachedAudio(key)
}

/**
 * 写入整曲字节。返回是否落盘。
 * 未知时长只在没有旧副本时写入，避免片段覆盖已验证的整曲。
 */
export async function putCachedAudioBytes(
  key: string,
  bytes: ArrayBuffer,
  options: {
    statedDurationSec?: number | null
    actualDurationSec?: number | null
    /** 调用方已用解码后的真实时长确认是整曲。 */
    validated?: boolean
  } = {},
): Promise<boolean> {
  if (!enabled() || bytes.byteLength < MIN_CACHEABLE_BYTES) {
    notePlayback('cacheWriteSkips')
    return false
  }
  const limit = limitBytes()
  if (limit <= 0 || bytes.byteLength > limit) {
    notePlayback('cacheWriteSkips')
    return false
  }

  const index = readIndex()
  const verdict = judgeSongAudioForCache({
    actualDurationSec: options.actualDurationSec,
    statedDurationSec: options.statedDurationSec,
    hasCopy: Boolean(index[key]),
  })
  if (verdict.distrustExisting) {
    await deleteCachedAudio(key)
    notePlayback('cacheWriteSkips')
    return false
  }
  if (!verdict.store) {
    notePlayback('cacheWriteSkips')
    return false
  }

  const cache = await openCache()
  if (!cache) {
    notePlayback('cacheWriteSkips')
    return false
  }
  try {
    await cache.put(
      cacheKeyFor(key),
      new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }),
    )
  } catch {
    notePlayback('cacheWriteSkips')
    return false
  }

  index[key] = { bytes: bytes.byteLength, usedAt: Date.now(), validated: options.validated === true }
  let total = Object.values(index).reduce((sum, entry) => sum + entry.bytes, 0)
  while (total > limit) {
    const victim = Object.entries(index)
      .filter(([entryKey]) => entryKey !== key)
      .sort((a, b) => a[1].usedAt - b[1].usedAt)[0]
    if (!victim) break
    delete index[victim[0]]
    total -= victim[1].bytes
    try {
      await cache.delete(cacheKeyFor(victim[0]))
    } catch {
      // 忽略单条删除失败，索引已经不再引用它。
    }
  }
  writeIndex(index)
  notePlayback('cacheWrites')
  return true
}

export async function clearMediaCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME)
  } catch {
    // 忽略。
  }
  try {
    localStorage.removeItem(INDEX_KEY)
  } catch {
    // 忽略。
  }
}

export async function getMediaCacheStats(): Promise<{ entries: number; bytes: number }> {
  const index = readIndex()
  return {
    entries: Object.keys(index).length,
    bytes: Object.values(index).reduce((sum, entry) => sum + entry.bytes, 0),
  }
}
