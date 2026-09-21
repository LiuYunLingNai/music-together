import { getProxiedCoverUrl } from '@/lib/cover'
import { buildCoverEdgeTexture, sampleCoverAccent } from './buildCoverEdgeTexture'

/**
 * 封面资源加载与纹理缓存。
 *
 * 职责：
 * - 按封面 URL 缓存已解码的图片与派生的数据纹理，切歌不重复解码
 * - 在舞台卸载时释放缓存，避免长时间运行的内存增长
 *
 * 本模块不直接创建 three.js 纹理对象，只产出可供 shader 消费的
 * canvas / HTMLImageElement，由渲染层决定何时上传 GPU。
 */

export interface CoverAssets {
  /** 原始封面图，可直接作为 three.js 纹理源 */
  image: HTMLImageElement
  /** 打包了 depth/edge/fgMask/lum 的数据纹理，失败时为 null */
  edge: HTMLCanvasElement | null
  /** 封面主色（十六进制），取不到时为 null */
  accent: string | null
}

const cache = new Map<string, Promise<CoverAssets | null>>()
/** 已成功加载的资源，供同步读取。 */
const resolved = new Map<string, CoverAssets>()
const MAX_CACHE = 12

/**
 * 加载封面并派生纹理。相同 URL 复用同一 Promise，避免并发重复解码。
 *
 * 永远不会 reject：失败返回 null，调用方退回无封面表现。
 */
export function loadCoverAssets(coverUrl: string | undefined | null): Promise<CoverAssets | null> {
  if (!coverUrl) return Promise.resolve(null)

  const proxied = getProxiedCoverUrl(coverUrl)
  const cached = cache.get(proxied)
  if (cached) return cached

  const promise = new Promise<CoverAssets | null>((resolve) => {
    const image = new Image()
    // 允许 canvas 读取像素；服务端 cover-proxy 已返回 ACAO: *。
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'

    image.onload = () => {
      // 纹理派生是 CPU 侧同步计算（256×256 高斯+Sobel），
      // 放到下一帧避免阻塞图片解码回调所在的任务。
      requestAnimationFrame(() => {
        const assets: CoverAssets = {
          image,
          edge: buildCoverEdgeTexture(image),
          accent: sampleCoverAccent(image),
        }
        resolved.set(proxied, assets)
        resolve(assets)
      })
    }

    image.onerror = () => resolve(null)
    image.src = proxied
  })

  cache.set(proxied, promise)

  // 简单的 LRU 上限，防止长时间连续切歌无限增长。
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }

  return promise
}

/**
 * 同步读取已缓存的封面资源（仅在已加载完成时可用）。
 *
 * 命中时返回 Promise 已 resolve 的资源；未加载或失败返回 null。
 * 供渲染循环在切歌瞬间取用上一张封面，避免舞台闪黑。
 */
export function peekResolvedCoverAssets(coverUrl: string | undefined | null): CoverAssets | null {
  if (!coverUrl) return null
  const entry = resolved.get(getProxiedCoverUrl(coverUrl))
  return entry ?? null
}

/** 清空封面缓存。舞台卸载时调用。 */
export function clearCoverCache(): void {
  cache.clear()
  resolved.clear()
}
