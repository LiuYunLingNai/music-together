export interface StagePalette {
  colors: string[]
  accent: string
}

type Bucket = { count: number; r: number; g: number; b: number }
type RGB = [number, number, number]

const FALLBACK_DARK: RGB[] = [[18, 26, 42], [44, 38, 72], [20, 62, 68], [72, 34, 48]]
const FALLBACK_LIGHT: RGB[] = [[205, 218, 231], [224, 207, 228], [196, 228, 222], [231, 211, 204]]

function rgbToHsl([red, green, blue]: RGB): [number, number, number] {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / delta + 2) / 6
      : ((r - g) / delta + 4) / 6
  return [hue, saturation, lightness]
}

function hslToRgb([hue, saturation, lightness]: [number, number, number]): RGB {
  if (saturation === 0) {
    const value = Math.round(lightness * 255)
    return [value, value, value]
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (offset: number) => {
    let value = hue + offset
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
  }
  return [Math.round(channel(1 / 3) * 255), Math.round(channel(0) * 255), Math.round(channel(-1 / 3) * 255)]
}

function normalize(rgb: RGB, light: boolean): RGB {
  let [hue, saturation, lightness] = rgbToHsl(rgb)
  if (saturation < 0.08) hue = 0.6
  saturation = Math.min(0.78, Math.max(0.34, saturation))
  lightness = light ? Math.min(0.84, Math.max(0.68, lightness)) : Math.min(0.4, Math.max(0.18, lightness))
  return hslToRgb([hue, saturation, lightness])
}

const distance = (left: RGB, right: RGB) => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
const css = ([r, g, b]: RGB) => `rgb(${r}, ${g}, ${b})`

export function extractStagePalette(pixels: Uint8ClampedArray, light = false): StagePalette {
  const buckets = new Map<number, Bucket>()
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count += 1
    bucket.r += r
    bucket.g += g
    bucket.b += b
    buckets.set(key, bucket)
  }

  const candidates = [...buckets.values()]
    .map((bucket) => {
      const rgb: RGB = [Math.round(bucket.r / bucket.count), Math.round(bucket.g / bucket.count), Math.round(bucket.b / bucket.count)]
      const [, saturation] = rgbToHsl(rgb)
      return { rgb, score: bucket.count * (0.4 + saturation) }
    })
    .sort((left, right) => right.score - left.score)

  const selected: RGB[] = []
  for (const candidate of candidates) {
    if (selected.every((color) => distance(color, candidate.rgb) >= 48)) selected.push(candidate.rgb)
    if (selected.length === 4) break
  }
  const fallback = light ? FALLBACK_LIGHT : FALLBACK_DARK
  while (selected.length < 4) selected.push(fallback[selected.length])
  const colors = selected.map((color) => normalize(color, light))
  const accent = hslToRgb([rgbToHsl(selected[0])[0], 0.72, light ? 0.38 : 0.68])
  return { colors: colors.map(css), accent: css(accent) }
}
