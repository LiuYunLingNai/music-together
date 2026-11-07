import type { AudioQuality, MusicSource } from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import pLimit from 'p-limit'
import { logger } from '../utils/logger.js'
import { musicProvider, type StreamUrlResult } from './musicProvider.js'

const SOURCE_CONCURRENCY = 3
const NEGATIVE_TTL_MIN_MS = 20_000
const NEGATIVE_TTL_MAX_MS = 40_000

type Limiter = ReturnType<typeof pLimit>

interface SourceMetrics {
  requests: number
  cacheHits: number
  deduped: number
  negativeHits: number
  failures: number
}

export interface StreamResolutionMetrics {
  requests: number
  cacheHits: number
  deduped: number
  negativeHits: number
  failures: number
  bySource: Record<MusicSource, SourceMetrics>
}

function emptySourceMetrics(): SourceMetrics {
  return { requests: 0, cacheHits: 0, deduped: 0, negativeHits: 0, failures: 0 }
}

function emptyMetrics(): StreamResolutionMetrics {
  return {
    requests: 0,
    cacheHits: 0,
    deduped: 0,
    negativeHits: 0,
    failures: 0,
    bySource: {
      netease: emptySourceMetrics(),
      tencent: emptySourceMetrics(),
      kugou: emptySourceMetrics(),
      kugou_concept: emptySourceMetrics(),
      bilibili: emptySourceMetrics(),
    },
  }
}

const metrics = emptyMetrics()
const limiters = new Map<MusicSource, Limiter>()
const inFlight = new Map<string, Promise<StreamUrlResult | null>>()
const negativeCache = new LRUCache<string, true>({ max: 1_000, ttl: 30_000 })

function limiterFor(source: MusicSource): Limiter {
  let limiter = limiters.get(source)
  if (!limiter) {
    limiter = pLimit(SOURCE_CONCURRENCY)
    limiters.set(source, limiter)
  }
  return limiter
}

function negativeTtlMs(): number {
  return NEGATIVE_TTL_MIN_MS + Math.floor(Math.random() * (NEGATIVE_TTL_MAX_MS - NEGATIVE_TTL_MIN_MS))
}

export interface ResolveStreamOptions {
  /** Cookie URLs are user-specific: they bypass shared in-flight/negative caches. */
  cookie?: string
  forceRefresh?: boolean
  vipType?: number
}

/**
 * Resolve one provider stream URL with process-wide single-flight, per-source concurrency,
 * a short negative cache and basic counters. The provider's own stream cache still decides
 * whether a fresh upstream request is needed.
 */
export async function resolveStream(
  source: MusicSource,
  urlId: string,
  quality: AudioQuality = 320,
  options: ResolveStreamOptions = {},
): Promise<StreamUrlResult | null> {
  const { cookie, forceRefresh = false, vipType = 0 } = options
  const shareable = !cookie
  const key = `${source}:${urlId}:${quality}`
  const shareKey = forceRefresh ? `${key}:force` : key
  const sourceMetrics = metrics.bySource[source]

  metrics.requests += 1
  sourceMetrics.requests += 1

  if (shareable) {
    if (forceRefresh) {
      negativeCache.delete(key)
    } else if (negativeCache.has(key)) {
      metrics.negativeHits += 1
      sourceMetrics.negativeHits += 1
      return null
    }
    const shared = inFlight.get(shareKey)
    if (shared) {
      metrics.deduped += 1
      sourceMetrics.deduped += 1
      return shared
    }
  }

  let task: Promise<StreamUrlResult | null>
  task = limiterFor(source)(() => musicProvider.getStreamInfo(source, urlId, quality, cookie, forceRefresh, vipType))
    .then((result) => {
      if (result?.fromCache) {
        metrics.cacheHits += 1
        sourceMetrics.cacheHits += 1
      }
      if (!result) {
        metrics.failures += 1
        sourceMetrics.failures += 1
        if (shareable && !forceRefresh) {
          negativeCache.set(key, true, { ttl: negativeTtlMs() })
        }
      }
      return result
    })
    .catch((error: unknown) => {
      metrics.failures += 1
      sourceMetrics.failures += 1
      logger.warn('播放地址解析异常', { source, urlId, quality, error })
      return null
    })
    .finally(() => {
      if (inFlight.get(shareKey) === task) inFlight.delete(shareKey)
    })

  if (shareable) inFlight.set(shareKey, task)
  return task
}

export function getStreamResolutionMetrics(): StreamResolutionMetrics {
  return {
    ...metrics,
    bySource: Object.fromEntries(
      Object.entries(metrics.bySource).map(([source, value]) => [source, { ...value }]),
    ) as Record<MusicSource, SourceMetrics>,
  }
}
