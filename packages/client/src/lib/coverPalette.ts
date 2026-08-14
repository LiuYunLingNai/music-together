export interface CoverPalette {
  accent: string
  highlight: string
  secondary: string
  border: string
}

interface Hsl {
  h: number
  s: number
  l: number
}

function rgbToHsl(red: number, green: number, blue: number): Hsl {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: lightness }

  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return { h: hue / 6, s: saturation, l: lightness }
}

function hslToRgb({ h, s, l }: Hsl): string {
  if (s === 0) {
    const value = Math.round(l * 255)
    return `${value} ${value} ${value}`
  }

  const hueToRgb = (p: number, q: number, t: number) => {
    let adjusted = t
    if (adjusted < 0) adjusted += 1
    if (adjusted > 1) adjusted -= 1
    if (adjusted < 1 / 6) return p + (q - p) * 6 * adjusted
    if (adjusted < 1 / 2) return q
    if (adjusted < 2 / 3) return p + (q - p) * (2 / 3 - adjusted) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return `${Math.round(hueToRgb(p, q, h + 1 / 3) * 255)} ${Math.round(hueToRgb(p, q, h) * 255)} ${Math.round(hueToRgb(p, q, h - 1 / 3) * 255)}`
}

function adjustLightness(color: Hsl, lightness: number, saturation = color.s): string {
  return hslToRgb({ h: color.h, s: Math.min(1, Math.max(0, saturation)), l: Math.min(0.9, Math.max(0.15, lightness)) })
}

/** Extract a saturated, readable palette from a small canvas sample. */
export function extractCoverPalette(pixels: Uint8ClampedArray): CoverPalette | null {
  let red = 0
  let green = 0
  let blue = 0
  let weightTotal = 0

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0
    if (alpha < 48) continue
    const r = pixels[index] ?? 0
    const g = pixels[index + 1] ?? 0
    const b = pixels[index + 2] ?? 0
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 12) continue
    const saturation = max === 0 ? 0 : (max - min) / max
    const weight = (alpha / 255) * (0.35 + saturation * 1.8) * (0.4 + max / 255)
    red += r * weight
    green += g * weight
    blue += b * weight
    weightTotal += weight
  }

  if (weightTotal === 0) return null
  const base = rgbToHsl(red / weightTotal, green / weightTotal, blue / weightTotal)
  const saturation = Math.max(0.35, Math.min(0.85, base.s * 1.35))
  return {
    accent: adjustLightness(base, Math.max(0.42, Math.min(0.62, base.l)), saturation),
    highlight: adjustLightness(base, 0.78, Math.min(0.9, saturation * 0.8)),
    secondary: adjustLightness({ ...base, h: (base.h + 0.08) % 1 }, 0.58, Math.min(0.75, saturation * 0.9)),
    border: adjustLightness(base, 0.72, Math.min(0.65, saturation * 0.75)),
  }
}
