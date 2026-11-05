import { create } from 'zustand'

/** 与上游五段均衡器的频段一致；增益单位 dB。 */
export const AUDIO_EQ_BANDS = [60, 230, 910, 3600, 14000] as const
export const AUDIO_EQ_GAIN_MIN = -12
export const AUDIO_EQ_GAIN_MAX = 12
export const AUDIO_CROSSFADE_MAX_MS = 8000

export interface AudioSettingsState {
  equalizerEnabled: boolean
  equalizerGains: number[]
  crossfadeMs: number
  outputDeviceId: string
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettingsState = {
  equalizerEnabled: false,
  equalizerGains: AUDIO_EQ_BANDS.map(() => 0),
  crossfadeMs: 80,
  outputDeviceId: 'default',
}

const STORAGE_KEY = 'mt-audio-settings'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const normalize = (value: Partial<AudioSettingsState> | null | undefined): AudioSettingsState => {
  const gains = Array.isArray(value?.equalizerGains) ? value.equalizerGains : DEFAULT_AUDIO_SETTINGS.equalizerGains
  return {
    equalizerEnabled: Boolean(value?.equalizerEnabled),
    equalizerGains: AUDIO_EQ_BANDS.map((_, index) => clamp(Number(gains[index]) || 0, AUDIO_EQ_GAIN_MIN, AUDIO_EQ_GAIN_MAX)),
    crossfadeMs: clamp(Number(value?.crossfadeMs) || 0, 0, AUDIO_CROSSFADE_MAX_MS),
    outputDeviceId: typeof value?.outputDeviceId === 'string' && value.outputDeviceId ? value.outputDeviceId : 'default',
  }
}

const read = (): AudioSettingsState => {
  if (typeof window === 'undefined') return DEFAULT_AUDIO_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalize(JSON.parse(raw) as Partial<AudioSettingsState>) : DEFAULT_AUDIO_SETTINGS
  } catch {
    return DEFAULT_AUDIO_SETTINGS
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
  setEqualizerGain: (index: number, gain: number) => void
  resetEqualizer: () => void
  setCrossfadeMs: (ms: number) => void
  setOutputDeviceId: (deviceId: string) => void
}

const initial = read()

export const useAudioSettingsStore = create<AudioSettingsStore>((set, get) => {
  const update = (patch: Partial<AudioSettingsState>) => {
    const next = normalize({ ...get(), ...patch })
    persist(next)
    set(next)
  }
  return {
    ...initial,
    setEqualizerEnabled: (equalizerEnabled) => update({ equalizerEnabled }),
    setEqualizerGain: (index, gain) => {
      const gains = [...get().equalizerGains]
      gains[index] = clamp(gain, AUDIO_EQ_GAIN_MIN, AUDIO_EQ_GAIN_MAX)
      update({ equalizerGains: gains })
    },
    resetEqualizer: () => update({ equalizerEnabled: false, equalizerGains: DEFAULT_AUDIO_SETTINGS.equalizerGains }),
    setCrossfadeMs: (crossfadeMs) => update({ crossfadeMs: clamp(crossfadeMs, 0, AUDIO_CROSSFADE_MAX_MS) }),
    setOutputDeviceId: (outputDeviceId) => update({ outputDeviceId }),
  }
})
