import type { GlobalBackgroundSettings } from '@music-together/shared'
import { db } from './database.js'

const BACKGROUND_KEY = 'global_background'
const DEFAULT_SETTINGS: GlobalBackgroundSettings = {
  backgroundUrl: null,
  glassOverlay: false,
  colorPreset: 'gold',
  backgroundBrightness: 60,
  autoTint: false,
}

interface ServerSettingRow {
  value_json: string
}

const selectBackground = db.prepare<[string], ServerSettingRow>('SELECT value_json FROM server_settings WHERE key = ?')
const upsertBackground = db.prepare(`
  INSERT INTO server_settings (key, value_json, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`)

function parseSettings(value: string | undefined): GlobalBackgroundSettings {
  if (!value) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(value) as Partial<GlobalBackgroundSettings>
    return {
      backgroundUrl: typeof parsed.backgroundUrl === 'string' ? parsed.backgroundUrl : null,
      glassOverlay: parsed.glassOverlay === true,
      colorPreset:
        parsed.colorPreset === 'ocean' ||
        parsed.colorPreset === 'rose' ||
        parsed.colorPreset === 'violet' ||
        parsed.colorPreset === 'sunset' ||
        parsed.colorPreset === 'mint' ||
        parsed.colorPreset === 'mono'
          ? parsed.colorPreset
          : DEFAULT_SETTINGS.colorPreset,
      backgroundBrightness:
        typeof parsed.backgroundBrightness === 'number' && Number.isFinite(parsed.backgroundBrightness)
          ? Math.min(100, Math.max(20, Math.round(parsed.backgroundBrightness)))
          : DEFAULT_SETTINGS.backgroundBrightness,
      autoTint: parsed.autoTint === true,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const globalBackgroundRepo = {
  get(): GlobalBackgroundSettings {
    return parseSettings(selectBackground.get(BACKGROUND_KEY)?.value_json)
  },

  update(patch: Partial<GlobalBackgroundSettings>): GlobalBackgroundSettings {
    const settings = { ...this.get(), ...patch }
    upsertBackground.run(BACKGROUND_KEY, JSON.stringify(settings), Date.now())
    return settings
  },
}
