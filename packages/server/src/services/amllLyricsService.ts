import { createHash } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import pLimit from 'p-limit'
import {
  isLyricMatchAcceptable,
  normalizeLyricMatchText,
  scoreLyricMatch,
  type LyricMatchScore,
} from '@music-together/shared'

const AMLL_API_BASE_URL = 'https://api.amll.dev/v1/lyrics/get'
const AMLL_SEARCH_URL = 'https://api.amll.dev/v1/lyrics/search'
const AMLL_API_TIMEOUT_MS = 5_000
const MAX_TTML_BYTES = 2 * 1024 * 1024
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1_000
const SEARCH_PAGE_SIZE = 20
const SEARCH_CANDIDATE_LIMIT = 5

export type AmllPlatform = 'ncm' | 'qq'

interface AmllSearchItem {
  filename?: string
  musicNames?: string[]
  artistNames?: string[]
  albumNames?: string[]
  ncmMusicIds?: Array<string | number>
  qqMusicIds?: Array<string | number>
}

interface AmllSearchQuery {
  musicName?: string
  artistName?: string
  q?: string
}

export interface AmllSearchRequest {
  title: string
  artists: string[]
  album?: string
  duration?: number
}

interface CachedTtml {
  body: string
  etag: string
}

export interface AmllTtmlResponse {
  body: string
  etag: string
  notModified: boolean
}

const cache = new LRUCache<string, CachedTtml>({ max: 500, ttl: CACHE_TTL_MS })
const inFlight = new Map<string, Promise<CachedTtml | null>>()
const searchPageCache = new LRUCache<string, AmllSearchItem[]>({ max: 200, ttl: SEARCH_CACHE_TTL_MS })
const searchResultCache = new LRUCache<string, CachedTtml | false>({
  max: 200,
  ttl: SEARCH_CACHE_TTL_MS,
})
/** The shared server IP must stay well under AMLL's per-IP rate limit. */
const requestLimit = pLimit(2)

export interface AmllLyricsMetrics {
  requests: number
  cacheHits: number
  deduped: number
  notModified: number
  misses: number
  searchRequests: number
  searchHits: number
  searchMisses: number
}

const metrics: AmllLyricsMetrics = {
  requests: 0,
  cacheHits: 0,
  deduped: 0,
  notModified: 0,
  misses: 0,
  searchRequests: 0,
  searchHits: 0,
  searchMisses: 0,
}

export function getAmllLyricsMetrics(): AmllLyricsMetrics {
  return { ...metrics }
}

function buildLyricsUrl(platform: AmllPlatform, musicId: string): string {
  const query = new URLSearchParams({
    [platform === 'ncm' ? 'ncmMusicId' : 'qqMusicId']: musicId,
  })
  return `${AMLL_API_BASE_URL}?${query.toString()}`
}

/** AMLL's musicName matches by containment, so a parenthesized version suffix only hurts. */
const TITLE_SUFFIX = /(?:\s*[([{（【][^)\]）】}]*[)\]）】}])+\s*$/u

