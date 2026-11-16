import { create } from 'zustand'
import type { LyricLineRule } from '@/lib/lyrics/lyricLineRules'
import { FOLIA_DEFAULTS, normalizeFoliaSettings, type FoliaSettings } from '@/lib/foliaSettings'
import { resolveSmartBeatSettings, type SmartBeatPatch } from '@/services/beatFx/smartBeatSettings'
import { DEFAULT_SMART_BEAT_SETTINGS, type SmartBeatSettings } from '@/services/beatFx/beatFxTypes'
import {
  storage,
  SETTING_DEFAULTS,
  getBgFpsDefault,
  getBgRenderScaleDefault,
  type LyricDisplaySetting,
  type LyricMotionSetting,
  type LyricPreferredSource,
  type LyricRendererSetting,
  type LyricTranslationSetting,
  type BgRendererSetting,
  type VisualQualitySetting,
  type VisualStageSetting,
} from '@/lib/storage'

// 重新导出供 UI 层使用
export { SETTING_DEFAULTS }

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 默认值表的 key 类型 */
type SettingKey = keyof typeof SETTING_DEFAULTS

/** 从默认值表的 key 推导出 value 类型 */
type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K]

/** 每个 resettable key 在 store 中生成的四个字段名 */
type ResettableFields<K extends string, V> = {
  [P in K]: V
} & {
  [P in `${K}Default`]: V
} & {
  [P in `set${Capitalize<K>}`]: (v: V) => void
} & {
  [P in `reset${Capitalize<K>}`]: () => void
}

/** AMLL 歌词控制 —— 经典与 3D 视觉各一套，schema v4 起互不影响 */
type AmllLyricFields<F extends 'classic' | 'mineradio'> = ResettableFields<
  `${F}LyricAlignAnchor`,
  'top' | 'center' | 'bottom'
> &
  ResettableFields<`${F}LyricAlignPosition`, number> &
  ResettableFields<`${F}LyricEnableSpring`, boolean> &
  ResettableFields<`${F}LyricEnableBlur`, boolean> &
  ResettableFields<`${F}LyricEnableScale`, boolean> &
  ResettableFields<`${F}LyricHidePassedLines`, boolean> &
  ResettableFields<`${F}LyricShowBottomLine`, boolean> &
  ResettableFields<`${F}LyricMaskObsceneWordsMode`, '' | 'full-mask' | 'partial-mask'> &
  ResettableFields<`${F}LyricMaskObsceneWordChar`, string> &
  ResettableFields<`${F}LyricWordFadeWidth`, number> &
  ResettableFields<`${F}LyricShowTranslation`, boolean> &
  ResettableFields<`${F}LyricShowRoman`, boolean> &
  ResettableFields<`${F}LyricSwapTransRoman`, boolean> &
  ResettableFields<`${F}LyricFontWeight`, number> &
  ResettableFields<`${F}LyricFontSize`, number>

