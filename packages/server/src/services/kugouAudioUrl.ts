const KUGOU_CONCEPT_HTTP_CDN_HOSTS = new Set([
  'fs.youthandroid.kugou.com',
  'fs.youthandroid2.kugou.com',
])

/** Concept Edition audio must remain behind the server proxy in browsers. */
export function isKugouConceptAudioUrl(value: string): boolean {
  try {
    return KUGOU_CONCEPT_HTTP_CDN_HOSTS.has(new URL(value).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** QMC2 tracker resources use encrypted extensions even if the registry is cold. */
export function isKugouEncryptedAudioUrl(value: string): boolean {
  try {
    return /\.(?:mflac|mgg)$/i.test(new URL(value).pathname)
  } catch {
    return false
  }
}

export function canRedirectKugouAudioDirect(
  value: string,
  kugouForceProxy: boolean,
  requiresServerProxy: boolean,
): boolean {
  return !kugouForceProxy && !requiresServerProxy && !isKugouConceptAudioUrl(value)
}

/**
 * Concept Edition's youthandroid CDN hosts present a certificate for unrelated
 * domains. They serve the same byte-range audio correctly over HTTP, which is
 * safe to expose only through our HTTPS audio proxy.
 */
export function normalizeKugouAudioUrl(value: string): string {
  try {
    const url = new URL(value)
    if (KUGOU_CONCEPT_HTTP_CDN_HOSTS.has(url.hostname.toLowerCase())) {
      url.protocol = 'http:'
      url.port = ''
      return url.toString()
    }
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
      url.port = ''
      return url.toString()
    }
    return value
  } catch {
    return value
  }
}
