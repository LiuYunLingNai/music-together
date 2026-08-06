export const BILIBILI_BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/
export const BILIBILI_STREAM_ID_PATTERN = /^(BV[0-9A-Za-z]{10})(?:\?cid=([1-9]\d*))?$/

/**
 * A Bilibili queue item normally uses its BV id as `urlId`. Multi-part videos
 * additionally carry the selected page CID so the stream resolver requests
 * that page instead of always falling back to the first one.
 */
export function parseBilibiliStreamId(value: string): { bvid: string; cid?: number } | null {
  const match = value.match(BILIBILI_STREAM_ID_PATTERN)
  if (!match) return null
  const cid = match[2] ? Number(match[2]) : undefined
  return { bvid: match[1]!, ...(cid && Number.isSafeInteger(cid) ? { cid } : {}) }
}

export function createBilibiliStreamId(bvid: string, cid?: number): string {
  return cid && Number.isSafeInteger(cid) && cid > 0 ? `${bvid}?cid=${cid}` : bvid
}

const BILIBILI_VIDEO_PATH_PATTERN = /\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/i
const URL_IN_TEXT_PATTERN = /(?:https?:\/\/|www\.|b23\.tv\/)[^\s<>]+/gi
const TRAILING_SHARE_PUNCTUATION = /[\])}>，。！？、；："'】）]+$/
const MAX_SHORT_LINK_REDIRECTS = 5

export type BilibiliDirectInput =
  | { kind: 'bvid'; bvid: string }
  | { kind: 'short-url'; url: string }

function normalizeBvid(value: string): string | null {
  const normalized = value.startsWith('bv') ? `BV${value.slice(2)}` : value
  return BILIBILI_BVID_PATTERN.test(normalized) ? normalized : null
}

function isBilibiliHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'bilibili.com' || host.endsWith('.bilibili.com')
}

function isBilibiliShortHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'b23.tv' || host === 'www.b23.tv'
}

function parseCandidateUrl(value: string): BilibiliDirectInput | null {
  const candidate = value.replace(TRAILING_SHARE_PUNCTUATION, '')
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`

  try {
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null

    if (isBilibiliShortHost(url.hostname)) {
      if (url.port) return null
      url.protocol = 'https:'
      return url.pathname !== '/' ? { kind: 'short-url', url: url.toString() } : null
    }
    if (!isBilibiliHost(url.hostname)) return null

    const match = url.pathname.match(BILIBILI_VIDEO_PATH_PATTERN)
    const bvid = match?.[1] ? normalizeBvid(match[1]) : null
    return bvid ? { kind: 'bvid', bvid } : null
  } catch {
    return null
  }
}

/** Recognize an exact BV id, a trusted Bilibili video URL, or a b23.tv share URL. */
export function parseBilibiliDirectInput(input: string): BilibiliDirectInput | null {
  const trimmed = input.trim()
  const bvid = normalizeBvid(trimmed)
  if (bvid) return { kind: 'bvid', bvid }

  const candidates = trimmed.match(URL_IN_TEXT_PATTERN) ?? []
  for (const candidate of candidates) {
    const parsed = parseCandidateUrl(candidate)
    if (parsed) return parsed
  }
  return null
}

/** Expand only b23.tv redirects and return the BV id from their Bilibili destination. */
export async function resolveBilibiliVideoId(input: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const parsed = parseBilibiliDirectInput(input)
  if (!parsed) return null
  if (parsed.kind === 'bvid') return parsed.bvid

  let currentUrl = parsed.url
  for (let redirectCount = 0; redirectCount < MAX_SHORT_LINK_REDIRECTS; redirectCount += 1) {
    const current = new URL(currentUrl)
    if (!isBilibiliShortHost(current.hostname)) return null

    const response = await fetcher(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
    })
    void response.body?.cancel().catch(() => undefined)

    if (response.status < 300 || response.status >= 400) return null
    const location = response.headers.get('location')
    if (!location) return null

    const nextUrl = new URL(location, currentUrl).toString()
    const destination = parseBilibiliDirectInput(nextUrl)
    if (destination?.kind === 'bvid') return destination.bvid
    if (destination?.kind !== 'short-url') return null
    currentUrl = destination.url
  }

  return null
}
