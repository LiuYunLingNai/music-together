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
/** 平台明确要求稍后再试时，最多等这么久。 */
const MAX_RATE_LIMIT_COOLDOWN_MS = 600_000
/** 平台 5xx / 连不上时只让预取退避，用户主动点歌照常尝试。 */
const PREFETCH_BACKOFF_MS = 30_000

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

interface ProviderCooldown {
  playUntil: number
  prefetchUntil: number
  reason: ProviderStreamFailure['reason']
}

const providerCooldowns = new Map<MusicSource, ProviderCooldown>()

function cooldownFailure(source: MusicSource, purpose: 'play' | 'prefetch'): ProviderStreamFailure | null {
  const entry = providerCooldowns.get(source)
  if (!entry) return null
  const now = Date.now()
  const until = purpose === 'prefetch' ? Math.max(entry.playUntil, entry.prefetchUntil) : entry.playUntil
  if (until <= now) return null
  return { reason: entry.reason, retryAfterMs: until - now }
}

function noteProviderCooldown(source: MusicSource, failure: ProviderStreamFailure): void {
  const now = Date.now()
  const rateLimited = failure.reason === 'rate-limited'
  const serviceFailed =
    failure.reason === 'upstream-unreachable' || (failure.httpStatus ?? 0) >= 500
  if (!rateLimited && !serviceFailed) return
  const entry = providerCooldowns.get(source) ?? {
    playUntil: 0,
    prefetchUntil: 0,
    reason: failure.reason,
  }
  if (rateLimited) {
    const wait =
      typeof failure.retryAfterMs === 'number' && failure.retryAfterMs > 0
        ? Math.min(failure.retryAfterMs, MAX_RATE_LIMIT_COOLDOWN_MS)
        : null
    if (wait !== null) {
      // 平台明确说了等多久：点歌与预取一起等。
      entry.playUntil = Math.max(entry.playUntil, now + wait)
      entry.prefetchUntil = Math.max(entry.prefetchUntil, now + wait)
    } else {
      // 没给时长时只让预取退避，用户主动点歌照常尝试一次。
      entry.prefetchUntil = Math.max(entry.prefetchUntil, now + PREFETCH_BACKOFF_MS)
    }
    entry.reason = 'rate-limited'
  } else {
    entry.prefetchUntil = Math.max(entry.prefetchUntil, now + PREFETCH_BACKOFF_MS)
    if (entry.reason !== 'rate-limited') entry.reason = failure.reason
  }
  providerCooldowns.set(source, entry)
}

function negativeTtlFor(failure: ProviderStreamFailure): number {
  if (typeof failure.retryAfterMs === 'number' && failure.retryAfterMs > 0) {
    return Math.min(Math.max(failure.retryAfterMs, NEGATIVE_TTL_MIN_MS), MAX_RATE_LIMIT_COOLDOWN_MS)
  }
  return negativeTtlMs()
}

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
  /** 预取请求在平台退避期直接失败；用户主动点歌不受 5xx 退避影响。 */
  purpose?: 'play' | 'prefetch'
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
  const { cookie, forceRefresh = false, vipType = 0, purpose = 'play' } = options
  const shareable = !cookie
  const key = `${source}:${urlId}:${quality}`
  const shareKey = forceRefresh ? `${key}:force` : key
  const sourceMetrics = metrics.bySource[source]

  const cooled = cooldownFailure(source, purpose)
  if (cooled) {
    metrics.failures += 1
    sourceMetrics.failures += 1
    return { result: null, failure: cooled }
  }

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
        noteProviderCooldown(source, failure)
        if (shareable && !forceRefresh) {
          negativeCache.set(key, failure, { ttl: negativeTtlFor(failure) })
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
      noteProviderCooldown(source, failure)
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