/** 合并所有 resettable key 的字段为完整 SettingsStore 类型 */
type SettingsStore = {
  foliaSettings: FoliaSettings
  setFoliaSettings: (patch: Partial<FoliaSettings>) => void
  resetFoliaSettings: () => void
  smartBeat: SmartBeatSettings
  setSmartBeat: (patch: SmartBeatPatch) => void
  resetSmartBeat: () => void
} & ResettableFields<'playbackTempoSyncEnabled', boolean> &
  ResettableFields<'playbackHardSeekSyncEnabled', boolean> &
  ResettableFields<'transitionCueEnabled', boolean> &
  ResettableFields<'songHandoffAnimation', boolean> &
  ResettableFields<'classicImmersiveCover', boolean> &
  ResettableFields<'classicLyricAutoAlign', boolean> &
  ResettableFields<'classicControlsFft', boolean> &
  ResettableFields<'dynamicCoverEnabled', boolean> &
  ResettableFields<'showRemainingTime', boolean> &
  ResettableFields<'lyricFontFamily', string> &
  ResettableFields<'lyricLetterSpacing', string> &
  ResettableFields<'syncPacketIntervalSeconds', number> &
  ResettableFields<'ttmlEnabled', boolean> &
  ResettableFields<'ttmlDbUrl', string> &
  ResettableFields<'lyricPreferredSource', LyricPreferredSource> &
  AmllLyricFields<'classic'> &
  AmllLyricFields<'mineradio'> &
  ResettableFields<'foliaLyricFontWeight', number> &
  ResettableFields<'foliaLyricFontSize', number> &
  ResettableFields<'lyricTranslationFontSize', number> &
  ResettableFields<'lyricRomanFontSize', number> &
  ResettableFields<'lyricLineRules', LyricLineRule[]> & {
    lyricOffsets: Record<string, number>
    setLyricOffset: (key: string, offsetMs: number) => void
    clearLyricOffset: (key: string) => void
  } & ResettableFields<'bgFps', number> &
  ResettableFields<'bgFlowSpeed', number> &
  ResettableFields<'bgRenderScale', number> &
  ResettableFields<'bgRenderer', BgRendererSetting> &
  ResettableFields<'bgCssBackground', string> &
  ResettableFields<'visualStage', VisualStageSetting> &
  ResettableFields<'visualQuality', VisualQualitySetting> &
  ResettableFields<'foliaFrameRate', number> &
  ResettableFields<'foliaVisualQuality', VisualQualitySetting> &
  ResettableFields<'visualBloom', boolean> &
  ResettableFields<'visualEdge', boolean> &
  ResettableFields<'stageConsoleAutoFade', boolean> &
  ResettableFields<'lyricRenderer', LyricRendererSetting> &
  ResettableFields<'lyricMotion', LyricMotionSetting> &
  ResettableFields<'lyricDisplayMode3d', LyricDisplaySetting> &
  ResettableFields<'lyricCustomLineCount', number> &
  ResettableFields<'lyricTranslationMode3d', LyricTranslationSetting>

// ---------------------------------------------------------------------------
// Store 实现
// ---------------------------------------------------------------------------

