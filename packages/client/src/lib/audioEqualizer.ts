import {
  areAudioEffectsEqual,
  createNeutralAudioEffects,
  normalizeAudioEffects,
  type AudioEffectSettings,
} from './audioEffects/model'
import { AUDIO_SOUND_PRESETS, isAudioSoundPresetId, type AudioSoundPresetId } from './audioEffects/presets'

export interface AudioEqualizerCustomSlot {
  gains: number[]
  effects: AudioEffectSettings
}

export interface AudioEqualizerSettings {
  enabled: boolean
  gains: number[]
  preset: AudioEqualizerModeId
  effects: AudioEffectSettings
  customSlots: AudioEqualizerCustomSlot[]
}

export const AUDIO_EQUALIZER_MIN_GAIN_DB = -12
export const AUDIO_EQUALIZER_MAX_GAIN_DB = 12

export const AUDIO_EQUALIZER_BANDS = [
  { frequency: 31, label: '31' },
  { frequency: 62, label: '62' },
  { frequency: 125, label: '125' },
  { frequency: 250, label: '250' },
  { frequency: 500, label: '500' },
  { frequency: 1000, label: '1k' },
  { frequency: 2000, label: '2k' },
  { frequency: 4000, label: '4k' },
  { frequency: 8000, label: '8k' },
  { frequency: 16000, label: '16k' },
] as const

export type AudioEqualizerPresetId = AudioSoundPresetId
export const AUDIO_EQUALIZER_CUSTOM_SLOT_IDS = ['custom1', 'custom2'] as const
export type AudioEqualizerCustomSlotId = (typeof AUDIO_EQUALIZER_CUSTOM_SLOT_IDS)[number]
export type AudioEqualizerModeId = AudioEqualizerPresetId | AudioEqualizerCustomSlotId

export const AUDIO_EQUALIZER_PRESETS = Object.fromEntries(
  Object.entries(AUDIO_SOUND_PRESETS).map(([presetId, preset]) => [presetId, preset.gains]),
) as Record<AudioEqualizerPresetId, readonly number[]>

export const isAudioEqualizerCustomSlotId = (value: unknown): value is AudioEqualizerCustomSlotId =>
  AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.includes(value as AudioEqualizerCustomSlotId)

export const getAudioEqualizerCustomSlotIndex = (slotId: AudioEqualizerCustomSlotId): number =>
  AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.indexOf(slotId)

const createEmptyCustomSlot = (): AudioEqualizerCustomSlot => ({
  gains: [...AUDIO_SOUND_PRESETS.flat.gains],
  effects: createNeutralAudioEffects(),
})

export const DEFAULT_AUDIO_EQUALIZER_SETTINGS: AudioEqualizerSettings = {
  enabled: false,
  gains: [...AUDIO_EQUALIZER_PRESETS.flat],
  preset: 'flat',
  effects: createNeutralAudioEffects(),
  customSlots: AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.map(createEmptyCustomSlot),
}

const clampGain = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(AUDIO_EQUALIZER_MAX_GAIN_DB, Math.max(AUDIO_EQUALIZER_MIN_GAIN_DB, parsed))
}

export const normalizeAudioEqualizerGains = (value: unknown): number[] => {
  const rawGains = Array.isArray(value) ? value : []
  return AUDIO_EQUALIZER_BANDS.map((_, index) => clampGain(rawGains[index]))
}

export type AudioEqualizerBandShape = 'lowshelf' | 'peaking' | 'highshelf'

export const audioEqualizerBandShape = (index: number): AudioEqualizerBandShape =>
  index === 0 ? 'lowshelf' : index === AUDIO_EQUALIZER_BANDS.length - 1 ? 'highshelf' : 'peaking'

const normalizeCustomSlot = (value: unknown): AudioEqualizerCustomSlot => {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<AudioEqualizerCustomSlot>
  return {
    gains: normalizeAudioEqualizerGains(candidate.gains),
    effects: normalizeAudioEffects(candidate.effects),
  }
}

const resolveModeId = (value: unknown, gains: number[], effects: AudioEffectSettings): AudioEqualizerModeId => {
  if (isAudioSoundPresetId(value) || isAudioEqualizerCustomSlotId(value)) return value

  const matched = (Object.entries(AUDIO_SOUND_PRESETS) as Array<[AudioEqualizerPresetId, (typeof AUDIO_SOUND_PRESETS)[AudioEqualizerPresetId]]>)
    .find(([, preset]) => preset.gains.every((gain, index) => gain === gains[index])
      && areAudioEffectsEqual(preset.effects, effects))?.[0]
  return matched ?? 'custom1'
}

