import * as defaults from '../types'
import type { FoliaModeId } from '../registry'
import type { FoliaSettings } from '@/lib/foliaSettings'
import type { FoliaSharedProps } from '../definition'
import {
  FOLIA_MODE_CONTROLS,
  getTuningPath,
  setTuningPath,
  validateControl,
} from '@/lib/foliaTuningSchema'

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
  // 嵌套对象（如 diorama 的 geometryVisibility）需要深一份拷贝，避免共享默认值引用。
  const result = structuredClone(base)
  const patch = saved[mode]
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return result
  for (const control of FOLIA_MODE_CONTROLS[mode]) {
    const fallback = getTuningPath(base, control.key)
    const value = getTuningPath(patch, control.key)
    if (typeof value !== typeof fallback) continue
    const validated = validateControl(control, value)
    if (validated !== undefined) setTuningPath(result, control.key, validated)
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
