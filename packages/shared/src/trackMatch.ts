import { scoreLyricMatch, type LyricMatchScore } from './lyricMatch.js'

/** 版本标签：同名但不同版本的歌不应合并成同一首。 */
export type TrackVersionTag = 'live' | 'remix' | 'instrumental' | 'cover'

export interface TrackMatchInput {
  title: string
  artist: string[]
  album?: string
  duration?: number
}

export interface TrackMatchScore extends LyricMatchScore {
  version: TrackVersionTag | null
  versionCompatible: boolean
}

const ARTIST_SEPARATOR = /\s*(?:&|,|\/|×|、|;|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b)\s*/gi

/** Normalize a title/artist for identity comparison. */
export function normalizeTrackText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(/[’'"“”]/g, '')
    .replace(/[()[\]【】]/g, ' ')
    .replace(/[-—_·•:：,，.。/\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split multi-artist strings and normalize each name. */
export function normalizeTrackArtists(artists: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const artist of artists) {
    for (const part of artist.split(ARTIST_SEPARATOR)) {
      const value = normalizeTrackText(part)
      if (!value || seen.has(value)) continue
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

export function trackVersionTag(title: string): TrackVersionTag | null {
  const text = normalizeTrackText(title)
  if (/(live|现场)/.test(text)) return 'live'
  if (/(remix|混音)/.test(text)) return 'remix'
  if (/(instrumental|伴奏|纯音乐)/.test(text)) return 'instrumental'
  if (/翻唱/.test(text)) return 'cover'
  return null
}

/**
 * 两首歌的相似度（0–100）。`scoreLyricMatch` 负责标题/艺人/时长权重，
 * 这里补上版本标签，供跨源统一搜索与换源评分共用。
 */
export function scoreTrackMatch(reference: TrackMatchInput, candidate: TrackMatchInput): TrackMatchScore {
  const match = scoreLyricMatch(
    { title: reference.title, artists: reference.artist, album: reference.album, duration: reference.duration },
    { title: candidate.title, artists: candidate.artist, album: candidate.album, duration: candidate.duration },
  )
  const referenceVersion = trackVersionTag(reference.title)
  const candidateVersion = trackVersionTag(candidate.title)
  const versionCompatible =
    referenceVersion === candidateVersion || (referenceVersion === null && candidateVersion === null)
  return {
    ...match,
    version: candidateVersion,
    versionCompatible,
  }
}
