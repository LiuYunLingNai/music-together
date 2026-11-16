import type { MusicSource, Track } from '@music-together/shared'
import { getLyricOffsetKey } from './lyricOffset'

export interface PlatformLyricSourceOverride {
  kind: 'platform'
  source: MusicSource
  lyricId: string
  title: string
  artist: string[]
}

export interface TtmlLyricSourceOverride {
  kind: 'ttml'
  platform: 'ncm' | 'qq'
  id: string
  title: string
  artist: string[]
}

export type LyricSourceOverride = PlatformLyricSourceOverride | TtmlLyricSourceOverride

const STORAGE_KEY = 'lyricSourceOverrides'
const MAX_ENTRIES = 200
const listeners = new Set<() => void>()

function normalizeOverride(value: unknown): LyricSourceOverride | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as {
    kind?: string
    platform?: string
    id?: string
    source?: unknown
    lyricId?: unknown
    title?: unknown
    artist?: unknown
  }
  if (typeof entry.title !== 'string' || !Array.isArray(entry.artist)) return null
  const title = entry.title
  const artist = entry.artist.filter((item): item is string => typeof item === 'string')

  if (entry.kind === 'ttml') {
    if ((entry.platform === 'ncm' || entry.platform === 'qq') && typeof entry.id === 'string') {
      return { kind: 'ttml', platform: entry.platform, id: entry.id, title, artist }
    }
    return null
  }
  if (typeof entry.source === 'string' && typeof entry.lyricId === 'string') {
    return {
      kind: 'platform',
      source: entry.source as MusicSource,
      lyricId: entry.lyricId,
      title,
      artist,
    }
  }
  return null
}

function readOverrides(): Record<string, LyricSourceOverride> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, normalizeOverride(value)] as const)
        .filter((entry): entry is [string, LyricSourceOverride] => entry[1] !== null),
    )
  } catch {
    return {}
  }
}

function writeOverrides(overrides: Record<string, LyricSourceOverride>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    /* Storage can be unavailable in private mode; the override simply won't persist. */
  }
}

export function getLyricSourceOverride(track: Track | null): LyricSourceOverride | null {
  const key = getLyricOffsetKey(track)
  return key ? (readOverrides()[key] ?? null) : null
}

export function setLyricSourceOverride(track: Track | null, override: LyricSourceOverride | null): void {
  const key = getLyricOffsetKey(track)
  if (!key) return
  const overrides = readOverrides()
  if (override) overrides[key] = override
  else delete overrides[key]
  const entries = Object.entries(overrides)
  writeOverrides(Object.fromEntries(entries.slice(-MAX_ENTRIES)))
  for (const listener of listeners) listener()
}

export function subscribeLyricSourceOverride(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
