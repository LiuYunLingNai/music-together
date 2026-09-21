/**
 * 封面调色板。
 *
 * 参照 Mineradio 的 `07-lyrics-palette-text-utils.js` 与
 * OpenMusic 的 `coverColorMix`：从封面提取一组语义色，
 * 让歌词与粒子的配色跟随封面，而不是写死。
 *
 * 输出 5 个语义槽位：
 *   primary    主色（正文高亮）
 *   secondary  辅色（上下文行）
 *   highlight  强调色（已唱到的字）
 *   shadow     投影色
 *   glow       辉光色
 */

export interface CoverPalette {
  primary: string
  secondary: string
  highlight: string
  shadow: string
  glow: string
}

/** 默认冷色调，取不到封面时使用。 */
export const DEFAULT_PALETTE: CoverPalette = {
  primary: '#e8f4ff',
  secondary: '#9db8cf',
  highlight: '#ffffff',
  shadow: 'rgba(2,8,12,0.42)',
  glow: 'rgba(143,233,255,0.34)',
}

interface Rgb {
  r: number
  g: number
  b: number
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function toRgba({ r, g, b }: Rgb, alpha: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${alpha})`
}

/** 提升亮度到至少 `min`，保证文字在深色背景上可读。 */
function lift({ r, g, b }: Rgb, min: number, max = 255): Rgb {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  if (lum >= min) {
    // 已经足够亮，只做上限裁剪
    const scale = Math.min(1, max / Math.max(r, g, b, 1))
    return { r: r * scale, g: g * scale, b: b * scale }
  }
  const factor = min / Math.max(1, lum)
  return { r: r * factor, g: g * factor, b: b * factor }
}

/** 降低饱和度，用于上下文行，避免与主行抢视觉。 */
function desaturate(color: Rgb, amount: number): Rgb {
  const gray = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
  return {
    r: color.r + (gray - color.r) * amount,
    g: color.g + (gray - color.g) * amount,
    b: color.b + (gray - color.b) * amount,
  }
}

/**
 * 从封面图片提取调色板。
 *
 * 失败（跨域污染等）时返回默认调色板，绝不抛错。
 */
export function extractCoverPalette(image: CanvasImageSource): CoverPalette {
  try {
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return DEFAULT_PALETTE

    ctx.drawImage(image, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)

    // 统计主色：跳过接近纯黑/纯白与低饱和的像素
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    let brightR = 0
    let brightG = 0
    let brightB = 0
    let brightCount = 0

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) continue
      const pr = data[i]
      const pg = data[i + 1]
      const pb = data[i + 2]
      const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb

      // 主色取样：中等亮度，避免被大面积黑/白主导
      if (lum > 24 && lum < 232) {
        r += pr
        g += pg
        b += pb
        count++
      }
      // 高光取样：偏亮区域，用于"已唱到"的字色
      if (lum > 150) {
        brightR += pr
        brightG += pg
        brightB += pb
        brightCount++
      }
    }

    if (count === 0) return DEFAULT_PALETTE

    const mean: Rgb = { r: r / count, g: g / count, b: b / count }
    const bright: Rgb =
      brightCount > 0
        ? { r: brightR / brightCount, g: brightG / brightCount, b: brightB / brightCount }
        : mean

    // 正文与高亮必须够亮才能在深色舞台上可读
    const primary = lift(mean, 190)
    const highlight = lift(bright, 215)
    const secondary = desaturate(lift(mean, 150), 0.25)

    return {
      primary: toHex(primary),
      secondary: toHex(secondary),
      highlight: toHex(highlight),
      shadow: 'rgba(2,8,12,0.42)',
      glow: toRgba(lift(mean, 170), 0.34),
    }
  } catch {
    return DEFAULT_PALETTE
  }
}
