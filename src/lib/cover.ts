const PROXY_HOSTS = new Set(['y.gtimg.cn', 'imgessl.kugou.com'])

export function getProxiedCoverUrl(serverUrl: string, coverUrl: string): string {
  try {
    const url = new URL(coverUrl)
    if (PROXY_HOSTS.has(url.hostname.toLowerCase())) return `${serverUrl}/api/music/cover-proxy?url=${encodeURIComponent(coverUrl)}`
  } catch {
    // Leave invalid or local URLs unchanged for the image fallback path.
  }
  return coverUrl
}
