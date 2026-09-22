import { NTP, type MusicSource } from '@music-together/shared'
import { SYNC_PACKET_INTERVAL_MAX_SECONDS, SYNC_PACKET_INTERVAL_MIN_SECONDS } from '@/lib/constants'

const PREFIX = 'mt-'
const SETTINGS_SCHEMA_VERSION_KEY = 'settingsSchemaVersion'
const SETTINGS_SCHEMA_VERSION = 3

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(`${PREFIX}${key}`)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, value)
  } catch {
    // quota exceeded or blocked
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${key}`)
  } catch {
    // blocked
  }
}

// ---------------------------------------------------------------------------
// JSON helpers (safe parse / stringify through the PREFIX system)
// ---------------------------------------------------------------------------

function safeGetJSON<T>(key: string): T | null {
  const raw = safeGet(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function safeSetJSON(key: string, value: unknown): void {
  safeSet(key, JSON.stringify(value))
}

/** Parse a float from storage, returning the fallback if invalid */
function safeFloat(key: string, fallback: number): number {
  const raw = safeGet(key)
  if (raw === null) return fallback
  const parsed = parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Parse an int from storage, returning the fallback if invalid */
function safeInt(key: string, fallback: number): number {
  const raw = safeGet(key)
  if (raw === null) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Validate a string value is one of the allowed options */
function safeEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = safeGet(key) as T | null
  if (raw !== null && allowed.includes(raw)) return raw
  return fallback
}

/**
 * Apply browser-setting migrations once per schema version.
 *
 * Version 1 changes automatic tempo correction from opt-out to opt-in. This
 * deliberately resets the legacy value once; choices made after the upgrade
 * are preserved because the recorded version prevents the migration from
 * running again on reload or restart.
 * Version 2 adds the opt-in hard-seek fallback used while tempo correction is
 * disabled.
 */
function migrateSettings(): void {
  const storedVersion = Math.max(0, safeInt(SETTINGS_SCHEMA_VERSION_KEY, 0))
  if (storedVersion >= SETTINGS_SCHEMA_VERSION) return

  if (storedVersion < 1) {
    safeSet('playbackTempoSyncEnabled', 'false')
  }

  if (storedVersion < 2) {
    safeSet('playbackHardSeekSyncEnabled', 'false')
  }

  if (storedVersion < 3) {
    // 画质档从自拟的 low/medium/high 迁移到上游的四档 eco/balanced/high/ultra。
    // 映射：low→eco、medium→balanced、high→high；'auto' 保持（仍表示自动）。
    const previous = safeGet('visualQuality')
    const migrated =
      previous === 'low' ? 'eco' : previous === 'medium' ? 'balanced' : previous === 'high' ? 'high' : null
    if (migrated) safeSet('visualQuality', migrated)
  }

  safeSet(SETTINGS_SCHEMA_VERSION_KEY, String(SETTINGS_SCHEMA_VERSION))
}

migrateSettings()

const LYRIC_ANCHORS = ['top', 'center', 'bottom'] as const
const LYRIC_MASK_MODES = ['', 'full-mask', 'partial-mask'] as const

/** Mineradio 舞台模式：classic 为默认，始终可无损回退。
 *  注意：没有 'cover' —— 曾自创的「封面视界」已于第九轮按用户决策删除；
 *  旧持久化值 'cover' 会因不在白名单内而安全回退到 'classic'。 */
export const VISUAL_STAGES = ['classic', 'emily', 'tunnel', 'planet', 'vinyl', 'galaxy', 'topography'] as const
export type VisualStageSetting = (typeof VISUAL_STAGES)[number]

/**
 * 画质档 —— 与上游 Mineradio 的 `performanceQuality` 同域
 * （`eco / balanced / high / ultra`），`auto` 表示按设备能力自动选择。
 *
 * 旧的 `low / medium / high` 已由 settings 迁移（schema v3）映射为
 * `eco / balanced / high`。
 */
export const VISUAL_QUALITIES = ['auto', 'eco', 'balanced', 'high', 'ultra'] as const
export type VisualQualitySetting = (typeof VISUAL_QUALITIES)[number]

/**
 * 歌词渲染器。
 *
 * - `webgl`：歌词进入 3D 场景（默认），与粒子/封面共享空间与景深
 * - `amll` ：沿用 AMLL 的 DOM 渲染器（可靠回退路径）
 */
export const LYRIC_RENDERERS = ['webgl', 'amll'] as const
export type LyricRendererSetting = (typeof LYRIC_RENDERERS)[number]

/** 3D 歌词的运动风格 */
export const LYRIC_MOTIONS = ['float', 'smooth', 'glass', 'quick', 'shine', 'glitch'] as const
export type LyricMotionSetting = (typeof LYRIC_MOTIONS)[number]

/** 3D 歌词的显示模式 */
export const LYRIC_DISPLAY_SETTINGS = ['single', 'dual', 'triple', 'cinema', 'custom'] as const
export type LyricDisplaySetting = (typeof LYRIC_DISPLAY_SETTINGS)[number]

/** 3D 歌词的译词模式 */
export const LYRIC_TRANSLATION_SETTINGS = ['off', 'current', 'dual', 'multi'] as const
export type LyricTranslationSetting = (typeof LYRIC_TRANSLATION_SETTINGS)[number]

/** 所有持久化设置项的默认值 — 供 store 层的 resettable 工厂使用 */
export const SETTING_DEFAULTS = {
  playbackTempoSyncEnabled: false,
  playbackHardSeekSyncEnabled: false,
  syncPacketIntervalSeconds: NTP.STEADY_STATE_INTERVAL_MS / 1000,
  ttmlEnabled: true,
  ttmlDbUrl: 'https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml',
  lyricAlignAnchor: 'center' as 'top' | 'center' | 'bottom',
  lyricAlignPosition: 0.4,
  lyricEnableSpring: true,
  lyricEnableBlur: false,
  lyricEnableScale: true,
  lyricHidePassedLines: false,
  lyricShowBottomLine: true,
  lyricMaskObsceneWordsMode: '' as '' | 'full-mask' | 'partial-mask',
  lyricMaskObsceneWordChar: '*',
  lyricWordFadeWidth: 0.5,
  lyricFontWeight: 600,
  lyricFontSize: 90,
  lyricTranslationFontSize: 75,
  lyricRomanFontSize: 75,
  lyricOffsets: {} as Record<string, number>,
  bgFps: 30,
  bgFlowSpeed: 2,
  bgRenderScale: 0.5,
  visualStage: 'classic' as VisualStageSetting,
  visualQuality: 'auto' as VisualQualitySetting,
  /** 粒子溢光（上游 fx.bloom，出厂关闭）。 */
  visualBloom: false,
  /** 轮廓高亮（上游 fx.edge，出厂关闭）。 */
  visualEdge: false,
  lyricRenderer: 'webgl' as LyricRendererSetting,
  lyricMotion: 'float' as LyricMotionSetting,
  lyricDisplayMode3d: 'cinema' as LyricDisplaySetting,
  lyricCustomLineCount: 5,
  lyricTranslationMode3d: 'multi' as LyricTranslationSetting,
} satisfies Record<string, unknown>

export const storage = {
  /** Persistent user identity — synced from server identity bootstrap */
  getUserId: (): string => {
    return safeGet('userId') ?? ''
  },
  setUserId: (id: string) => safeSet('userId', id),
  clearUserId: () => safeRemove('userId'),

  getNickname: () => safeGet('nickname') ?? '',
  setNickname: (v: string) => safeSet('nickname', v),
  clearNickname: () => safeRemove('nickname'),

  getVolume: () => {
    const vol = safeFloat('volume', 0.8)
    return Math.max(0, Math.min(1, vol))
  },
  setVolume: (v: number) => safeSet('volume', String(v)),

  // Playback synchronization
  getPlaybackTempoSyncEnabled: () => safeGet('playbackTempoSyncEnabled') === 'true',
  setPlaybackTempoSyncEnabled: (v: boolean) => safeSet('playbackTempoSyncEnabled', String(v)),
  getPlaybackHardSeekSyncEnabled: () => safeGet('playbackHardSeekSyncEnabled') === 'true',
  setPlaybackHardSeekSyncEnabled: (v: boolean) => safeSet('playbackHardSeekSyncEnabled', String(v)),

  getSyncPacketIntervalSeconds: () => {
    const seconds = safeInt('syncPacketIntervalSeconds', SETTING_DEFAULTS.syncPacketIntervalSeconds)
    return Math.max(SYNC_PACKET_INTERVAL_MIN_SECONDS, Math.min(SYNC_PACKET_INTERVAL_MAX_SECONDS, seconds))
  },
  setSyncPacketIntervalSeconds: (v: number) => safeSet('syncPacketIntervalSeconds', String(v)),

  // Lyric settings
  getLyricAlignAnchor: () => safeEnum('lyricAlignAnchor', LYRIC_ANCHORS, SETTING_DEFAULTS.lyricAlignAnchor),
  setLyricAlignAnchor: (v: (typeof LYRIC_ANCHORS)[number]) => safeSet('lyricAlignAnchor', v),

  getLyricAlignPosition: () => {
    const pos = safeFloat('lyricAlignPosition', SETTING_DEFAULTS.lyricAlignPosition)
    return Math.max(0, Math.min(1, pos))
  },
  setLyricAlignPosition: (v: number) => safeSet('lyricAlignPosition', String(v)),

  getLyricEnableSpring: () => safeGet('lyricEnableSpring') !== 'false',
  setLyricEnableSpring: (v: boolean) => safeSet('lyricEnableSpring', String(v)),

  getLyricEnableBlur: () => safeGet('lyricEnableBlur') === 'true',
  setLyricEnableBlur: (v: boolean) => safeSet('lyricEnableBlur', String(v)),

  getLyricEnableScale: () => safeGet('lyricEnableScale') !== 'false',
  setLyricEnableScale: (v: boolean) => safeSet('lyricEnableScale', String(v)),

  getLyricHidePassedLines: () => safeGet('lyricHidePassedLines') === 'true',
  setLyricHidePassedLines: (v: boolean) => safeSet('lyricHidePassedLines', String(v)),

  getLyricShowBottomLine: () => safeGet('lyricShowBottomLine') !== 'false',
  setLyricShowBottomLine: (v: boolean) => safeSet('lyricShowBottomLine', String(v)),

  getLyricMaskObsceneWordsMode: () =>
    safeEnum('lyricMaskObsceneWordsMode', LYRIC_MASK_MODES, SETTING_DEFAULTS.lyricMaskObsceneWordsMode),
  setLyricMaskObsceneWordsMode: (v: (typeof LYRIC_MASK_MODES)[number]) => safeSet('lyricMaskObsceneWordsMode', v),

  getLyricMaskObsceneWordChar: () =>
    safeGet('lyricMaskObsceneWordChar')?.slice(0, 1) || SETTING_DEFAULTS.lyricMaskObsceneWordChar,
  setLyricMaskObsceneWordChar: (v: string) =>
    safeSet('lyricMaskObsceneWordChar', v.slice(0, 1) || SETTING_DEFAULTS.lyricMaskObsceneWordChar),

  getLyricWordFadeWidth: () => {
    const width = safeFloat('lyricWordFadeWidth', SETTING_DEFAULTS.lyricWordFadeWidth)
    return Math.max(0.05, Math.min(2, width))
  },
  setLyricWordFadeWidth: (v: number) => safeSet('lyricWordFadeWidth', String(v)),

  getLyricFontWeight: () => {
    const w = safeInt('lyricFontWeight', SETTING_DEFAULTS.lyricFontWeight)
    return Math.max(100, Math.min(900, w))
  },
  setLyricFontWeight: (v: number) => safeSet('lyricFontWeight', String(v)),

  getLyricFontSize: () => {
    const size = safeInt('lyricFontSize', SETTING_DEFAULTS.lyricFontSize)
    return Math.max(10, Math.min(200, size))
  },
  setLyricFontSize: (v: number) => safeSet('lyricFontSize', String(v)),

  getLyricTranslationFontSize: () => {
    const size = safeInt('lyricTranslationFontSize', SETTING_DEFAULTS.lyricTranslationFontSize)
    return Math.max(10, Math.min(200, size))
  },
  setLyricTranslationFontSize: (v: number) => safeSet('lyricTranslationFontSize', String(v)),

  getLyricRomanFontSize: () => {
    const size = safeInt('lyricRomanFontSize', SETTING_DEFAULTS.lyricRomanFontSize)
    return Math.max(10, Math.min(200, size))
  },
  setLyricRomanFontSize: (v: number) => safeSet('lyricRomanFontSize', String(v)),

  getLyricOffsets: () => {
    const stored = safeGetJSON<Record<string, unknown>>('lyricOffsets')
    if (!stored) return {}
    return Object.fromEntries(
      Object.entries(stored).flatMap(([key, value]) =>
        typeof value === 'number' && Number.isFinite(value) ? [[key, Math.max(-10_000, Math.min(10_000, value))]] : [],
      ),
    )
  },
  setLyricOffsets: (offsets: Record<string, number>) => safeSetJSON('lyricOffsets', offsets),

  // TTML 在线逐词歌词
  getTtmlEnabled: () => safeGet('ttmlEnabled') !== 'false', // 默认开启
  setTtmlEnabled: (v: boolean) => safeSet('ttmlEnabled', String(v)),

  getTtmlDbUrl: () => safeGet('ttmlDbUrl') || SETTING_DEFAULTS.ttmlDbUrl,
  setTtmlDbUrl: (v: string) => safeSet('ttmlDbUrl', v),

  // Background settings
  getBgFps: () => {
    const fps = safeInt('bgFps', SETTING_DEFAULTS.bgFps)
    return [15, 30, 60].includes(fps) ? fps : SETTING_DEFAULTS.bgFps
  },
  setBgFps: (v: number) => safeSet('bgFps', String(v)),

  getBgFlowSpeed: () => {
    const speed = safeFloat('bgFlowSpeed', SETTING_DEFAULTS.bgFlowSpeed)
    return Math.max(0.5, Math.min(5, speed))
  },
  setBgFlowSpeed: (v: number) => safeSet('bgFlowSpeed', String(v)),

  getBgRenderScale: () => {
    const scale = safeFloat('bgRenderScale', SETTING_DEFAULTS.bgRenderScale)
    return [0.25, 0.5, 0.75, 1].includes(scale) ? scale : SETTING_DEFAULTS.bgRenderScale
  },
  setBgRenderScale: (v: number) => safeSet('bgRenderScale', String(v)),

  // Mineradio 舞台设置
  getVisualStage: () => safeEnum('visualStage', VISUAL_STAGES, SETTING_DEFAULTS.visualStage),
  setVisualStage: (v: VisualStageSetting) => safeSet('visualStage', v),

  getVisualQuality: () => safeEnum('visualQuality', VISUAL_QUALITIES, SETTING_DEFAULTS.visualQuality),
  setVisualQuality: (v: VisualQualitySetting) => safeSet('visualQuality', v),

  // 粒子溢光（上游 fx.bloom，出厂 false）。与画质档无关 —— 上游把它作为
  // 独立设置项（04-fx-defaults.js:91），不随 performanceQuality 变。
  getVisualBloom: () => safeGet('visualBloom') === 'true',
  setVisualBloom: (v: boolean) => safeSet('visualBloom', String(v)),

  // 轮廓高亮（上游 fx.edge，出厂 false）。同为独立设置，与画质档无关。
  getVisualEdge: () => safeGet('visualEdge') === 'true',
  setVisualEdge: (v: boolean) => safeSet('visualEdge', String(v)),

  getLyricRenderer: () => safeEnum('lyricRenderer', LYRIC_RENDERERS, SETTING_DEFAULTS.lyricRenderer),
  setLyricRenderer: (v: LyricRendererSetting) => safeSet('lyricRenderer', v),

  // 3D 歌词外观
  getLyricMotion: () => safeEnum('lyricMotion', LYRIC_MOTIONS, SETTING_DEFAULTS.lyricMotion),
  setLyricMotion: (v: LyricMotionSetting) => safeSet('lyricMotion', v),

  getLyricDisplayMode3d: () =>
    safeEnum('lyricDisplayMode3d', LYRIC_DISPLAY_SETTINGS, SETTING_DEFAULTS.lyricDisplayMode3d),
  setLyricDisplayMode3d: (v: LyricDisplaySetting) => safeSet('lyricDisplayMode3d', v),

  getLyricCustomLineCount: () => {
    const count = safeInt('lyricCustomLineCount', SETTING_DEFAULTS.lyricCustomLineCount)
    return Math.max(1, Math.min(10, count))
  },
  setLyricCustomLineCount: (v: number) => safeSet('lyricCustomLineCount', String(v)),

  getLyricTranslationMode3d: () =>
    safeEnum('lyricTranslationMode3d', LYRIC_TRANSLATION_SETTINGS, SETTING_DEFAULTS.lyricTranslationMode3d),
  setLyricTranslationMode3d: (v: LyricTranslationSetting) => safeSet('lyricTranslationMode3d', v),

  // Auth cookie persistence
  getAuthCookies: (): StoredCookie[] => safeGetJSON<StoredCookie[]>('auth-cookies') ?? [],
  setAuthCookies: (cookies: StoredCookie[]) => safeSetJSON('auth-cookies', cookies),

  upsertAuthCookie: (platform: MusicSource, cookie: string) => {
    const list = (safeGetJSON<StoredCookie[]>('auth-cookies') ?? []).filter((c) => c.platform !== platform)
    list.push({ platform, cookie })
    safeSetJSON('auth-cookies', list)
  },

  removeAuthCookie: (platform: MusicSource) => {
    const list = (safeGetJSON<StoredCookie[]>('auth-cookies') ?? []).filter((c) => c.platform !== platform)
    safeSetJSON('auth-cookies', list)
  },

  hasAuthCookie: (platform: MusicSource): boolean => {
    const list = safeGetJSON<StoredCookie[]>('auth-cookies') ?? []
    return list.some((c) => c.platform === platform)
  },

  getRejoinToken: (roomId: string): string | null => {
    const data = safeGetJSON<StoredRejoinToken>('rejoin-token')
    if (!data) return null
    if (data.roomId !== roomId) return null
    if (data.expiresAt <= Date.now()) return null
    return data.token
  },
  setRejoinToken: (roomId: string, token: string, expiresAt: number) =>
    safeSetJSON('rejoin-token', { roomId, token, expiresAt } satisfies StoredRejoinToken),
  clearRejoinToken: (roomId?: string) => {
    const data = safeGetJSON<StoredRejoinToken>('rejoin-token')
    if (!data) return
    if (roomId && data.roomId !== roomId) return
    safeRemove('rejoin-token')
  },
}

/** Shape stored in localStorage for auth cookies */
export interface StoredCookie {
  platform: MusicSource
  cookie: string
}

interface StoredRejoinToken {
  roomId: string
  token: string
  expiresAt: number
}
