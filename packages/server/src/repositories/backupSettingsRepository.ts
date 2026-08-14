import type { BackupSettings } from '@music-together/shared'
import { db } from './database.js'

const BACKUP_SETTINGS_KEY = 'backup_settings'

export const DEFAULT_BACKUP_SETTINGS: Readonly<BackupSettings> = Object.freeze({
  enabled: false,
  cleanupEnabled: true,
  intervalHours: 24,
  retentionDays: 7,
})

interface ServerSettingRow {
  value_json: string
}

const selectSettings = db.prepare<[string], ServerSettingRow>('SELECT value_json FROM server_settings WHERE key = ?')
const upsertSettings = db.prepare(`
  INSERT INTO server_settings (key, value_json, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`)

function parseSettings(value: string | undefined): BackupSettings {
  if (!value) return { ...DEFAULT_BACKUP_SETTINGS }
  try {
    const parsed = JSON.parse(value) as Partial<BackupSettings>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_BACKUP_SETTINGS.enabled,
      cleanupEnabled:
        typeof parsed.cleanupEnabled === 'boolean' ? parsed.cleanupEnabled : DEFAULT_BACKUP_SETTINGS.cleanupEnabled,
      intervalHours:
        typeof parsed.intervalHours === 'number' && Number.isInteger(parsed.intervalHours)
          ? Math.min(24 * 365, Math.max(1, parsed.intervalHours))
          : DEFAULT_BACKUP_SETTINGS.intervalHours,
      retentionDays:
        typeof parsed.retentionDays === 'number' && Number.isInteger(parsed.retentionDays)
          ? Math.min(3650, Math.max(1, parsed.retentionDays))
          : DEFAULT_BACKUP_SETTINGS.retentionDays,
    }
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS }
  }
}

export const backupSettingsRepo = {
  get(): BackupSettings {
    return parseSettings(selectSettings.get(BACKUP_SETTINGS_KEY)?.value_json)
  },

  update(patch: Partial<BackupSettings>): BackupSettings {
    const settings = { ...this.get(), ...patch }
    upsertSettings.run(BACKUP_SETTINGS_KEY, JSON.stringify(settings), Date.now())
    return settings
  },
}
