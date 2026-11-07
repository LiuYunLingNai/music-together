import {
  AUDIO_EQUALIZER_BANDS,
  AUDIO_EQUALIZER_MAX_GAIN_DB,
  AUDIO_EQUALIZER_MIN_GAIN_DB,
  DEFAULT_AUDIO_EQUALIZER_SETTINGS,
  planAudioSoundPreset,
  resetAudioEqualizerCustomSlot,
  resolveAudioEqualizerSettings,
  writeAudioEqualizerCustomDraft,
  type AudioEqualizerModeId,
  type AudioEqualizerSettings,
} from '@/lib/audioEqualizer'
import { createNeutralAudioEffects, type AudioEffectId } from '@/lib/audioEffects/model'
import { AUDIO_SOUND_PRESETS } from '@/lib/audioEffects/presets'
import type { ReplayGainMode } from '@/services/beatFx/offlineBeatAnalysis/loudness'
import { create } from 'zustand'

export const AUDIO_CROSSFADE_MAX_MS = 8000

export interface AudioSettingsState {
  equalizer: AudioEqualizerSettings
  crossfadeMs: number
  outputDeviceId: string
  replayGainMode: ReplayGainMode
  /** 用混音近似鼓点 / 人声，供 Folia 特效使用；默认关闭。 */
  trackFeaturesEnabled: boolean
  /** 用 beat_this（WebGPU）生成拍点与重音；首次开启需下载 41 MB 权重。 */
  highPrecisionBeats: boolean
  /** 用 htdemucs（WebGPU）真分轨计算鼓点 / 人声；首次开启需下载 92 MB 权重。 */
  highPrecisionStems: boolean
  /** 播放结束前提前解析并缓冲下一首，减少切歌空档。 */
  preloadNextTrack: boolean
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettingsState = {
  equalizer: DEFAULT_AUDIO_EQUALIZER_SETTINGS,
  crossfadeMs: 80,
  outputDeviceId: 'default',
  replayGainMode: 'off',
  trackFeaturesEnabled: false,
  highPrecisionBeats: false,
  highPrecisionStems: false,
  preloadNextTrack: true,
}

const STORAGE_KEY = 'mt-audio-settings'

/** 旧版宿主自拟的五段频段，读取时并入新的十段设置。 */
const LEGACY_EQ_BANDS = [60, 230, 910, 3600, 14000]

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const cloneDefaultEqualizer = (): AudioEqualizerSettings => ({
  ...DEFAULT_AUDIO_EQUALIZER_SETTINGS,
  gains: [...DEFAULT_AUDIO_EQUALIZER_SETTINGS.gains],
  effects: createNeutralAudioEffects(),
  customSlots: DEFAULT_AUDIO_EQUALIZER_SETTINGS.customSlots.map((slot) => ({
    gains: [...slot.gains],
    effects: { ...slot.effects },
  })),
})

const migrateLegacyEqualizer = (legacy: {
  equalizerEnabled?: unknown
  equalizerGains?: unknown
}): AudioEqualizerSettings => {
  const legacyGains = Array.isArray(legacy.equalizerGains) ? legacy.equalizerGains : []
  const gains = AUDIO_EQUALIZER_BANDS.map(() => 0)
  LEGACY_EQ_BANDS.forEach((frequency, legacyIndex) => {
    let nearest = 0
    AUDIO_EQUALIZER_BANDS.forEach((band, index) => {
      if (Math.abs(band.frequency - frequency) < Math.abs(AUDIO_EQUALIZER_BANDS[nearest].frequency - frequency)) {
        nearest = index
      }
    })
    const value = Number(legacyGains[legacyIndex])
    gains[nearest] = Number.isFinite(value) ? clamp(value, AUDIO_EQUALIZER_MIN_GAIN_DB, AUDIO_EQUALIZER_MAX_GAIN_DB) : 0
  })
  const effects = createNeutralAudioEffects()
  return {
    enabled: Boolean(legacy.equalizerEnabled),
    gains,
    preset: 'custom1',
    effects,
    customSlots: [
      { gains: [...gains], effects: { ...effects } },
      { gains: [...AUDIO_SOUND_PRESETS.flat.gains], effects: createNeutralAudioEffects() },
    ],
  }
}

type StoredAudioSettings = Partial<AudioSettingsState> & {
  equalizerEnabled?: unknown
  equalizerGains?: unknown
}

const resolveStored = (value: StoredAudioSettings | null | undefined): AudioSettingsState => {
  const storedCrossfade = Number(value?.crossfadeMs)
  const crossfadeMs = clamp(
    value?.crossfadeMs == null || !Number.isFinite(storedCrossfade)
      ? DEFAULT_AUDIO_SETTINGS.crossfadeMs
      : storedCrossfade,
    0,
    AUDIO_CROSSFADE_MAX_MS,
  )
  const outputDeviceId =
    typeof value?.outputDeviceId === 'string' && value.outputDeviceId ? value.outputDeviceId : 'default'
  const equalizer = value?.equalizer
    ? resolveAudioEqualizerSettings(value.equalizer)
    : value && ('equalizerGains' in value || 'equalizerEnabled' in value)
      ? migrateLegacyEqualizer(value)
      : cloneDefaultEqualizer()
  const replayGainMode: ReplayGainMode =
    value?.replayGainMode === 'track' || value?.replayGainMode === 'auto' ? value.replayGainMode : 'off'
  return {
    equalizer,
    crossfadeMs,
    outputDeviceId,
    replayGainMode,
    trackFeaturesEnabled: value?.trackFeaturesEnabled === true,
    highPrecisionBeats: value?.highPrecisionBeats === true,
    highPrecisionStems: value?.highPrecisionStems === true,
    preloadNextTrack: value?.preloadNextTrack !== false,
  }
}

const read = (): AudioSettingsState => {
  if (typeof window === 'undefined') return { ...DEFAULT_AUDIO_SETTINGS, equalizer: cloneDefaultEqualizer() }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? resolveStored(JSON.parse(raw) as StoredAudioSettings) : resolveStored(null)
  } catch {
    return resolveStored(null)
  }
}