/** 首字母大写 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const useSettingsStore = create<SettingsStore>((set) => {
  /**
   * resettable 工厂：为每个 setting key 生成 4 个 store 字段
   *   key         → 当前值
   *   keyDefault  → 默认值（只读）
   *   setKey      → setter（持久化 + 更新 store）
   *   resetKey    → 恢复默认值
   */
  function resettable<K extends SettingKey>(
    key: K,
    load: () => SettingValue<K>,
    persist: (v: SettingValue<K>) => void,
    /** 设备相关的出厂值（如触屏的背景档位）；缺省用 SETTING_DEFAULTS。 */
    defaultOverride?: SettingValue<K>,
  ): Record<string, unknown> {
    const defaultValue = defaultOverride ?? SETTING_DEFAULTS[key]
    const initial = load()
    const cap = capitalize(key)

    const setValue = (v: SettingValue<K>) => {
      persist(v)
      set({ [key]: v } as Partial<SettingsStore>)
    }

    return {
      [key]: initial,
      [`${key}Default`]: defaultValue,
      [`set${cap}`]: setValue,
      [`reset${cap}`]: () => setValue(defaultValue),
    }
  }

  return {
    foliaSettings: storage.getFoliaSettings(),
    setFoliaSettings: (patch) =>
      set((state) => {
        const foliaSettings = normalizeFoliaSettings({ ...state.foliaSettings, ...patch })
        // 归一化会重建整棵树；把没改动的那部分换回旧引用，下游的 memo / selector 才不会被无谓唤醒
        // （拖动某个模式的调参时，其余 15 个模式的 tuning 与背景配置保持不变）。
        if (!patch.tunings) {
          foliaSettings.tunings = state.foliaSettings.tunings
        } else {
          for (const id of Object.keys(foliaSettings.tunings) as (keyof FoliaSettings['tunings'])[]) {
            if (patch.tunings[id] === state.foliaSettings.tunings[id]) {
              foliaSettings.tunings[id] = state.foliaSettings.tunings[id]
            }
          }
        }
        if (patch.backgroundConfig === undefined) {
          foliaSettings.backgroundConfig = state.foliaSettings.backgroundConfig
        }
        // 调参 / 背景调参 / 字幕底衬透明度（拖动滑条时逐帧）合并落盘；其余设置量小，立即写。
        if (patch.tunings || patch.backgroundConfig || patch.subtitleOverlayOpacity !== undefined) {
          storage.persistFoliaSettings(foliaSettings)
        } else {
          storage.setFoliaSettings(foliaSettings, true)
        }
        return { foliaSettings }
      }),
    resetFoliaSettings: () =>
      set((state) => {
        // Manual visibility is restored only by its dedicated stage button.
        const foliaSettings = { ...FOLIA_DEFAULTS, manualHide: state.foliaSettings.manualHide }
        storage.setFoliaSettings(foliaSettings)
        return { foliaSettings }
      }),
    smartBeat: storage.getSmartBeatSettings(),
    setSmartBeat: (patch) =>
      set((state) => {
        const smartBeat = resolveSmartBeatSettings(patch, state.smartBeat)
        storage.setSmartBeatSettings(smartBeat)
        return { smartBeat }
      }),
    resetSmartBeat: () =>
      set(() => {
        const smartBeat = DEFAULT_SMART_BEAT_SETTINGS
        storage.setSmartBeatSettings(smartBeat)
        return { smartBeat }
      }),
    ...resettable('playbackTempoSyncEnabled', storage.getPlaybackTempoSyncEnabled, storage.setPlaybackTempoSyncEnabled),
    ...resettable('transitionCueEnabled', storage.getTransitionCueEnabled, storage.setTransitionCueEnabled),
    ...resettable('songHandoffAnimation', storage.getSongHandoffAnimation, storage.setSongHandoffAnimation),
    ...resettable('classicImmersiveCover', storage.getClassicImmersiveCover, storage.setClassicImmersiveCover),
    ...resettable('classicLyricAutoAlign', storage.getClassicLyricAutoAlign, storage.setClassicLyricAutoAlign),
    ...resettable('classicControlsFft', storage.getClassicControlsFft, storage.setClassicControlsFft),
    ...resettable('dynamicCoverEnabled', storage.getDynamicCoverEnabled, storage.setDynamicCoverEnabled),
    ...resettable('showRemainingTime', storage.getShowRemainingTime, storage.setShowRemainingTime),
    ...resettable('lyricFontFamily', storage.getLyricFontFamily, storage.setLyricFontFamily),
    ...resettable('lyricLetterSpacing', storage.getLyricLetterSpacing, storage.setLyricLetterSpacing),
    ...resettable(
      'playbackHardSeekSyncEnabled',
      storage.getPlaybackHardSeekSyncEnabled,
      storage.setPlaybackHardSeekSyncEnabled,
    ),
    ...resettable(
      'syncPacketIntervalSeconds',
      storage.getSyncPacketIntervalSeconds,
      storage.setSyncPacketIntervalSeconds,
    ),
    ...resettable('ttmlEnabled', storage.getTtmlEnabled, storage.setTtmlEnabled),
    ...resettable('ttmlDbUrl', storage.getTtmlDbUrl, storage.setTtmlDbUrl),
    ...resettable('lyricPreferredSource', storage.getLyricPreferredSource, storage.setLyricPreferredSource),
    // 经典播放器 — AMLL 歌词
    ...resettable('classicLyricAlignAnchor', storage.getClassicLyricAlignAnchor, storage.setClassicLyricAlignAnchor),
    ...resettable(
      'classicLyricAlignPosition',
      storage.getClassicLyricAlignPosition,
      storage.setClassicLyricAlignPosition,
    ),
    ...resettable('classicLyricEnableSpring', storage.getClassicLyricEnableSpring, storage.setClassicLyricEnableSpring),
    ...resettable('classicLyricEnableBlur', storage.getClassicLyricEnableBlur, storage.setClassicLyricEnableBlur),
    ...resettable('classicLyricEnableScale', storage.getClassicLyricEnableScale, storage.setClassicLyricEnableScale),
    ...resettable(
      'classicLyricHidePassedLines',
      storage.getClassicLyricHidePassedLines,
      storage.setClassicLyricHidePassedLines,
    ),
    ...resettable(
      'classicLyricShowBottomLine',
      storage.getClassicLyricShowBottomLine,
      storage.setClassicLyricShowBottomLine,
    ),
    ...resettable(
      'classicLyricMaskObsceneWordsMode',
      storage.getClassicLyricMaskObsceneWordsMode,
      storage.setClassicLyricMaskObsceneWordsMode,
    ),
    ...resettable(
      'classicLyricMaskObsceneWordChar',
      storage.getClassicLyricMaskObsceneWordChar,
      storage.setClassicLyricMaskObsceneWordChar,
    ),
    ...resettable(
      'classicLyricWordFadeWidth',
      storage.getClassicLyricWordFadeWidth,
      storage.setClassicLyricWordFadeWidth,
    ),
    ...resettable(
      'classicLyricShowTranslation',
      storage.getClassicLyricShowTranslation,
      storage.setClassicLyricShowTranslation,
    ),
    ...resettable('classicLyricShowRoman', storage.getClassicLyricShowRoman, storage.setClassicLyricShowRoman),
    ...resettable(
      'classicLyricSwapTransRoman',
      storage.getClassicLyricSwapTransRoman,
      storage.setClassicLyricSwapTransRoman,
    ),
    ...resettable('classicLyricFontWeight', storage.getClassicLyricFontWeight, storage.setClassicLyricFontWeight),
    ...resettable('classicLyricFontSize', storage.getClassicLyricFontSize, storage.setClassicLyricFontSize),

    // 3D 视觉舞台 — AMLL 歌词
    ...resettable(
      'mineradioLyricAlignAnchor',
      storage.getMineradioLyricAlignAnchor,
      storage.setMineradioLyricAlignAnchor,
    ),
    ...resettable(
      'mineradioLyricAlignPosition',
      storage.getMineradioLyricAlignPosition,
      storage.setMineradioLyricAlignPosition,
    ),
    ...resettable(
      'mineradioLyricEnableSpring',
      storage.getMineradioLyricEnableSpring,
      storage.setMineradioLyricEnableSpring,
    ),
    ...resettable('mineradioLyricEnableBlur', storage.getMineradioLyricEnableBlur, storage.setMineradioLyricEnableBlur),
    ...resettable(
      'mineradioLyricEnableScale',
      storage.getMineradioLyricEnableScale,
      storage.setMineradioLyricEnableScale,
    ),
    ...resettable(
      'mineradioLyricHidePassedLines',
      storage.getMineradioLyricHidePassedLines,
      storage.setMineradioLyricHidePassedLines,
    ),
    ...resettable(
      'mineradioLyricShowBottomLine',
      storage.getMineradioLyricShowBottomLine,
      storage.setMineradioLyricShowBottomLine,
    ),
    ...resettable(
      'mineradioLyricMaskObsceneWordsMode',
      storage.getMineradioLyricMaskObsceneWordsMode,
      storage.setMineradioLyricMaskObsceneWordsMode,
    ),
    ...resettable(
      'mineradioLyricMaskObsceneWordChar',
      storage.getMineradioLyricMaskObsceneWordChar,
      storage.setMineradioLyricMaskObsceneWordChar,
    ),
    ...resettable(
      'mineradioLyricWordFadeWidth',
      storage.getMineradioLyricWordFadeWidth,
      storage.setMineradioLyricWordFadeWidth,
    ),
    ...resettable(
      'mineradioLyricShowTranslation',
      storage.getMineradioLyricShowTranslation,
      storage.setMineradioLyricShowTranslation,
    ),
    ...resettable('mineradioLyricShowRoman', storage.getMineradioLyricShowRoman, storage.setMineradioLyricShowRoman),
    ...resettable(
      'mineradioLyricSwapTransRoman',
      storage.getMineradioLyricSwapTransRoman,
      storage.setMineradioLyricSwapTransRoman,
    ),
    ...resettable('mineradioLyricFontWeight', storage.getMineradioLyricFontWeight, storage.setMineradioLyricFontWeight),
    ...resettable('mineradioLyricFontSize', storage.getMineradioLyricFontSize, storage.setMineradioLyricFontSize),

    // Folia — 字号/粗细与字幕字号
    ...resettable('foliaLyricFontWeight', storage.getFoliaLyricFontWeight, storage.setFoliaLyricFontWeight),
    ...resettable('foliaLyricFontSize', storage.getFoliaLyricFontSize, storage.setFoliaLyricFontSize),
    ...resettable('lyricTranslationFontSize', storage.getLyricTranslationFontSize, storage.setLyricTranslationFontSize),
    ...resettable('lyricRomanFontSize', storage.getLyricRomanFontSize, storage.setLyricRomanFontSize),
    ...resettable('lyricLineRules', storage.getLyricLineRules, storage.setLyricLineRules),
    lyricOffsets: storage.getLyricOffsets(),
    setLyricOffset: (key, offsetMs) => {
      const value = Math.round(Math.max(-10_000, Math.min(10_000, offsetMs)))
      set((state) => {
        const lyricOffsets = { ...state.lyricOffsets }
        if (value === 0) delete lyricOffsets[key]
        else lyricOffsets[key] = value
        storage.setLyricOffsets(lyricOffsets)
        return { lyricOffsets }
      })
    },
    clearLyricOffset: (key) => {
      set((state) => {
        if (!(key in state.lyricOffsets)) return state
        const lyricOffsets = { ...state.lyricOffsets }
        delete lyricOffsets[key]
        storage.setLyricOffsets(lyricOffsets)
        return { lyricOffsets }
      })
    },
    ...resettable('bgFps', storage.getBgFps, storage.setBgFps, getBgFpsDefault()),
    ...resettable('bgFlowSpeed', storage.getBgFlowSpeed, storage.setBgFlowSpeed),
    ...resettable(
      'bgRenderScale',
      storage.getBgRenderScale,
      storage.setBgRenderScale,
      getBgRenderScaleDefault(),
    ),
    ...resettable('bgRenderer', storage.getBgRenderer, storage.setBgRenderer),
    ...resettable('bgCssBackground', storage.getBgCssBackground, storage.setBgCssBackground),
    ...resettable('visualStage', storage.getVisualStage, storage.setVisualStage),
    ...resettable('visualQuality', storage.getVisualQuality, storage.setVisualQuality),
    ...resettable('foliaFrameRate', storage.getFoliaFrameRate, storage.setFoliaFrameRate),
    ...resettable('foliaVisualQuality', storage.getFoliaVisualQuality, storage.setFoliaVisualQuality),
    ...resettable('visualBloom', storage.getVisualBloom, storage.setVisualBloom),
    ...resettable('visualEdge', storage.getVisualEdge, storage.setVisualEdge),
    ...resettable('stageConsoleAutoFade', storage.getStageConsoleAutoFade, storage.setStageConsoleAutoFade),
    ...resettable('lyricRenderer', storage.getLyricRenderer, storage.setLyricRenderer),
    ...resettable('lyricMotion', storage.getLyricMotion, storage.setLyricMotion),
    ...resettable('lyricDisplayMode3d', storage.getLyricDisplayMode3d, storage.setLyricDisplayMode3d),
    ...resettable('lyricCustomLineCount', storage.getLyricCustomLineCount, storage.setLyricCustomLineCount),
    ...resettable('lyricTranslationMode3d', storage.getLyricTranslationMode3d, storage.setLyricTranslationMode3d),
  } as SettingsStore
})
