import type { FoliaModeId } from '@/lib/foliaModes'
import type { SmartBeatSettings } from './beatFxTypes'
import { isBeatEffectLive, type BeatEffectDef } from './beatEffects'

/**
 * 画面上有哪些拍点效果 —— 上游 `components/visualizer/beatClockTargets.ts` 的宿主版本。
 *
 * 上游从模式与背景的注册表条目里读 `beatEffects`；本仓的注册表是两张纯数据表
 * （`lib/foliaModes` / `foliaTunings`），所以效果声明集中在这里。
 *
 * 只声明**本仓真能提供数据源**的效果：
 *   · 时计的「仿真鼓面」读 htdemucs 的鼓组分离（GPU 模型），浏览器端没有，故不声明；
 *   · 隐现的「潮汐脉动」与「齿轮随拍」上游已退役，同样不声明。
 * 这样设置面板里不会出现按了没反应的开关。
 */
export const FOLIA_MODE_BEAT_EFFECTS: Partial<Record<FoliaModeId, readonly BeatEffectDef[]>> = {
  hanabi: [
    { id: 'hanabi.beatBursts', nameKey: '随拍开花', descKey: '', source: 'beats' },
    { id: 'hanabi.beatPulse', nameKey: '随拍推镜', descKey: '', source: 'beats' },
  ],
  sonnet: [{ id: 'sonnet.lensTear', nameKey: '推镜裂光', descKey: '', source: 'beats' }],
  diorama: [{ id: 'diorama.ripple', nameKey: '随拍涟漪', descKey: '', source: 'beats' }],
}

/** 背景的拍点效果（隐现的潮汐脉动已按上游退役，不再声明）。 */
export const FOLIA_BACKGROUND_BEAT_EFFECTS: readonly BeatEffectDef[] = []

export interface BeatClockSettings {
  smartBeat: SmartBeatSettings
  mode: FoliaModeId
  /** 该模式是否自己画背景（`still` 不画，此时背景的效果不参与）。 */
  modeHasOwnBackground: boolean
  backgroundHasBeats: boolean
}

/** 画面上（模式 + 背景）声明的全部效果。 */
const effectsOnScreen = (settings: BeatClockSettings): readonly BeatEffectDef[] => {
  const own = FOLIA_MODE_BEAT_EFFECTS[settings.mode] ?? []
  if (!settings.modeHasOwnBackground || !settings.backgroundHasBeats) return own
  return [...own, ...FOLIA_BACKGROUND_BEAT_EFFECTS]
}

/** 现在真正在播的效果：智能动感模式开着、未退役、且它自己开着。 */
export const liveBeatEffects = (settings: BeatClockSettings): BeatEffectDef[] =>
  effectsOnScreen(settings).filter((effect) => isBeatEffectLive(settings.smartBeat, effect))

/** 画面上是否效果要读拍点表（决定要不要跑离线拍点分析）。 */
export const visualizerWantsBeats = (settings: BeatClockSettings): boolean =>
  liveBeatEffects(settings).some((effect) => effect.source === 'beats')

/**
 * 按来源取强度（0..2）：拍点表的强度同时作为时钟包络的缩放，
 * 上游每个来源取「画面上第一个读它的效果」。
 */
export const liveBeatEffectStrength = (
  settings: BeatClockSettings,
  source: BeatEffectDef['source'],
  resolve: (id: string) => number,
): number => {
  const effect = liveBeatEffects(settings).find((candidate) => candidate.source === source)
  return effect ? resolve(effect.id) : 0
}
