import type { FoliaModeId } from '@/lib/foliaModes'
import type { SmartBeatSettings } from './beatFxTypes'
import { isBeatEffectLive, type BeatEffectDef } from './beatEffects'
import { useSettingsStore } from '@/stores/settingsStore'
import { normalizeNebbiaTuning } from '@/components/Player/folia/upstream/components/visualizer/nebbia/nebbiaTuning'
import type { VisualizerTuningBundle } from '@/components/Player/folia/upstream/components/visualizer/tuningRegistry'
import { nebbiaBeatEffectOnScreen, nebbiaShowsBackground } from '@/components/Player/folia/upstream/components/visualizer/nebbia/nebbiaBehind'

/**
 * 画面上有哪些拍点效果 —— 上游 `components/visualizer/beatClockTargets.ts` 的宿主版本。
 *
 * 上游从模式与背景的注册表条目里读 `beatEffects`；本仓的注册表是两张纯数据表
 * （`lib/foliaModes` / `foliaTunings`），所以效果声明集中在这里。
 *
 * 只声明**本仓真能提供数据源**的效果：
 *   · 读鼓点 / 分轨的效果由宿主的混音特征（或可选的 htdemucs 分轨）供给，
 *     与拍点效果一样需要先跑一次离线分析；
 *   · 隐现的「潮汐脉动」与「齿轮随拍」上游已退役，同样不声明。
 */
export const FOLIA_MODE_BEAT_EFFECTS: Partial<Record<FoliaModeId, readonly BeatEffectDef[]>> = {
  hanabi: [
    { id: 'hanabi.beatBursts', nameKey: 'options.beatEffect_hanabiBeatBursts', descKey: 'options.beatEffect_hanabiBeatBurstsDesc', source: 'beats' },
    { id: 'hanabi.beatPulse', nameKey: 'options.beatEffect_hanabiBeatPulse', descKey: 'options.beatEffect_hanabiBeatPulseDesc', source: 'beats' },
  ],
  sonnet: [{ id: 'sonnet.lensTear', nameKey: 'options.beatEffect_sonnetLensTear', descKey: 'options.beatEffect_sonnetLensTearDesc', source: 'beats' }],
  // 凝彩的墨染奥行：景深/运镜/字号远近随开关生效；鼓点墨渍读宿主提供的鼓点特征，
  // 没开特征分析时没有鼓点，墨层不出现，其余部分与上游一致。
  tempera: [{ id: 'tempera.inkFlash', nameKey: 'options.beatEffect_temperaInkFlash', descKey: 'options.beatEffect_temperaInkFlashDesc', source: 'drums' }],
  machi: [
    { id: 'machi.neonPulse', nameKey: 'options.beatEffect_machiNeonPulse', descKey: 'options.beatEffect_machiNeonPulseDesc', source: 'beats' },
    { id: 'machi.drumRipple', nameKey: 'options.beatEffect_machiDrumRipple', descKey: 'options.beatEffect_machiDrumRippleDesc', source: 'drums' },
    { id: 'machi.screenFlash', nameKey: 'options.beatEffect_machiScreenFlash', descKey: 'options.beatEffect_machiScreenFlashDesc', source: 'drums' },
  ],
  nebbia: [
    { id: 'nebbia.drizzleRide', nameKey: 'options.beatEffect_nebbiaDrizzleRide', descKey: 'options.beatEffect_nebbiaDrizzleRideDesc', source: 'stems', parts: [
      { key: 'rain', nameKey: 'options.beatEffectPart_nebbiaRain' },
      { key: 'bump', nameKey: 'options.beatEffectPart_nebbiaBump' },
    ] },
    { id: 'nebbia.aquaBeat', nameKey: 'options.beatEffect_nebbiaAquaBeat', descKey: 'options.beatEffect_nebbiaAquaBeatDesc', source: 'beats', parts: [
      { key: 'jelly', nameKey: 'options.beatEffectPart_nebbiaJelly' },
      { key: 'weed', nameKey: 'options.beatEffectPart_nebbiaWeed' },
      { key: 'bubble', nameKey: 'options.beatEffectPart_nebbiaBubble' },
      { key: 'spot', nameKey: 'options.beatEffectPart_nebbiaSpot' },
    ] },
  ],
  diorama: [{ id: 'diorama.ripple', nameKey: 'options.beatEffect_dioramaRipple', descKey: 'options.beatEffect_dioramaRippleDesc', source: 'beats' }],
  // 时计的仿真鼓面读 htdemucs 分离（浏览器端没有，面板会显示「缺少模型」）；与上游一样列出。
  pendolo: [{ id: 'pendolo.drumhead', nameKey: 'options.beatEffect_pendoloDrumhead', descKey: 'options.beatEffect_pendoloDrumheadDesc', source: 'drums' }],
}