export const resolveAudioEqualizerSettings = (value: unknown): AudioEqualizerSettings => {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_AUDIO_EQUALIZER_SETTINGS,
      gains: [...DEFAULT_AUDIO_EQUALIZER_SETTINGS.gains],
      effects: createNeutralAudioEffects(),
      customSlots: AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.map(createEmptyCustomSlot),
    }
  }

  const candidate = value as Partial<AudioEqualizerSettings>
  const gains = normalizeAudioEqualizerGains(candidate.gains)
  const effects = normalizeAudioEffects(candidate.effects)
  const storedSlots = Array.isArray(candidate.customSlots) ? candidate.customSlots : null
  const customSlots = AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.map((_, index) => normalizeCustomSlot(storedSlots?.[index]))

  return {
    enabled: candidate.enabled === true,
    gains,
    preset: resolveModeId(candidate.preset, gains, effects),
    effects,
    customSlots,
  }
}

export const cloneAudioEqualizerSettings = (settings: AudioEqualizerSettings): AudioEqualizerSettings => ({
  enabled: settings.enabled,
  gains: [...settings.gains],
  preset: settings.preset,
  effects: { ...settings.effects },
  customSlots: settings.customSlots.map((slot) => ({ gains: [...slot.gains], effects: { ...slot.effects } })),
})

/** 编辑总是写进自定义槽位：当前选中的自定义槽，选中内置预设时写第一个。 */
export const writeAudioEqualizerCustomDraft = (
  settings: AudioEqualizerSettings,
  gains: number[],
  effects: AudioEffectSettings,
): AudioEqualizerSettings => {
  const slotId = isAudioEqualizerCustomSlotId(settings.preset) ? settings.preset : AUDIO_EQUALIZER_CUSTOM_SLOT_IDS[0]
  const slotIndex = getAudioEqualizerCustomSlotIndex(slotId)
  const normalizedGains = normalizeAudioEqualizerGains(gains)
  const normalizedEffects = normalizeAudioEffects(effects)
  return {
    ...settings,
    enabled: true,
    gains: normalizedGains,
    effects: normalizedEffects,
    preset: slotId,
    customSlots: settings.customSlots.map((slot, index) =>
      index === slotIndex ? { gains: [...normalizedGains], effects: { ...normalizedEffects } } : slot,
    ),
  }
}

export const planAudioSoundPreset = (
  settings: AudioEqualizerSettings,
  modeId: AudioEqualizerModeId,
  { keepEnabled = false }: { keepEnabled?: boolean } = {},
): AudioEqualizerSettings | null => {
  const source = isAudioEqualizerCustomSlotId(modeId)
    ? settings.customSlots[getAudioEqualizerCustomSlotIndex(modeId)]
    : isAudioSoundPresetId(modeId)
      ? AUDIO_SOUND_PRESETS[modeId]
      : undefined
  if (!source) return null

  return {
    ...cloneAudioEqualizerSettings(settings),
    enabled: keepEnabled ? settings.enabled : true,
    preset: modeId,
    gains: [...source.gains],
    effects: { ...source.effects },
  }
}

/** 只清空自定义槽；内置预设不可编辑，没有可撤销的内容。 */
export const resetAudioEqualizerCustomSlot = (settings: AudioEqualizerSettings): AudioEqualizerSettings => {
  if (!isAudioEqualizerCustomSlotId(settings.preset)) return settings
  const slotIndex = getAudioEqualizerCustomSlotIndex(settings.preset)
  const gains = [...AUDIO_SOUND_PRESETS.flat.gains]
  const effects = createNeutralAudioEffects()
  return {
    ...settings,
    gains,
    effects,
    customSlots: settings.customSlots.map((slot, index) =>
      index === slotIndex ? { gains: [...gains], effects: { ...effects } } : slot,
    ),
  }
}

export const areAudioEqualizerSettingsEqual = (
  left: AudioEqualizerSettings,
  right: AudioEqualizerSettings,
): boolean =>
  left.enabled === right.enabled
  && left.preset === right.preset
  && left.gains.every((gain, index) => gain === right.gains[index])
  && areAudioEffectsEqual(left.effects, right.effects)
