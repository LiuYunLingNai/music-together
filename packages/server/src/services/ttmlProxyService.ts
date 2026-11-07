import { createHash } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import { config } from '../config.js'

const MAX_TTML_BYTES = 2 * 1024 * 1024
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000

interface CachedTtml {
  body: string
  etag: string
}

export interface TtmlProxyResponse {
  body: string
  etag: string
  notModified: boolean
}

export class TtmlProxyError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'TtmlProxyError'
  }
}

const cache = new LRUCache<string, CachedTtml>({ max: 500, ttl: CACHE_TTL_MS })
const inFlight = new Map<string, Promise<CachedTtml | null>>()

export interface TtmlProxyMetrics {
  requests: number
  cacheHits: number
  deduped: number
  notModified: number
  misses: number
  failures: number
}

const metrics: TtmlProxyMetrics = {
  requests: 0,
  cacheHits: 0,
  deduped: 0,
  notModified: 0,
  misses: 0,
  failures: 0,
}

export function getTtmlProxyMetrics(): TtmlProxyMetrics {
  return { ...metrics }
}

const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function normalizeUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new TtmlProxyError(400, 'Invalid TTML URL')
  }
  if (url.protocol !== 'https:') throw new TtmlProxyError(400, 'TTML URL must use HTTPS')
  if (url.username || url.password) throw new TtmlProxyError(400, 'TTML URL must not include credentials')
  if (url.port && url.port !== '443') throw new TtmlProxyError(400, 'TTML URL must use the default HTTPS port')
  if (!config.ttml.allowedHosts.has(url.hostname.toLowerCase())) {
    throw new TtmlProxyError(403, 'TTML host is not allowed')
  }
  return url
}

/** Validate a redirect target with the same rules as the original URL. */
function resolveRedirectTarget(location: string, currentUrl: URL): URL {
  let nextUrl: URL
  try {
    nextUrl = new URL(location, currentUrl)
  } catch {
    throw new TtmlProxyError(502, 'TTML upstream redirect is invalid')
  }
  try {
    return normalizeUrl(nextUrl.toString())
  } catch (error) {
    if (error instanceof TtmlProxyError) {
      throw new TtmlProxyError(502, `TTML upstream redirect blocked: ${error.message}`)
    }
    throw error
  }
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  return header
    .split(',')
    .map((value) => value.trim())
    .includes(etag)
}

async function readBodyWithLimit(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > MAX_TTML_BYTES) {
      throw new TtmlProxyError(502, 'TTML document is too large')
    }
    return body
  }

  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_TTML_BYTES) throw new TtmlProxyError(502, 'TTML document is too large')
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    if ((error as { name?: string }).name === 'TimeoutError') {
      throw new TtmlProxyError(504, 'TTML upstream timeout')
    }
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function fetchUpstream(url: URL): Promise<CachedTtml | null> {
  let currentUrl = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        headers: { Accept: 'application/ttml+xml, application/xml, text/xml, text/plain;q=0.9' },
        signal: AbortSignal.timeout(config.ttml.timeoutMs),
      })
    } catch (error) {
      const timedOut = (error as { name?: string }).name === 'TimeoutError'
      throw new TtmlProxyError(timedOut ? 504 : 502, timedOut ? 'TTML upstream timeout' : 'TTML upstream failed')
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (hop === MAX_REDIRECTS) {
        throw new TtmlProxyError(502, 'TTML upstream redirected too many times')
      }
      const location = response.headers.get('location')
      if (response.body) await response.body.cancel().catch(() => {})
      if (!location) throw new TtmlProxyError(502, 'TTML upstream redirect has no location')
      currentUrl = resolveRedirectTarget(location, currentUrl)
      continue
    }

    if (response.status === 404) return null
    if (!response.ok) throw new TtmlProxyError(502, `TTML upstream HTTP ${response.status}`)

    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_TTML_BYTES) throw new TtmlProxyError(502, 'TTML document is too large')
    const body = await readBodyWithLimit(response)
    if (!body.includes('<tt') && !body.includes('<?xml')) {
      throw new TtmlProxyError(502, 'TTML upstream returned a non-TTML document')
    }

    return {
      body,
      etag: response.headers.get('etag') ?? `W/"${createHash('sha1').update(body).digest('base64url')}"`,
    }
  }

  throw new TtmlProxyError(502, 'TTML upstream redirected too many times')
}

/**
 * Fetch an AMLL TTML document through the server cache. Only allow-listed HTTPS
 * hosts are reachable so the endpoint cannot be used as an open proxy.
 */
export async function getTtml(rawUrl: string, ifNoneMatch?: string): Promise<TtmlProxyResponse | null> {
  metrics.requests += 1
  const url = normalizeUrl(rawUrl)
  const key = url.toString()
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
    task = fetchUpstream(url)
      .then((result) => {
        if (result) cache.set(key, result)
        return result
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, task)
  }

  let result: CachedTtml | null
  try {
    result = await task
  } catch (error) {
    metrics.failures += 1
    throw error
  }
  if (!result) {
    metrics.misses += 1
    return null
  }
  const notModified = matchesEtag(ifNoneMatch, result.etag)
  if (notModified) metrics.notModified += 1
  return { body: result.body, etag: result.etag, notModified }
}
