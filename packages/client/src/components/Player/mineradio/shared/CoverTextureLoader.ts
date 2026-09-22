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

/**
 * 已加载封面的缓存（Promise 复用 + LRU 上限）。
 *
 * ★ 这里**只保留一份**缓存。曾经另有一个 `resolved: Map<string, CoverAssets>`
 *   用于"同步读取已完成的资源"（配 `peekResolvedCoverAssets`），但：
 *     ① 它的唯一读取者 `peekResolvedCoverAssets` **全仓零调用方**（死导出）；
 *     ② 它**只写不清理** —— `MAX_CACHE` 的 LRU 只作用于本 map，`resolved`
 *        会随每个新封面 URL 无界增长（每条 = 解码后的 `HTMLImageElement`
 *        + 256×256 RGBA canvas，约 256KB），长时间连续切歌只增不减。
 *   即"防止内存无限增长"的注释与实际行为相反。删掉后 LRU 才真正生效。
 */
const cache = new Map<string, Promise<CoverAssets | null>>()
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
        resolve(assets)
      })
    }

    image.onerror = () => {
      // ★ 失败必须把缓存项**摘掉**，否则这个 URL 被永久"投毒"：
      //   `cache` 里留着一个已 resolve 成 null 的 Promise，之后所有
      //   `loadCoverAssets(同一 URL)` 都直接命中它并立刻拿到 null ——
      //   哪怕只是瞬时网络抖动/代理超时，这首歌的封面、调色板、
      //   accent 在本会话内**再也不会重试**，只能刷新页面。
      //   摘掉后下一次调用会重新发起请求（失败仍然只降级为"无封面"，
      //   不影响渲染）。
      cache.delete(proxied)
      resolve(null)
    }
    image.src = proxied
  })

  cache.set(proxied, promise)

  // LRU：淘汰最旧的条目，防止长时间连续切歌时无限增长。
  // （现在这是唯一的缓存，因此上限真正生效。）
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }

  return promise
}

/** 清空封面缓存。舞台卸载时调用。 */
export function clearCoverCache(): void {
  cache.clear()
}
