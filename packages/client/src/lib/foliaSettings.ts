import { FOLIA_MODES, isFoliaModeId, type FoliaModeId } from './foliaModes'
import { FOLIA_MODE_CONTROLS, getTuningPath, setTuningPath, validateControl } from './foliaTuningSchema'
import { normalizeFoliaBackgroundConfig } from './foliaBackgroundConfig'
import type { VisualizerBackgroundConfig } from '@/components/Player/folia/upstream/components/visualizer/backgrounds/definition'

export const FOLIA_BACKGROUNDS = [
  { id: 'common', label: '通用（封面 / 几何）' },
  { id: 'latent', label: '隐现 Latent' },
  { id: 'monet', label: '莫奈 Monet' },
  { id: 'nomand', label: '漫游 Nomand' },
  { id: 'url', label: '嵌入网页' },
  { id: 'sora', label: 'Sora 星尘' },
  { id: 'solid', label: '纯色' },
] as const

/**
 * 历史背景 id → 现选项回落。宿主自建的「专辑柔焦/几何浮游」是上游
 * common 背景（封面柔焦 + 几何浮游）的缩水重写，已删除：两者语义都由
 * `common` 完整覆盖（带音频响应与图标形状的上游原版）。
 */
const FOLIA_BACKGROUND_FALLBACKS: Record<string, (typeof FOLIA_BACKGROUNDS)[number]['id']> = {
  fluid: 'common',
  geometric: 'common',
}

export interface FoliaSettings {
  lyricMode: FoliaModeId
  background: (typeof FOLIA_BACKGROUNDS)[number]['id']
  backgroundDim: number
  backgroundMotion: boolean
  showProgress: boolean
  alwaysExpand: boolean
  autoHide: boolean
  manualHide: boolean
  barOffset: number
  showTranslation: boolean
  showRomanization: boolean
  fontScale: number
  subtitleScale: number
  backgroundConfig: VisualizerBackgroundConfig
  tunings: Partial<Record<FoliaModeId, Record<string, unknown>>>
  /** 每首随机歌词样式（上游 `randomVisualizerModePerSong`）：换歌时从池里换一种。 */
  randomMode: boolean
  /** 随机池：参与随机的样式，空表示全部内置样式。 */
  randomModePool: FoliaModeId[]
}

export const FOLIA_DEFAULTS: Readonly<FoliaSettings> = {
  lyricMode: 'luminous',
  background: 'latent',
  // 上游没有全局黑遮罩 —— 背景亮度由各背景自身的 opacity（common 0.75 等）决定。
  // 宿主的 `backgroundDim` 是给用户留的额外压暗手段，默认只取轻微 0.15，
  // 接近上游观感；已保存过设置的用户不受影响（normalize 会沿用其保存值）。
  backgroundDim: 0.15,
  backgroundMotion: true,
  showProgress: true,
  alwaysExpand: false,
  autoHide: false,
  manualHide: false,
  barOffset: 32,
  showTranslation: true,
  showRomanization: false,
  fontScale: 1,
  subtitleScale: 1,
  backgroundConfig: {},
  tunings: {},
  randomMode: false,
  // 上游 `normalizeRandomVisualizerModes` 的默认：整份内置样式都在池里。
  randomModePool: FOLIA_MODES.map((mode) => mode.id),
}

/** Validate persisted settings, including malformed JSON and values from older versions. */
export function normalizeFoliaSettings(value: unknown): FoliaSettings {
  const result = { ...FOLIA_DEFAULTS, backgroundConfig: {}, tunings: {} } as FoliaSettings
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const saved = value as Record<string, unknown>
  if (saved.backgroundConfig && typeof saved.backgroundConfig === 'object' && !Array.isArray(saved.backgroundConfig)) {
    result.backgroundConfig = normalizeFoliaBackgroundConfig(saved.backgroundConfig)
  }
  if (saved.tunings && typeof saved.tunings === 'object' && !Array.isArray(saved.tunings)) {
    for (const mode of FOLIA_MODES) {
      const patch = (saved.tunings as Record<string, unknown>)[mode.id]
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) continue
      const clean: Record<string, unknown> = {}
      for (const control of FOLIA_MODE_CONTROLS[mode.id]) {
        const validated = validateControl(control, getTuningPath(patch as Record<string, unknown>, control.key))
        if (validated !== undefined) setTuningPath(clean, control.key, validated)
      }
      result.tunings[mode.id] = clean
    }
  }
  if (typeof saved.lyricMode === 'string' && isFoliaModeId(saved.lyricMode)) {
    result.lyricMode = saved.lyricMode as FoliaSettings['lyricMode']
  }
  if (typeof saved.background === 'string') {
    const fallback = FOLIA_BACKGROUND_FALLBACKS[saved.background]
    if (fallback) {
      result.background = fallback
    } else if (FOLIA_BACKGROUNDS.some(({ id }) => id === saved.background)) {
      result.background = saved.background as FoliaSettings['background']
    }
  }
  if (typeof saved.randomMode === 'boolean') result.randomMode = saved.randomMode
  if (Array.isArray(saved.randomModePool)) {
    // 上游 `normalizeRandomVisualizerModes`：按模式清单顺序过滤，空池回落到全部。
    const selected = new Set(saved.randomModePool.filter((id): id is string => typeof id === 'string'))
    const pool = FOLIA_MODES.map((mode) => mode.id).filter((id) => selected.has(id))
    result.randomModePool = pool.length > 0 ? pool : FOLIA_MODES.map((mode) => mode.id)
  }
  const booleanKeys = [
    'backgroundMotion',
    'showProgress',
    'alwaysExpand',
    'autoHide',
    'manualHide',
    'showTranslation',
    'showRomanization',
  ] as const
  for (const key of booleanKeys) {
    if (typeof saved[key] === 'boolean') result[key] = saved[key]
  }
  const ranges = {
    backgroundDim: [0, 0.85],
    barOffset: [16, 160],
    fontScale: [0.6, 1.8],
    subtitleScale: [0.6, 1.8],
  } as const
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const number = saved[key]
    if (typeof number === 'number' && Number.isFinite(number)) {
      result[key] = Math.min(ranges[key][1], Math.max(ranges[key][0], number))
    }
  }
  return result
}
