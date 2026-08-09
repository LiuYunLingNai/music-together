import type { LyricSettings, MusicSource, PlayerVisualSettings } from '../domain/types'
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
  alignPosition: 0.46,
  animation: true,
  blur: true,
  scale: true,
  fontSize: 90,
  fontWeight: 700,
  translationFontSize: 75,
  romanFontSize: 75,
}

export const DEFAULT_PLAYER_VISUAL_SETTINGS: PlayerVisualSettings = {
  layout: 'split',
  backgroundMode: 'fluid',
  staticFluid: false,
  backgroundDim: 30,
  backgroundBlur: 64,
  accentVariant: 'primary',
  coverShape: 'rounded',
  coverHorizontalAlign: 'left',
  coverVerticalAlign: 'center',
  coverScale: 1,
  coverShadow: true,
  controlsMode: 'auto',
  progressAtBottom: false,
  progressPreview: true,
  remainingTime: false,
  lyricTextAlign: 'left',
  lyricFade: true,
  lyricMotion: 'smooth',
  lyricGlow: true,
  textShadow: false,
  contributors: 'hover',
  customFontFamily: '',
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
const numberBetween = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const booleanOr = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback

export function normalizePlayerVisualSettings(value: unknown): PlayerVisualSettings {
  const fallback = DEFAULT_PLAYER_VISUAL_SETTINGS
  const candidate = value && typeof value === 'object' ? value as Partial<PlayerVisualSettings> : {}
  return {
    layout: oneOf(candidate.layout, ['split', 'lyrics-only'], fallback.layout),
    backgroundMode: oneOf(candidate.backgroundMode, ['fluid', 'blur', 'gradient', 'solid', 'none'], fallback.backgroundMode),
    staticFluid: booleanOr(candidate.staticFluid, fallback.staticFluid),
    backgroundDim: numberBetween(candidate.backgroundDim, 0, 90, fallback.backgroundDim),
    backgroundBlur: numberBetween(candidate.backgroundBlur, 0, 128, fallback.backgroundBlur),
    accentVariant: oneOf(candidate.accentVariant, ['primary', 'secondary', 'tertiary'], fallback.accentVariant),
    coverShape: oneOf(candidate.coverShape, ['rounded', 'square', 'circle'], fallback.coverShape),
    coverHorizontalAlign: oneOf(candidate.coverHorizontalAlign, ['left', 'center'], fallback.coverHorizontalAlign),
    coverVerticalAlign: oneOf(candidate.coverVerticalAlign, ['center', 'bottom'], fallback.coverVerticalAlign),
    coverScale: numberBetween(candidate.coverScale, 0.7, 1.25, fallback.coverScale),
    coverShadow: booleanOr(candidate.coverShadow, fallback.coverShadow),
    controlsMode: oneOf(candidate.controlsMode, ['auto', 'always', 'hidden'], fallback.controlsMode),
    progressAtBottom: booleanOr(candidate.progressAtBottom, fallback.progressAtBottom),
    progressPreview: booleanOr(candidate.progressPreview, fallback.progressPreview),
    remainingTime: booleanOr(candidate.remainingTime, fallback.remainingTime),
    lyricTextAlign: oneOf(candidate.lyricTextAlign, ['left', 'center'], fallback.lyricTextAlign),
    lyricFade: booleanOr(candidate.lyricFade, fallback.lyricFade),
    lyricMotion: oneOf(candidate.lyricMotion, ['smooth', 'sharp', 'soft', 'easeout'], fallback.lyricMotion),
    lyricGlow: booleanOr(candidate.lyricGlow, fallback.lyricGlow),
    textShadow: booleanOr(candidate.textShadow, fallback.textShadow),
    contributors: oneOf(candidate.contributors, ['always', 'hover', 'never'], fallback.contributors),
    customFontFamily: typeof candidate.customFontFamily === 'string' ? candidate.customFontFamily.trim().slice(0, 120) : fallback.customFontFamily,
  }
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
  getSyncInterval: () => Math.min(60, Math.max(1, getNumber('sync-interval', 10))),
  setSyncInterval: (value: number) => set('sync-interval', String(value)),
  getPlaybackTempoSyncEnabled: () => get('playback-tempo-sync') === 'true',
  setPlaybackTempoSyncEnabled: (value: boolean) => set('playback-tempo-sync', String(value)),
  getPlaybackHardSeekSyncEnabled: () => get('playback-hard-seek-sync') === 'true',
  setPlaybackHardSeekSyncEnabled: (value: boolean) => set('playback-hard-seek-sync', String(value)),
  getBackgroundFps: () => Math.min(60, Math.max(5, getNumber('background-fps', 60))),
  setBackgroundFps: (value: number) => set('background-fps', String(value)),
  getBackgroundFlowSpeed: () => Math.min(2, Math.max(0.1, getNumber('background-flow-speed', 1))),
  setBackgroundFlowSpeed: (value: number) => set('background-flow-speed', String(value)),
  getBackgroundRenderScale: () => Math.min(1, Math.max(0.25, getNumber('background-render-scale', 1))),
  setBackgroundRenderScale: (value: number) => set('background-render-scale', String(value)),
  getLyricSettings: (): LyricSettings => ({ ...DEFAULT_LYRIC_SETTINGS, ...getJson<Partial<LyricSettings>>('lyric-settings', {}) }),
  setLyricSettings: (value: LyricSettings) => set('lyric-settings', JSON.stringify(value)),
  getPlayerVisualSettings: (): PlayerVisualSettings => normalizePlayerVisualSettings(getJson<Partial<PlayerVisualSettings>>('player-visual-settings', {})),
  setPlayerVisualSettings: (value: PlayerVisualSettings) => set('player-visual-settings', JSON.stringify(value)),
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
