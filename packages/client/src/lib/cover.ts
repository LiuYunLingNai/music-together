import { SERVER_URL } from './config'

const PROXY_COVER_HOSTS = new Set([
  'y.gtimg.cn',
  'p1.music.126.net',
  'p2.music.126.net',
  'p3.music.126.net',
  'p4.music.126.net',
  'imgessl.kugou.com',
])

export function isBilibiliCoverUrl(coverUrl: string): boolean {
  try {
    return new URL(coverUrl).hostname.endsWith('.hdslb.com')
  } catch {
    return false
  }
}

/** Route non-Bilibili cover CDNs that reject browser-origin image requests through our cover proxy. */
export function getProxiedCoverUrl(coverUrl: string): string {
  try {
    const { hostname } = new URL(coverUrl)
    if (PROXY_COVER_HOSTS.has(hostname)) {
      return `${SERVER_URL}/api/music/cover-proxy?url=${encodeURIComponent(coverUrl)}`
    }
  } catch {
    // Keep invalid URLs unchanged so the image element's normal error handling applies.
  }
  return coverUrl
}