function buildSearchQueries(title: string, artists: string[]): AmllSearchQuery[] {
  const baseName = title.replace(TITLE_SUFFIX, '').trim() || title
  const artistName = artists[0]?.trim()
  const queries: AmllSearchQuery[] = []
  if (artistName) queries.push({ musicName: title, artistName })
  if (artistName && baseName !== title) queries.push({ musicName: baseName, artistName })
  queries.push({ musicName: baseName })
  queries.push({ q: title })
  const seen = new Set<string>()
  return queries.filter((query) => {
    const key = `${query.musicName ?? ''}\u0002${query.artistName ?? ''}\u0002${query.q ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildSearchUrl(query: AmllSearchQuery): string {
  const params = new URLSearchParams()
  if (query.musicName) params.set('musicName', query.musicName)
  if (query.artistName) params.set('artistName', query.artistName)
  if (query.q) params.set('q', query.q)
  params.set('pageSize', String(SEARCH_PAGE_SIZE))
  return `${AMLL_SEARCH_URL}?${params.toString()}`
}

async function fetchSearchPage(query: AmllSearchQuery): Promise<AmllSearchItem[]> {
  const key = `${query.musicName ?? ''}\u0002${query.artistName ?? ''}\u0002${query.q ?? ''}`
  const cached = searchPageCache.get(key)
  if (cached) return cached

  let response: Response
  try {
    response = await requestLimit(() =>
      fetch(buildSearchUrl(query), {
        redirect: 'manual',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(AMLL_API_TIMEOUT_MS),
      }),
    )
  } catch {
    return []
  }
  if (response.status !== 200) return []

  const body = await response.text()
  if (!body || Buffer.byteLength(body, 'utf8') > MAX_TTML_BYTES) return []

  try {
    const payload = JSON.parse(body) as { status?: number; data?: { items?: AmllSearchItem[] } }
    if (payload.status !== 200 || !Array.isArray(payload.data?.items)) return []
    searchPageCache.set(key, payload.data.items)
    return payload.data.items
  } catch {
    return []
  }
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header
    .split(',')
    .map((value) => value.trim())
    .includes(etag)
}

async function fetchAmllTtml(platform: AmllPlatform, musicId: string): Promise<CachedTtml | null> {
  let response: Response
  try {
    response = await requestLimit(() =>
      fetch(buildLyricsUrl(platform, musicId), {
        redirect: 'manual',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(AMLL_API_TIMEOUT_MS),
      }),
    )
  } catch {
    return null
  }
  if (response.status !== 200) return null

  const body = await response.text()
  if (!body || Buffer.byteLength(body, 'utf8') > MAX_TTML_BYTES) return null

  let payload: { status?: number; data?: { lyrics?: unknown } } | null = null
  try {
    payload = JSON.parse(body) as { status?: number; data?: { lyrics?: unknown } }
  } catch {
    return null
  }
  if (payload?.status !== 200) return null
  const ttml = typeof payload.data?.lyrics === 'string' ? payload.data.lyrics : ''
  if (!ttml || !/<tt(?:\s|>)/i.test(ttml)) return null

  return {
    body: ttml,
    etag: `W/"${createHash('sha1').update(ttml).digest('base64url')}"`,
  }
}

function scoreSearchItem(item: AmllSearchItem, request: AmllSearchRequest): LyricMatchScore | null {
  const titles = item.musicNames?.length ? item.musicNames : item.filename ? [item.filename] : []
  const artists = item.artistNames ?? []
  if (titles.length === 0 || artists.length === 0) return null
  let best: LyricMatchScore | null = null
  for (const title of titles) {
    const score = scoreLyricMatch(
      { title: request.title, artists: request.artists, album: request.album, duration: request.duration },
      { title, artists, album: item.albumNames?.[0] },
    )
    if (!best || score.score > best.score) best = score
  }
  return best
}

function platformIds(item: AmllSearchItem, platform: AmllPlatform): string[] {
  const ids = platform === 'ncm' ? item.ncmMusicIds : item.qqMusicIds
  return (ids ?? []).map((id) => String(id)).filter(Boolean)
}

export interface AmllTtmlCandidate {
  platform: AmllPlatform
  id: string
  title: string
  artist: string[]
  album?: string
  score: number
}

async function findSearchCandidates(
  request: AmllSearchRequest,
): Promise<Array<{ item: AmllSearchItem; score: LyricMatchScore }>> {
  const items: AmllSearchItem[] = []
  for (const query of buildSearchQueries(request.title, request.artists)) {
    const page = await fetchSearchPage(query)
    if (page.length > 0) {
      items.push(...page)
      break
    }
  }

  return items
    .map((item) => ({ item, score: scoreSearchItem(item, request) }))
    .filter(
      (entry): entry is { item: AmllSearchItem; score: LyricMatchScore } =>
        !!entry.score && isLyricMatchAcceptable(entry.score),
    )
    .sort((left, right) => right.score.score - left.score.score)
    .slice(0, SEARCH_CANDIDATE_LIMIT)
}

/** Search matches without downloading TTML, for the manual lyric-source picker. */
export async function searchAmllCandidates(request: AmllSearchRequest): Promise<AmllTtmlCandidate[]> {
  metrics.searchRequests += 1
  const matches = await findSearchCandidates(request)
  const candidates: AmllTtmlCandidate[] = []
  const seen = new Set<string>()

  for (const { item, score } of matches) {
    const title = item.musicNames?.[0] ?? item.filename ?? ''
    const artist = item.artistNames ?? []
    for (const platform of ['ncm', 'qq'] as const) {
      const id = platformIds(item, platform)[0]
      if (!id || seen.has(`${platform}:${id}`)) continue
      seen.add(`${platform}:${id}`)
      candidates.push({ platform, id, title, artist, album: item.albumNames?.[0], score: score.score })
    }
  }

  if (candidates.length > 0) metrics.searchHits += 1
  else metrics.searchMisses += 1
  return candidates.slice(0, 10)
}

/**
 * Look up TTML by song identity when the platform id has no AMLL entry. This
 * mirrors Folia's AMLL DB source: search by title + first artist, accept only
 * a title-and-artist match, then try the candidate's platform ids.
 */
export async function searchAmllTtml(
  platform: AmllPlatform,
  request: AmllSearchRequest,
  ifNoneMatch?: string,
): Promise<AmllTtmlResponse | null> {
  const cacheKey = [
    platform,
    normalizeLyricMatchText(request.title),
    request.artists.map(normalizeLyricMatchText).join(','),
    request.album ? normalizeLyricMatchText(request.album) : '',
  ].join('\u0002')
  const cached = searchResultCache.get(cacheKey)
  if (cached !== undefined) {
    return cached ? { ...cached, notModified: matchesEtag(ifNoneMatch, cached.etag) } : null
  }

  metrics.searchRequests += 1
  const candidates = await findSearchCandidates(request)

  for (const { item } of candidates) {
    for (const id of platformIds(item, platform)) {
      const result = await getAmllTtml(platform, id, ifNoneMatch)
      if (result) {
        searchResultCache.set(cacheKey, { body: result.body, etag: result.etag })
        metrics.searchHits += 1
        return result
      }
    }
  }

  searchResultCache.set(cacheKey, false)
  metrics.searchMisses += 1
  return null
}

/**
 * Fetch TTML from the official AMLL API by exact platform id. The API is only
 * used as a fallback after the platform/DB lyric is unavailable.
 */
export async function getAmllTtml(
  platform: AmllPlatform,
  musicId: string,
  ifNoneMatch?: string,
): Promise<AmllTtmlResponse | null> {
  metrics.requests += 1
  const key = `${platform}:${musicId}`
  const cached = cache.get(key)
  if (cached) {
    metrics.cacheHits += 1
    const notModified = matchesEtag(ifNoneMatch, cached.etag)
    if (notModified) metrics.notModified += 1
    return { body: cached.body, etag: cached.etag, notModified }
  }

  let task = inFlight.get(key)
  if (task) {
    metrics.deduped += 1
  } else {
    task = fetchAmllTtml(platform, musicId)
      .then((result) => {
        if (result) cache.set(key, result)
        return result
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, task)
  }

  const result = await task
  if (!result) {
    metrics.misses += 1
    return null
  }
  const notModified = matchesEtag(ifNoneMatch, result.etag)
  if (notModified) metrics.notModified += 1
  return { body: result.body, etag: result.etag, notModified }
}