const persist = (state: AudioSettingsState): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存储被禁用时保持内存态即可。
  }
}

interface AudioSettingsStore extends AudioSettingsState {
  setEqualizerEnabled: (enabled: boolean) => void
  setEqualizerBand: (index: number, gain: number) => void
  setEqualizerEffect: (id: AudioEffectId, value: number) => void
  applyEqualizerPreset: (modeId: AudioEqualizerModeId) => void
  resetEqualizer: () => void
  setCrossfadeMs: (ms: number) => void
  setOutputDeviceId: (deviceId: string) => void
  setReplayGainMode: (mode: ReplayGainMode) => void
  setTrackFeaturesEnabled: (enabled: boolean) => void
  setHighPrecisionBeats: (enabled: boolean) => void
  setHighPrecisionStems: (enabled: boolean) => void
  setPreloadNextTrack: (enabled: boolean) => void
}

const initial = read()

export const useAudioSettingsStore = create<AudioSettingsStore>((set, get) => {
  const update = (patch: Partial<AudioSettingsState>): void => {
    const next: AudioSettingsState = {
      equalizer: patch.equalizer ?? get().equalizer,
      crossfadeMs: clamp(patch.crossfadeMs ?? get().crossfadeMs, 0, AUDIO_CROSSFADE_MAX_MS),
      outputDeviceId: patch.outputDeviceId ?? get().outputDeviceId,
      replayGainMode: patch.replayGainMode ?? get().replayGainMode,
      trackFeaturesEnabled: patch.trackFeaturesEnabled ?? get().trackFeaturesEnabled,
      highPrecisionBeats: patch.highPrecisionBeats ?? get().highPrecisionBeats,
      highPrecisionStems: patch.highPrecisionStems ?? get().highPrecisionStems,
      preloadNextTrack: patch.preloadNextTrack ?? get().preloadNextTrack,
    }
    persist(next)
    set(next)
  }

  const updateEqualizer = (equalizer: AudioEqualizerSettings): void => update({ equalizer })

  return {
    ...initial,
    setEqualizerEnabled: (enabled) => updateEqualizer({ ...get().equalizer, enabled }),
    setEqualizerBand: (index, gain) => {
      const current = get().equalizer
      const gains = [...current.gains]
      gains[index] = clamp(gain, AUDIO_EQUALIZER_MIN_GAIN_DB, AUDIO_EQUALIZER_MAX_GAIN_DB)
      updateEqualizer(writeAudioEqualizerCustomDraft(current, gains, current.effects))
    },
    setEqualizerEffect: (id, value) => {
      const current = get().equalizer
      updateEqualizer(writeAudioEqualizerCustomDraft(current, current.gains, { ...current.effects, [id]: value }))
    },
    applyEqualizerPreset: (modeId) => {
      const next = planAudioSoundPreset(get().equalizer, modeId)
      if (next) updateEqualizer(next)
    },
    resetEqualizer: () => updateEqualizer(resetAudioEqualizerCustomSlot(get().equalizer)),
    setCrossfadeMs: (crossfadeMs) => update({ crossfadeMs }),
    setOutputDeviceId: (outputDeviceId) => update({ outputDeviceId }),
    setReplayGainMode: (replayGainMode) => update({ replayGainMode }),
    setTrackFeaturesEnabled: (trackFeaturesEnabled) => update({ trackFeaturesEnabled }),
    setHighPrecisionBeats: (highPrecisionBeats) => update({ highPrecisionBeats }),
    setHighPrecisionStems: (highPrecisionStems) => update({ highPrecisionStems }),
    setPreloadNextTrack: (preloadNextTrack) => update({ preloadNextTrack }),
  }
})
