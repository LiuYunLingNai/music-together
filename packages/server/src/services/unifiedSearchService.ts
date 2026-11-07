import type { MusicSource, Track, UnifiedSearchGroup } from '@music-together/shared'
import { normalizeTrackArtists, normalizeTrackText, scoreTrackMatch, trackVersionTag } from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import { logger } from '../utils/logger.js'
import { musicProvider } from './musicProvider.js'

/** Bilibili is a video platform; its results are too different to group with music tracks. */
const UNIFIED_SOURCES: MusicSource[] = ['netease', 'tencent', 'kugou', 'kugou_concept']
const SOURCE_TIMEOUT_MS = 4_000
const CACHE_TTL_MS = 60_000
/** Higher than the fallback threshold: grouping two search rows is a stronger claim. */
const GROUP_MIN_SCORE = 85
const GROUP_MAX_DURATION_DIFF_S = 10

const cache = new LRUCache<string, UnifiedSearchGroup[]>({ max: 300, ttl: CACHE_TTL_MS })

export interface UnifiedSearchResult {
  groups: UnifiedSearchGroup[]
  failedSources: MusicSource[]
}

function groupKey(track: Track): string {
  const title = normalizeTrackText(track.title)
  const artists = normalizeTrackArtists(track.artist).sort().join('&')
  return title || artists ? `${title}|${artists}` : `${track.source}:${track.urlId}`
}

function sameSong(group: UnifiedSearchGroup, track: Track): boolean {
  if (group.duration && track.duration && Math.abs(group.duration - track.duration) > GROUP_MAX_DURATION_DIFF_S) {
    return false
  }
  const match = scoreTrackMatch(
    { title: group.title, artist: group.artist, duration: group.duration },
    { title: track.title, artist: track.artist, duration: track.duration },
  )
  return match.score >= GROUP_MIN_SCORE && match.versionCompatible
}

async function searchOne(
  source: MusicSource,
  keyword: string,
  limit: number,
  cookie: string | null,
): Promise<{ tracks: Track[]; failed: boolean }> {
  try {
    const tracks = await Promise.race([
      musicProvider.search(source, keyword, limit, 1, cookie),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SOURCE_TIMEOUT_MS)),
    ])
    if (tracks === null) {
      logger.warn('统一搜索单源超时', { event: 'search.unified_timeout', source, keyword })
      return { tracks: [], failed: true }
    }
    return { tracks, failed: false }
  } catch (error) {
    logger.warn('统一搜索单源失败', { event: 'search.unified_source_failed', source, keyword, error })
    return { tracks: [], failed: true }
  }
}

/**
 * 并行查询四个音乐平台，按“规范化标题 + 艺人集合”聚合同一首歌的不同版本。
 * 结果按来源轮转交错误，避免某个平台独占前排；每个分组内保持来源优先级。
 */
export async function searchAllSources(
  keyword: string,
  limit: number,
  cookieFor: (source: MusicSource) => string | null,
): Promise<UnifiedSearchResult> {
  const cacheable = UNIFIED_SOURCES.every((source) => !cookieFor(source))
  const cacheKey = `${keyword.toLocaleLowerCase()}:${limit}`
  if (cacheable) {
    const cached = cache.get(cacheKey)
    if (cached) return { groups: cached, failedSources: [] }
  }

  const settled = await Promise.all(
    UNIFIED_SOURCES.map(async (source) => ({
      source,
      ...(await searchOne(source, keyword, limit, cookieFor(source))),
    })),
  )

  const bySource = new Map(settled.map((entry) => [entry.source, entry.tracks]))
  const failedSources = settled.filter((entry) => entry.failed).map((entry) => entry.source)
  const groups: Array<UnifiedSearchGroup & { bestRank: number }> = []
  const maxLength = Math.max(0, ...settled.map((entry) => entry.tracks.length))

  for (let index = 0; index < maxLength; index += 1) {
    for (const source of UNIFIED_SOURCES) {
      const track = bySource.get(source)?.[index]
      if (!track) continue
      const existing = groups.find((group) => sameSong(group, track))
      if (existing) {
        existing.candidates.push(track)
        existing.bestRank = Math.min(existing.bestRank, index)
        continue
      }
      groups.push({
        key: groupKey(track),
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        version: trackVersionTag(track.title) ?? undefined,
        candidates: [track],
        bestRank: index,
      })
    }
  }

  const ordered = groups
    .sort((left, right) => left.bestRank - right.bestRank || right.candidates.length - left.candidates.length)
    .map(({ bestRank: _bestRank, ...group }) => ({
      ...group,
      candidates: [...group.candidates].sort(
        (left, right) =>
          UNIFIED_SOURCES.indexOf(left.source) - UNIFIED_SOURCES.indexOf(right.source) ||
          Number(left.vip) - Number(right.vip) ||
          Math.abs(left.duration - group.duration) - Math.abs(right.duration - group.duration),
      ),
    }))

  if (cacheable) cache.set(cacheKey, ordered)
  return { groups: ordered, failedSources }
}
