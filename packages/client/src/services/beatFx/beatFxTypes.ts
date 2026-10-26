/**
 * 智能动感模式的设置类型（上游 `src/types.ts` 的对应片段）。
 *
 * 放在这里而不是并进 `folia/upstream/types.ts`：这是**宿主**的设置域（与服务端同步、
 * 持久化、设置面板共用），不是某个视觉模式自己的调参。
 */

export type SmartBeatMode = 'off' | 'cached' | 'on'

/**
 * 单个拍点效果自己的设置：是否播放，以及强度（0..2，1 是调好的样子）。
 */
export interface BeatEffectSetting {
  on: boolean
  strength: number
}

/**
 * 智能动感模式：一个开关管所有画拍点的视觉与背景，每个效果另有自己的设置。
 * `mode` 一律经 `smartBeatActive` / `smartBeatMayAnalyse` 读取，不要就地比较。
 */
export interface SmartBeatSettings {
  mode: SmartBeatMode
  /** 按效果 id（`sonnet.lensTear`）索引，只存用户动过的。 */
  effects: Readonly<Record<string, BeatEffectSetting>>
}

export const DEFAULT_SMART_BEAT_SETTINGS: SmartBeatSettings = {
  mode: 'off',
  effects: {},
}
