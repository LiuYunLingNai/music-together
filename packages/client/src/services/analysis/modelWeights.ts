import { SERVER_URL } from '@/lib/config'

/**
 * 分析模型权重的下载与缓存（beat_this / htdemucs 共用）。
 *
 * 权重由服务端静态托管（默认 `${SERVER_URL}/models`，可用 `VITE_MODEL_BASE_URL`
 * 指向 CDN），首次下载后写入 Cache Storage，之后命中缓存不再走网络。
 */

const MODEL_CACHE = 'mt-analysis-models'

export const modelBaseUrl = (fileName: string): string => {
  const configured = (import.meta.env as Record<string, string | undefined>).VITE_MODEL_BASE_URL
  return `${(configured?.trim() || `${SERVER_URL}/models`).replace(/\/+$/, '')}/${fileName}`
}

const readCached = async (url: string): Promise<ArrayBuffer | null> => {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(MODEL_CACHE)
    const hit = await cache.match(url)
    return hit ? await hit.arrayBuffer() : null
  } catch {
    return null
  }
}

export const loadModelWeights = async (
  fileName: string,
  fallbackBytes: number,
  onProgress?: (progress: number) => void,
): Promise<ArrayBuffer> => {
  const url = modelBaseUrl(fileName)
  const cached = await readCached(url)
  if (cached) {
    onProgress?.(1)
    return cached
  }
  onProgress?.(0)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`模型权重下载失败：HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || fallbackBytes
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = await response.arrayBuffer()
    onProgress?.(1)
    return bytes
  }
  const parts: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    received += value.byteLength
    onProgress?.(Math.min(1, received / total))
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(MODEL_CACHE)
      await cache.put(url, new Response(bytes))
    }
  } catch {
    // 缓存写不进去不影响本次使用。
  }
  return bytes.buffer
}
