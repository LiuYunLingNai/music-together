/**
 * 分析模型权重的下载与缓存（beat_this / htdemucs 共用）。
 *
 * 权重不进服务端：默认按「加速镜像 → GitHub 官方」直连下载，可用
 * VITE_MODEL_BASE_URL 覆盖为自建 CDN。首次下载后写入浏览器 Cache Storage，
 * 之后命中缓存不再走网络。
 *
 * 下载按 4 MB 的 Range 分块：系统的下载接管器通常只拦截整段大文件，分块请求
 * 不会被接走；单块失败会重试，当前源连不上就换下一个。另外提供本地文件导入，
 * 兜住仍然被接管或网络完全不可用的环境。
 */

const MODEL_CACHE = 'mt-analysis-models'
const CHUNK_BYTES = 4 * 1024 * 1024
const CHUNK_ATTEMPTS = 3
const DEFAULT_MIRRORS = [
  'https://ghp.lyln114514.top/https://github.com/chthollyphile/folia-major/releases/download/models-v1',
  'https://github.com/chthollyphile/folia-major/releases/download/models-v1',
]

const normalizeBase = (base: string): string => base.trim().replace(/\/+$/, '')

export const modelBaseUrl = (fileName: string): string =>
  `${normalizeBase(import.meta.env.VITE_MODEL_BASE_URL || DEFAULT_MIRRORS[0]!)}/${fileName}`

/** Cache Storage 用固定键：镜像切换后仍能命中同一份已校验的权重。 */
export const modelCacheKey = (fileName: string): string => `${normalizeBase(DEFAULT_MIRRORS[0]!)}/${fileName}`

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

const fetchRange = async (url: string, range: string): Promise<Response> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Range: range } })
      // 404/CORS/403 这类确定性失败不必重试，直接换下一个源。
      if (response.ok || response.status === 206) return response
      if (response.status === 416 || response.status >= 500) {
        throw new Error(`模型权重下载失败：HTTP ${response.status}`)
      }
      throw new Error(`模型权重下载失败：HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt < CHUNK_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
      }
    }
  }
  throw lastError
}

/** 某个源失效时从零重新分块，不让两个 CDN 的字节混进同一份权重。 */
const downloadFromMirrors = async (
  fileName: string,
  total: number,
  onProgress?: (progress: number) => void,
): Promise<ArrayBuffer> => {
  const configured = import.meta.env.VITE_MODEL_BASE_URL?.trim()
  const bases = configured ? [normalizeBase(configured)] : [...DEFAULT_MIRRORS]
  let lastError: unknown
  for (const base of bases) {
    try {
      return await downloadChunked(`${base}/${fileName}`, total, onProgress)
    } catch (error) {
      lastError = error
      onProgress?.(0)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型权重下载失败')
}

const downloadChunked = async (
  url: string,
  total: number,
  onProgress?: (progress: number) => void,
): Promise<ArrayBuffer> => {
  let buffer = new Uint8Array(total)
  let filled = 0
  while (filled < total) {
    const response = await fetchRange(url, `bytes=${filled}-${Math.min(filled + CHUNK_BYTES, total) - 1}`)
    // 服务端或中间层不认 Range 时一次返回整份，直接用。
    if (response.status === 200) {
      const whole = await response.arrayBuffer()
      // 中间层常把错误页以 200 返回；长度不对就当场失败，避免把坏数据写进缓存。
      if (whole.byteLength !== total) throw new Error('模型权重下载失败：文件长度不符')
      onProgress?.(1)
      return whole
    }
    if (response.status !== 206) throw new Error(`模型权重下载失败：HTTP ${response.status}`)

    const reported = Number(/bytes\s+\d+-\d+\/(\d+)/.exec(response.headers.get('content-range') ?? '')?.[1])
    if (reported && reported !== total) {
      if (filled > 0) throw new Error('模型权重下载失败：文件长度中途变化')
      // 清单里的字节数是基准；允许服务端纠正，但拒绝离谱的长度，避免超大分配。
      if (reported > total * 2 + CHUNK_BYTES) throw new Error('模型权重下载失败：文件长度异常')
      total = reported
      buffer = new Uint8Array(total)
    }

    const chunk = new Uint8Array(await response.arrayBuffer())
    if (chunk.byteLength !== Math.min(CHUNK_BYTES, total - filled)) {
      throw new Error('模型权重下载失败：分块长度不符')
    }
    buffer.set(chunk, filled)
    filled += chunk.byteLength
    onProgress?.(Math.min(1, filled / total))
  }
  return buffer.buffer
}

export const loadModelWeights = async (
  fileName: string,
  fallbackBytes: number,
  onProgress?: (progress: number) => void,
  expectedSha256?: string,
): Promise<ArrayBuffer> => {
  const cacheKey = modelCacheKey(fileName)
  const cached = await readCached(cacheKey)
  if (cached) {
    // 缓存里的文件也可能被 CDN/磁盘换坏；有哈希就校验，坏了删掉重下。
    if (!expectedSha256 || (await sha256Hex(cached)) === expectedSha256) {
      onProgress?.(1)
      return cached
    }
    try {
      const cache = await caches.open(MODEL_CACHE)
      await cache.delete(cacheKey)
    } catch {
      // 删不掉也不影响本次重新下载。
    }
  }
  onProgress?.(0)
  const bytes = await downloadFromMirrors(fileName, fallbackBytes, onProgress)
  if (expectedSha256 && (await sha256Hex(bytes)) !== expectedSha256) {
    throw new Error('模型权重校验失败：文件内容与清单不一致')
  }
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(MODEL_CACHE)
      await cache.put(cacheKey, new Response(bytes))
    }
  } catch {
    // 缓存写不进去不影响本次使用。
  }
  return bytes
}

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  if (!crypto.subtle) throw new Error('当前页面不是安全上下文，无法校验模型文件')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

/** 从本地文件导入权重：校验大小与 sha256 后写入缓存，供 loadModelWeights 直接命中。 */
export const importModelWeights = async (
  fileName: string,
  expectedBytes: number,
  expectedSha256: string,
  file: File,
): Promise<void> => {
  if (file.size !== expectedBytes) {
    throw new Error(`文件大小不符：${file.size} 字节，应为 ${expectedBytes} 字节`)
  }
  const bytes = await file.arrayBuffer()
  if ((await sha256Hex(bytes)) !== expectedSha256) {
    throw new Error('文件校验失败：不是对应的模型权重')
  }
  if (typeof caches === 'undefined') throw new Error('当前环境不支持模型缓存')
  const cache = await caches.open(MODEL_CACHE)
  await cache.put(modelCacheKey(fileName), new Response(bytes))
}
