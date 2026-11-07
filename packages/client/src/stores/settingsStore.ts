import { create } from 'zustand'
import type { LyricLineRule } from '@/lib/lyrics/lyricLineRules'
import { FOLIA_DEFAULTS, normalizeFoliaSettings, type FoliaSettings } from '@/lib/foliaSettings'
import { resolveSmartBeatSettings, type SmartBeatPatch } from '@/services/beatFx/smartBeatSettings'
import { DEFAULT_SMART_BEAT_SETTINGS, type SmartBeatSettings } from '@/services/beatFx/beatFxTypes'
import {
  storage,
  SETTING_DEFAULTS,
  type LyricDisplaySetting,
  type LyricMotionSetting,
  type LyricPreferredSource,
  type LyricRendererSetting,
  type LyricTranslationSetting,
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
  ResettableFields<'syncPacketIntervalSeconds', number> &
  ResettableFields<'ttmlEnabled', boolean> &
  ResettableFields<'ttmlDbUrl', string> &
  ResettableFields<'lyricPreferredSource', LyricPreferredSource> &
  ResettableFields<'lyricAlignAnchor', 'top' | 'center' | 'bottom'> &
  ResettableFields<'lyricAlignPosition', number> &
  ResettableFields<'lyricEnableSpring', boolean> &
  ResettableFields<'lyricEnableBlur', boolean> &
  ResettableFields<'lyricEnableScale', boolean> &
  ResettableFields<'lyricHidePassedLines', boolean> &
  ResettableFields<'lyricShowBottomLine', boolean> &
  ResettableFields<'lyricMaskObsceneWordsMode', '' | 'full-mask' | 'partial-mask'> &
  ResettableFields<'lyricMaskObsceneWordChar', string> &
  ResettableFields<'lyricWordFadeWidth', number> &
  ResettableFields<'lyricFontWeight', number> &
  ResettableFields<'lyricFontSize', number> &
  ResettableFields<'lyricTranslationFontSize', number> &
  ResettableFields<'lyricRomanFontSize', number> &
  ResettableFields<'lyricLineRules', LyricLineRule[]> & {
    lyricOffsets: Record<string, number>
    setLyricOffset: (key: string, offsetMs: number) => void
    clearLyricOffset: (key: string) => void
  } & ResettableFields<'bgFps', number> &
  ResettableFields<'bgFlowSpeed', number> &
  ResettableFields<'bgRenderScale', number> &
  ResettableFields<'visualStage', VisualStageSetting> &
  ResettableFields<'visualQuality', VisualQualitySetting> &
  ResettableFields<'visualBloom', boolean> &
  ResettableFields<'visualEdge', boolean> &
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
  ): Record<string, unknown> {
    const defaultValue = SETTING_DEFAULTS[key]
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
    ...resettable('lyricAlignAnchor', storage.getLyricAlignAnchor, storage.setLyricAlignAnchor),
    ...resettable('lyricAlignPosition', storage.getLyricAlignPosition, storage.setLyricAlignPosition),
    ...resettable('lyricEnableSpring', storage.getLyricEnableSpring, storage.setLyricEnableSpring),
    ...resettable('lyricEnableBlur', storage.getLyricEnableBlur, storage.setLyricEnableBlur),
    ...resettable('lyricEnableScale', storage.getLyricEnableScale, storage.setLyricEnableScale),
    ...resettable('lyricHidePassedLines', storage.getLyricHidePassedLines, storage.setLyricHidePassedLines),
    ...resettable('lyricShowBottomLine', storage.getLyricShowBottomLine, storage.setLyricShowBottomLine),
    ...resettable(
      'lyricMaskObsceneWordsMode',
      storage.getLyricMaskObsceneWordsMode,
      storage.setLyricMaskObsceneWordsMode,
    ),
    ...resettable('lyricMaskObsceneWordChar', storage.getLyricMaskObsceneWordChar, storage.setLyricMaskObsceneWordChar),
    ...resettable('lyricWordFadeWidth', storage.getLyricWordFadeWidth, storage.setLyricWordFadeWidth),
    ...resettable('lyricFontWeight', storage.getLyricFontWeight, storage.setLyricFontWeight),
    ...resettable('lyricFontSize', storage.getLyricFontSize, storage.setLyricFontSize),
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
    ...resettable('bgFps', storage.getBgFps, storage.setBgFps),
    ...resettable('bgFlowSpeed', storage.getBgFlowSpeed, storage.setBgFlowSpeed),
    ...resettable('bgRenderScale', storage.getBgRenderScale, storage.setBgRenderScale),
    ...resettable('visualStage', storage.getVisualStage, storage.setVisualStage),
    ...resettable('visualQuality', storage.getVisualQuality, storage.setVisualQuality),
    ...resettable('visualBloom', storage.getVisualBloom, storage.setVisualBloom),
    ...resettable('visualEdge', storage.getVisualEdge, storage.setVisualEdge),
    ...resettable('lyricRenderer', storage.getLyricRenderer, storage.setLyricRenderer),
    ...resettable('lyricMotion', storage.getLyricMotion, storage.setLyricMotion),
    ...resettable('lyricDisplayMode3d', storage.getLyricDisplayMode3d, storage.setLyricDisplayMode3d),
    ...resettable('lyricCustomLineCount', storage.getLyricCustomLineCount, storage.setLyricCustomLineCount),
    ...resettable('lyricTranslationMode3d', storage.getLyricTranslationMode3d, storage.setLyricTranslationMode3d),
  } as SettingsStore
})
