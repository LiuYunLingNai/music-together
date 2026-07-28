import { SERVER_URL } from './config'

const PROXY_COVER_HOSTS = new Set(['y.gtimg.cn', 'imgessl.kugou.com'])

/** Route upstream cover CDNs that reject browser-origin image requests through our cover proxy. */
export function getProxiedCoverUrl(coverUrl: string): string {
  try {
    const { hostname } = new URL(coverUrl)
    if (PROXY_COVER_HOSTS.has(hostname) || hostname.endsWith('.hdslb.com')) {
      return `${SERVER_URL}/api/music/cover-proxy?url=${encodeURIComponent(coverUrl)}`
    }
  } catch {
    // Keep invalid URLs unchanged so the image element's normal error handling applies.
  }
  return coverUrl
}
