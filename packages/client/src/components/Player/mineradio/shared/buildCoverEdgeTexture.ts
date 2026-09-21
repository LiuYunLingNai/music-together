/**
 * 把封面图打包成一张 256×256 的 RGBA 数据纹理，供粒子着色器取样。
 *
 * 通道布局（与 Mineradio 一致）：
 *   R = depth   径向居中的明度深度
 *   G = edge    Sobel 边缘强度
 *   B = fgMask  前景遮罩（深度与边缘的混合）
 *   A = lum     原始亮度
 *
 * 纯 Canvas2D + 类型化数组实现，不依赖 three.js 或任何全局状态。
 *
 * 注意：跨域图片会在 getImageData 时污染 canvas 并抛错。本项目封面
 * 已通过服务端 `cover-proxy`（返回 Access-Control-Allow-Origin: *）
 * 代理，但仍保留失败路径——调用方会退回纯色表现。
 */

export const EDGE_TEXTURE_SIZE = 256

function boxBlur(src: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const window = radius * 2 + 1

  for (let y = 0; y < size; y++) {
    let sum = 0
    for (let i = -radius; i <= radius; i++) {
      sum += src[y * size + Math.min(size - 1, Math.max(0, i))]
    }
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = sum / window
      const add = src[y * size + Math.min(size - 1, x + radius + 1)]
      const sub = src[y * size + Math.max(0, x - radius)]
      sum += add - sub
    }
  }

  for (let x = 0; x < size; x++) {
    let sum = 0
    for (let i = -radius; i <= radius; i++) {
      sum += tmp[Math.min(size - 1, Math.max(0, i)) * size + x]
    }
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum / window
      const add = tmp[Math.min(size - 1, y + radius + 1) * size + x]
      const sub = tmp[Math.max(0, y - radius) * size + x]
      sum += add - sub
    }
  }

  return out
}

/**
 * 构建封面边缘/深度纹理。
 *
 * 输入可以是 HTMLImageElement 或 HTMLCanvasElement。失败时返回 null，
 * 由调用方回退到无纹理的纯色粒子表现。
 */
export function buildCoverEdgeTexture(source: CanvasImageSource): HTMLCanvasElement | null {
  try {
    const size = EDGE_TEXTURE_SIZE
    const work = document.createElement('canvas')
    work.width = size
    work.height = size
    const wctx = work.getContext('2d', { willReadFrequently: true })
    if (!wctx) return null

    wctx.drawImage(source, 0, 0, size, size)
    const image = wctx.getImageData(0, 0, size, size)
    const pixels = image.data

    const lum = new Float32Array(size * size)
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) / 255
    }

    const blurred = boxBlur(lum, size, 4)

    const edge = new Float32Array(size * size)
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x
        const tl = blurred[i - size - 1], t = blurred[i - size], tr = blurred[i - size + 1]
        const l = blurred[i - 1], r = blurred[i + 1]
        const bl = blurred[i + size - 1], b = blurred[i + size], br = blurred[i + size + 1]
        const gx = tl + 2 * l + bl - (tr + 2 * r + br)
        const gy = tl + 2 * t + tr - (bl + 2 * b + br)
        edge[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 1.4)
      }
    }

    const out = wctx.createImageData(size, size)
    const data = out.data

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x
        // ★ 严格对照上游 `15-ripples-cover-depth.js:155-170`：
        //   归一化到 [-1,1] 后取 `rr = sqrt(cx²+cy²)`，**不夹取、也不做
        //   额外的对比度重映射**。此前本项目额外套了一层
        //   `0.5 + (raw-0.5)*1.28`，并把 rr 按 maxR 压缩、夹到 1，
        //   导致边界处 fgMask 系统性偏高 → 外圈被 `bgMul` 压暗更多 →
        //   静态下边缘参差。
        const cx = (x / (size - 1) - 0.5) * 2.0
        const cy = (y / (size - 1) - 0.5) * 2.0
        const rr = Math.sqrt(cx * cx + cy * cy)
        const centerBias = 1.0 - Math.min(1, rr * 0.75)
        const depth = Math.min(1, blurred[i] * 0.45 + centerBias * 0.55)

        const e = edge[i]
        const fg = Math.min(1, depth * 0.6 + e * 0.5)

        const p = i * 4
        data[p] = Math.round(depth * 255)
        data[p + 1] = Math.round(e * 255)
        data[p + 2] = Math.round(fg * 255)
        data[p + 3] = Math.round(lum[i] * 255)
      }
    }

    wctx.putImageData(out, 0, 0)
    return work
  } catch {
    // 跨域污染或绘图失败：交给调用方降级。
    return null
  }
}

/**
 * 提取封面主色，用于舞台环境光与粒子基色。
 * 取样 5 个点取平均，比全图平均更稳定（避免大片背景色主导）。
 */
export function sampleCoverAccent(source: CanvasImageSource): string | null {
  try {
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null

    ctx.drawImage(source, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)

    const points: Array<[number, number]> = [
      [0.5, 0.5],
      [0.22, 0.22],
      [0.78, 0.78],
      [0.22, 0.78],
      [0.78, 0.22],
    ]

    let r = 0, g = 0, b = 0
    for (const [px, py] of points) {
      const x = Math.min(size - 1, Math.round(px * size))
      const y = Math.min(size - 1, Math.round(py * size))
      const p = (y * size + x) * 4
      r += data[p]
      g += data[p + 1]
      b += data[p + 2]
    }

    r = Math.round(r / points.length)
    g = Math.round(g / points.length)
    b = Math.round(b / points.length)

    // 过暗/过灰的取样对舞台没有帮助，回退到默认冷色。
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 40 || max - min < 12) return null

    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return null
  }
}
