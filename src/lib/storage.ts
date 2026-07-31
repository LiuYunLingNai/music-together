import type { LyricSettings, MusicSource } from '../domain/types'
import type { ThemePreference } from './theme'

const PREFIX = 'music-together-desktop:'

function get(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    // Preferences remain usable for the current session when storage is blocked.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // Ignore unavailable storage.
  }
}

function getJson<T>(key: string, fallback: T): T {
  const raw = get(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const DEFAULT_LYRIC_SETTINGS: LyricSettings = {
  ttmlEnabled: true,
  ttmlDbUrl: 'https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml',
  alignAnchor: 'center',
  alignPosition: 0.4,
  animation: true,
  blur: false,
  scale: true,
  fontSize: 90,
  fontWeight: 600,
  translationFontSize: 75,
  romanFontSize: 75,
}

function getNumber(key: string, fallback: number): number {
  const raw = get(key)
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export const storage = {
  getServerUrl: () => get('server-url') ?? 'http://127.0.0.1:3001',
  setServerUrl: (value: string) => set('server-url', value),
  getNickname: () => get('nickname') ?? '',
  setNickname: (value: string) => set('nickname', value),
  clearNickname: () => remove('nickname'),
  getUserId: () => get('user-id') ?? '',
  setUserId: (value: string) => set('user-id', value),
  clearUserId: () => remove('user-id'),
  getThemePreference: (): ThemePreference => {
    const value = get('theme-preference')
    return value === 'light' || value === 'dark' ? value : 'auto'
  },
  setThemePreference: (value: ThemePreference) => set('theme-preference', value),
  getUiScale: () => Math.min(1.4, Math.max(0.9, getNumber('ui-scale', 1.15))),
  setUiScale: (value: number) => set('ui-scale', String(value)),
  getVolume: () => Math.min(1, Math.max(0, getNumber('volume', 0.78))),
  setVolume: (value: number) => set('volume', String(value)),
  getLyricOffset: (key: string) => Math.min(10_000, Math.max(-10_000, getNumber(`lyric-offset:${key}`, 0))),
  setLyricOffset: (key: string, value: number) => set(`lyric-offset:${key}`, String(value)),
  getSyncInterval: () => Math.min(60, Math.max(3, getNumber('sync-interval', 10))),
  setSyncInterval: (value: number) => set('sync-interval', String(value)),
  getLyricSettings: (): LyricSettings => ({ ...DEFAULT_LYRIC_SETTINGS, ...getJson<Partial<LyricSettings>>('lyric-settings', {}) }),
  setLyricSettings: (value: LyricSettings) => set('lyric-settings', JSON.stringify(value)),
  getAuthCookies: () => getJson<Array<{ platform: MusicSource; cookie: string }>>('auth-cookies', []),
  upsertAuthCookie: (platform: MusicSource, cookie: string) => {
    const cookies = getJson<Array<{ platform: MusicSource; cookie: string }>>('auth-cookies', []).filter((item) => item.platform !== platform)
    cookies.push({ platform, cookie })
    set('auth-cookies', JSON.stringify(cookies))
  },
  removeAuthCookie: (platform: MusicSource) => {
    const cookies = getJson<Array<{ platform: MusicSource; cookie: string }>>('auth-cookies', []).filter((item) => item.platform !== platform)
    set('auth-cookies', JSON.stringify(cookies))
  },
  clearAuthCookies: () => remove('auth-cookies'),
  getRejoinToken: (roomId: string): string | undefined => {
    const raw = get(`rejoin:${roomId}`)
    if (!raw) return undefined
    try {
      const value = JSON.parse(raw) as { token: string; expiresAt: number }
      return value.expiresAt > Date.now() ? value.token : undefined
    } catch {
      return undefined
    }
  },
  setRejoinToken: (roomId: string, token: string, expiresAt: number) =>
    set(`rejoin:${roomId}`, JSON.stringify({ token, expiresAt })),
  clearRejoinToken: (roomId: string) => remove(`rejoin:${roomId}`),
}

export function normalizeServerUrl(value: string): string {
  const candidate = value.trim().replace(/\/+$/, '')
  const parsed = new URL(candidate.includes('://') ? candidate : `http://${candidate}`)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('仅支持 HTTP 或 HTTPS 服务器')
  return parsed.toString().replace(/\/$/, '')
}
