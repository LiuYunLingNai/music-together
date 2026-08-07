import { LRUCache } from 'lru-cache'

const proxyRequiredAudio = new LRUCache<string, true>({ max: 500, ttl: 2 * 60 * 60 * 1000 })

/** Remember Concept Edition URLs whose bytes must continue through the server. */
export function registerKugouProxyRequiredAudio(url: string): void {
  proxyRequiredAudio.set(url, true)
}

export function isKugouProxyRequiredAudio(url: string): boolean {
  return proxyRequiredAudio.has(url)
}
