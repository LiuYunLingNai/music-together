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
import { normalizeLyricRenderOverride } from '../upstream/utils/lyricRenderQuality'
import { normalizeMachiTuning } from '../upstream/components/visualizer/machi/machiTuning'
import { DEFAULT_MACHI_TUNING } from '../upstream/components/visualizer/machi/types'
import { normalizeNebbiaTuning } from '../upstream/components/visualizer/nebbia/nebbiaTuning'
import { DEFAULT_NEBBIA_TUNING } from '../upstream/components/visualizer/nebbia/types'
import { normalizeTemperaTuning } from '../upstream/components/visualizer/tempera/temperaTuning'

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
  hanabi: defaults.DEFAULT_HANABI_TUNING,
  machi: DEFAULT_MACHI_TUNING,
  nebbia: DEFAULT_NEBBIA_TUNING,
} as const

/** Saved patches cannot replace a tuning object or introduce invalid primitive types. */
export function resolveFoliaTuning(mode: FoliaModeId, saved: FoliaSettings['tunings']): Record<string, unknown> {
  if (mode === 'machi') return normalizeMachiTuning(saved.machi) as unknown as Record<string, unknown>
  if (mode === 'nebbia') return normalizeNebbiaTuning(saved.nebbia) as unknown as Record<string, unknown>
  // 凝彩带 `layerImages`（对象数组），声明式控件表表达不了：按上游的归一化读一次。
  if (mode === 'tempera') return normalizeTemperaTuning(saved.tempera) as unknown as Record<string, unknown>
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
  // 分辨率 / 抗锯齿覆盖（#929）是对象，不走声明式控件表，按上游的归一化读一次。
  if ((patch as Record<string, unknown>).render !== undefined) {
    result.render = normalizeLyricRenderOverride((patch as Record<string, unknown>).render)
  }
  return result
}

type FoliaTuningSettings = Pick<FoliaSettings, 'tunings' | 'fontScale'>

/** Each stage owns its resolver; unrelated progress updates reuse the same tuning objects. */
export function createFoliaTuningResolver(settings: FoliaTuningSettings) {
  const resolved = new Map<FoliaModeId, Partial<FoliaSharedProps>>()
  return (mode: FoliaModeId): Partial<FoliaSharedProps> => {
    let props = resolved.get(mode)
    if (!props) {
      props = getFoliaTuningProps(mode, settings)
      resolved.set(mode, props)
    }
    return props
  }
}

export function getFoliaTuningProps(mode: FoliaModeId, settings: FoliaTuningSettings): Partial<FoliaSharedProps> {
  if (mode === 'still') return {}
  const key = mode === 'luminous' ? 'classicTuning' : `${mode}Tuning`
  const tuning = resolveFoliaTuning(mode, settings.tunings)
  // 预览缩略图只传 `tunings`，缺 `fontScale` 时按 1 处理，否则 cadenza 会算出 NaN。
  const fontScale = Number.isFinite(settings.fontScale) ? settings.fontScale : 1
  if (mode === 'cadenza') tuning.fontScale = Number(tuning.fontScale) * fontScale
  return { [key]: tuning }
}
