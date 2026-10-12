import {
  DEFAULT_LATENT_BACKGROUND_TUNING,
  DEFAULT_MONET_BACKGROUND_TUNING,
  DEFAULT_NOMAND_BACKGROUND_TUNING,
} from '@/components/Player/folia/types'
import type { VisualizerBackgroundConfig } from '@/components/Player/folia/upstream/components/visualizer/backgrounds/definition'
import {
  normalizeUrlBackgroundUrl,
  sanitizeUrlBackgroundList,
} from '@/components/Player/folia/upstream/utils/urlBackground'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const ENUMS: Record<string, readonly string[]> = {
  displayMode: ['dithering', 'mesh', 'both'],
  colorSource: ['cover-theme', 'cover-only'],
  backgroundSource: ['cover-derived', 'uploaded-global'],
  backgroundLayout: ['full-overlay', 'half-pane-gradient'],
  backgroundWashColorMode: ['theme', 'custom'],
  imageSource: ['cover-derived', 'uploaded-global'],
  effect: ['dithering', 'fluted-glass', 'paper-texture', 'halftone-dots', 'lens-distortion'],
  ditheringType: ['2x2', '4x4', '8x8'],
}
const RANGES: Record<string, readonly [number, number]> = {
  backgroundBlurPx: [0, 80],
  backgroundSaturation: [0, 3],
  backgroundHalfPaneOffsetX: [-1000, 1000],
  ditheringSize: [0.5, 8],
  size: [0.5, 8],
  colorSteps: [2, 16],
  flutedGlassSize: [0.1, 10],
  halftoneDotsSize: [0.1, 10],
  ditheringAudioSpeed: [0, 4],
  meshAudioSpeed: [0, 4],
  ditheringSpeed: [0, 2],
  meshSpeed: [0, 2],
}

function preset<T extends object>(defaults: T, saved: unknown): T {
  const result = { ...defaults }
  const target = result as Record<string, unknown>
  for (const [key, value] of Object.entries(record(saved))) {
    const fallback = target[key]
    if (typeof fallback !== typeof value) continue
    if (typeof value === 'boolean') target[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) {
      const [min, max] = RANGES[key] ?? [0, key.toLowerCase().includes('opacity') || key.includes('Grayscale') ? 1 : 4]
      target[key] = Math.max(min, Math.min(max, value))
    } else if (typeof value === 'string' && ENUMS[key]?.includes(value)) target[key] = value
    else if (key === 'backgroundWashCustomColor' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      target[key] = value
  }
  return result
}

/** Local configuration remains valid even after an old or manually edited storage payload. */
export function normalizeFoliaBackgroundConfig(value: unknown): VisualizerBackgroundConfig {
  const saved = record(value)
  const result: VisualizerBackgroundConfig = {}
  if (saved.common) {
    const common = record(saved.common)
    result.common = {
      useCoverColorBg: common.useCoverColorBg === true,
      disableGeometricBackground: common.disableGeometricBackground === true,
      disableVignette: common.disableVignette === true,
      opacity:
        typeof common.opacity === 'number' && Number.isFinite(common.opacity)
          ? Math.max(0, Math.min(1, common.opacity))
          : 0.75,
    }
  }
  if (saved.latent) result.latent = { tuning: preset(DEFAULT_LATENT_BACKGROUND_TUNING, record(saved.latent).tuning) }
  if (saved.monet) result.monet = { tuning: preset(DEFAULT_MONET_BACKGROUND_TUNING, record(saved.monet).tuning) }
  if (saved.nomand) result.nomand = { tuning: preset(DEFAULT_NOMAND_BACKGROUND_TUNING, record(saved.nomand).tuning) }
  const image = record(saved.customImage)
  const imageUrl = normalizeUrlBackgroundUrl(image.url)
  if (imageUrl)
    result.customImage = {
      id: 'custom',
      name: typeof image.name === 'string' ? image.name.slice(0, 100) : '自定义背景',
      url: imageUrl,
    }
  if (saved.url) {
    const url = record(saved.url)
    const items = sanitizeUrlBackgroundList(url.items).slice(0, 20)
    result.url = {
      items,
      selectedId: items.some((item) => item.id === url.selectedId) ? (url.selectedId as string) : null,
    }
  }
  return result
}
