import * as defaults from '../types'
import type { FoliaModeId } from '../registry'
import type { FoliaSettings } from '@/lib/foliaSettings'
import type { FoliaSharedProps } from '../definition'
import { FOLIA_MODE_CONTROLS, validateControl } from '@/lib/foliaTuningSchema'

export const FOLIA_TUNING_DEFAULTS = {
  luminous: defaults.DEFAULT_CLASSIC_TUNING,
  cadenza: defaults.DEFAULT_CADENZA_TUNING,
  partita: defaults.DEFAULT_PARTITA_TUNING,
  fume: defaults.DEFAULT_FUME_TUNING,
  claddagh: defaults.DEFAULT_CLADDAGH_TUNING,
  cappella: defaults.DEFAULT_CAPPELLA_TUNING,
  tilt: defaults.DEFAULT_TILT_TUNING,
  monet: defaults.DEFAULT_MONET_TUNING,
  diorama: defaults.DEFAULT_DIORAMA_TUNING,
  pendolo: defaults.DEFAULT_PENDOLO_TUNING,
  sonnet: defaults.DEFAULT_SONNET_TUNING,
  tempera: defaults.DEFAULT_TEMPERA_TUNING,
  lumiere: defaults.DEFAULT_LUMIERE_TUNING,
} as const

/** Saved patches cannot replace a tuning object or introduce invalid primitive types. */
export function resolveFoliaTuning(mode: FoliaModeId, saved: FoliaSettings['tunings']): Record<string, unknown> {
  const base: Record<string, unknown> = mode === 'still' ? {} : { ...FOLIA_TUNING_DEFAULTS[mode] }
  const result = { ...base }
  const patch = saved[mode]
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return result
  for (const [key, fallback] of Object.entries(base)) {
    const value = patch[key]
    if (typeof value !== typeof fallback) continue
    const control = FOLIA_MODE_CONTROLS[mode].find((item) => item.key === key)
    const validated = control ? validateControl(control, value) : undefined
    if (validated !== undefined) result[key] = validated
  }
  return result
}

export function getFoliaTuningProps(mode: FoliaModeId, settings: FoliaSettings): Partial<FoliaSharedProps> {
  if (mode === 'still') return {}
  const key = mode === 'luminous' ? 'classicTuning' : `${mode}Tuning`
  const tuning = resolveFoliaTuning(mode, settings.tunings)
  if (mode === 'cadenza') tuning.fontScale = Number(tuning.fontScale) * settings.fontScale
  return { [key]: tuning }
}
