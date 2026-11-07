import type { AudioQuality, MusicSource } from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import pLimit from 'p-limit'
import { logger } from '../utils/logger.js'
import {
  musicProvider,
  type ProviderStreamFailure,
  type StreamResolutionOutcome,
  type StreamUrlResult,
} from './musicProvider.js'

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
const inFlight = new Map<string, Promise<StreamResolutionOutcome>>()
const negativeCache = new LRUCache<string, ProviderStreamFailure>({ max: 1_000, ttl: 30_000 })

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
  return (await resolveStreamDetailed(source, urlId, quality, options)).result
}

/**
 * Same as {@link resolveStream}, but keeps the provider's failure facts so the
 * player can explain why a track could not be resolved.
 */
export async function resolveStreamDetailed(
  source: MusicSource,
  urlId: string,
  quality: AudioQuality = 320,
  options: ResolveStreamOptions = {},
): Promise<StreamResolutionOutcome> {
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
    } else {
      const cachedFailure = negativeCache.get(key)
      if (cachedFailure) {
        metrics.negativeHits += 1
        sourceMetrics.negativeHits += 1
        return { result: null, failure: cachedFailure }
      }
    }
    const shared = inFlight.get(shareKey)
    if (shared) {
      metrics.deduped += 1
      sourceMetrics.deduped += 1
      return shared
    }
  }

  let task: Promise<StreamResolutionOutcome>
  task = limiterFor(source)(() =>
    musicProvider.getStreamInfoDetailed(source, urlId, quality, cookie, forceRefresh, vipType),
  )
    .then((outcome) => {
      const result = outcome.result
      if (result?.fromCache) {
        metrics.cacheHits += 1
        sourceMetrics.cacheHits += 1
      }
      if (!result) {
        metrics.failures += 1
        sourceMetrics.failures += 1
        const failure = outcome.failure ?? { reason: 'unknown' as const }
        if (shareable && !forceRefresh) {
          negativeCache.set(key, failure, { ttl: negativeTtlMs() })
        }
        return { result: null, failure }
      }
      return { result, failure: null }
    })
    .catch((error: unknown) => {
      metrics.failures += 1
      sourceMetrics.failures += 1
      logger.warn('播放地址解析异常', { source, urlId, quality, error })
      const failure: ProviderStreamFailure = {
        reason: 'upstream-unreachable',
        providerMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      }
      return { result: null, failure }
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
