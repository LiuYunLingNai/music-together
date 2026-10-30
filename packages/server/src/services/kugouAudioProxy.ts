import { LRUCache } from 'lru-cache'

const proxyRequiredAudio = new LRUCache<string, true>({ max: 500, ttl: 2 * 60 * 60 * 1000 })

/**
 * Every Kugou audio URL the server has handed to a client. The audio proxy only
 * forwards URLs from this set, so it cannot be used as a general Kugou proxy.
 * Native clients call the proxy without a roomId, so binding to the room's
 * current track alone would break them.
 */
const issuedAudio = new LRUCache<string, true>({ max: 5000, ttl: 6 * 60 * 60 * 1000 })

/** Remember Concept Edition URLs whose bytes must continue through the server. */
export function registerKugouProxyRequiredAudio(url: string): void {
  proxyRequiredAudio.set(url, true)
}

export function isKugouProxyRequiredAudio(url: string): boolean {
  return proxyRequiredAudio.has(url)
}

/** Record a Kugou stream URL resolved by the server so the proxy will accept it. */
export function registerIssuedKugouAudio(url: string): void {
  issuedAudio.set(url, true)
}

export function isIssuedKugouAudio(url: string): boolean {
  return issuedAudio.has(url)
}