/** 背景的拍点效果（隐现的潮汐脉动已按上游退役，不再声明）。 */
export const FOLIA_BACKGROUND_BEAT_EFFECTS: readonly BeatEffectDef[] = []

export interface BeatClockSettings {
  smartBeat: SmartBeatSettings
  mode: FoliaModeId
  /** 该模式的调参包（上游 `collectVisualizerTunings` 的同形数据）。 */
  tunings?: VisualizerTuningBundle
  /** 该模式是否自己画背景（`still` / `machi` 不画，此时背景的效果不参与）。 */
  modeHasOwnBackground: boolean
  backgroundHasBeats: boolean
  /** 播放页透明时不画任何背景；本仓暂无该设置，留作上游同形的接口。 */
  pageTransparent?: boolean
}

const currentTunings = (settings: BeatClockSettings): VisualizerTuningBundle =>
  settings.tunings ?? { nebbia: normalizeNebbiaTuning(useSettingsStore.getState().foliaSettings.tunings.nebbia) }

/**
 * 背景层是否真的画在模式下面：模式自己画背景（`still` / `machi`）、或播放页透明时都不画；
 * 雾笺选了共用背景时也不叠背景层。
 */
export const backgroundOnScreen = (settings: BeatClockSettings): boolean => {
  if (settings.modeHasOwnBackground || settings.pageTransparent) return false
  if (settings.mode !== 'nebbia') return true
  return nebbiaShowsBackground(currentTunings(settings))
}

/** 画面上（模式 + 背景）声明的全部效果。 */
const effectsOnScreen = (settings: BeatClockSettings): readonly BeatEffectDef[] => {
  let own = FOLIA_MODE_BEAT_EFFECTS[settings.mode] ?? []
  if (settings.mode === 'nebbia') {
    const tunings = currentTunings(settings)
    own = own.filter(effect => nebbiaBeatEffectOnScreen(effect.id, tunings))
  }
  if (!backgroundOnScreen(settings) || !settings.backgroundHasBeats) return own
  return [...own, ...FOLIA_BACKGROUND_BEAT_EFFECTS]
}

/** 现在真正在播的效果：智能动感模式开着、未退役、且它自己开着。 */
export const liveBeatEffects = (settings: BeatClockSettings): BeatEffectDef[] =>
  effectsOnScreen(settings).filter((effect) => isBeatEffectLive(settings.smartBeat, effect))

/** 画面上是否效果要读拍点表（决定要不要跑离线拍点分析）。 */
export const visualizerWantsBeats = (settings: BeatClockSettings): boolean =>
  liveBeatEffects(settings).some((effect) => effect.source === 'beats')

/**
 * 画面上是否效果要读鼓点 / 分轨特征。只开这类效果（例如凝彩墨渍、时计鼓面）时
 * 同样要跑一次分析，否则特征永远不会产出，效果会一直是空的。
 */
export const visualizerWantsFeatures = (settings: BeatClockSettings): boolean =>
  liveBeatEffects(settings).some((effect) => effect.source === 'drums' || effect.source === 'stems')

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
