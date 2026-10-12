import { FOLIA_MODES, isFoliaModeId, type FoliaModeId } from './foliaModes'
import { FOLIA_MODE_CONTROLS, validateControl } from './foliaTuningSchema'
import { normalizeFoliaBackgroundConfig } from './foliaBackgroundConfig'
import type { VisualizerBackgroundConfig } from '@/components/Player/folia/upstream/components/visualizer/backgrounds/definition'

export const FOLIA_BACKGROUNDS = [
  { id: 'common', label: '通用（封面 / 几何）' },
  { id: 'latent', label: '隐现 Latent' },
  { id: 'monet', label: '莫奈 Monet' },
  { id: 'nomand', label: '漫游 Nomand' },
  { id: 'url', label: '嵌入网页' },
  { id: 'fluid', label: '专辑柔焦' },
  { id: 'geometric', label: '几何浮游' },
  { id: 'sora', label: 'Sora 星尘' },
  { id: 'solid', label: '纯色' },
] as const

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
}

export const FOLIA_DEFAULTS: Readonly<FoliaSettings> = {
  lyricMode: 'luminous',
  background: 'latent',
  backgroundDim: 0.35,
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
        const validated = validateControl(control, (patch as Record<string, unknown>)[control.key])
        if (validated !== undefined) clean[control.key] = validated
      }
      result.tunings[mode.id] = clean
    }
  }
  if (typeof saved.lyricMode === 'string' && isFoliaModeId(saved.lyricMode)) {
    result.lyricMode = saved.lyricMode as FoliaSettings['lyricMode']
  }
  if (FOLIA_BACKGROUNDS.some(({ id }) => id === saved.background)) {
    result.background = saved.background as FoliaSettings['background']
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
