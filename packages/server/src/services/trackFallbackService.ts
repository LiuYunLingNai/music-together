import {
  isLyricMatchAcceptable,
  normalizeLyricMatchText,
  scoreLyricMatch,
  type MusicSource,
  type Track,
} from '@music-together/shared'
import { musicProvider } from './musicProvider.js'

// Keep scope minimal: only support netease <-> tencent <-> kugou auto fallback.
const SUPPORTED_SOURCES: ReadonlySet<MusicSource> = new Set(['netease', 'tencent', 'kugou', 'kugou_concept'])

export interface FallbackCandidate {
  track: Track
  score: number
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[’'"“”]/g, '')
    .replace(/[\(\)\[\]【】]/g, ' ')
    .replace(/[\-—_·•:：,，.。/\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeArtists(artists: string[]): string[] {
  const parts: string[] = []
  for (const a of artists) {
    const s = normalizeText(a)
    if (!s) continue
    // Split common separators and feat markers
    for (const p of s.split(/\s*(?:&|,|\/|×|feat|ft|with)\s*/g)) {
      const v = p.trim()
      if (v) parts.push(v)
    }
  }
  // De-dupe while keeping order
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

type VersionTag = 'live' | 'remix' | 'instrumental' | 'cover'

function versionTag(title: string): VersionTag | null {
  const t = normalizeText(title)
  if (/(live|现场)/.test(t)) return 'live'
  if (/(remix|混音)/.test(t)) return 'remix'
  if (/(instrumental|伴奏|纯音乐)/.test(t)) return 'instrumental'
  if (/翻唱/.test(t)) return 'cover'
  return null
}

function durationOk(original: Track, candidate: Track): boolean {
  // duration is seconds (see shared types); allow 0 when unknown
  if (!original.duration || !candidate.duration) return true
  return Math.abs(original.duration - candidate.duration) <= 10
}

function scoreCandidate(original: Track, candidate: Track): number | null {
  if (!durationOk(original, candidate)) return null
  if (versionTag(original.title) !== versionTag(candidate.title)) return null

  const match = scoreLyricMatch(
    { title: original.title, artists: original.artist, duration: original.duration },
    { title: candidate.title, artists: candidate.artist, duration: candidate.duration },
  )
  return isLyricMatchAcceptable(match) ? match.score : null
}

export function getFallbackTargetSource(from: MusicSource): MusicSource | null {
  if (from === 'netease') return 'tencent'
  if (from === 'tencent') return 'netease'
  if (from === 'kugou') return 'netease'
  if (from === 'kugou_concept') return 'netease'
  return null
}

export function isFallbackSource(source: MusicSource): boolean {
  return SUPPORTED_SOURCES.has(source)
}

function sortCandidates(scored: FallbackCandidate[], original: Track): FallbackCandidate[] {
  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const durationDifference =
      Math.abs(a.track.duration - original.duration) - Math.abs(b.track.duration - original.duration)
    if (durationDifference !== 0) return durationDifference
    return a.track.artist.length - b.track.artist.length
  })
}

async function searchScored(original: Track, source: MusicSource): Promise<FallbackCandidate[]> {
  const artists = normalizeArtists(original.artist)
  const primaryArtist = artists[0] ?? ''
  const keyword = `${original.title} ${primaryArtist}`.trim()

  let candidates = await musicProvider.search(source, keyword, 8, 1)
  if (!candidates.length && primaryArtist) {
    // Cross-platform artist names differ often enough that a title-only retry is worth one extra request.
    candidates = await musicProvider.search(source, original.title, 8, 1)
  }

  const scored: FallbackCandidate[] = []
  for (const candidate of candidates) {
    const score = scoreCandidate(original, candidate)
    if (score === null) continue
    scored.push({ track: candidate, score })
  }
  return sortCandidates(scored, original)
}

/** Scored cross-source candidates for the manual source picker, best first. */
export async function findAlternativeTracks(original: Track, limit = 10): Promise<FallbackCandidate[]> {
  const sources = [...SUPPORTED_SOURCES].filter((source) => source !== original.source)
  const groups = await Promise.all(
    sources.map((source) => searchScored(original, source).catch(() => [] as FallbackCandidate[])),
  )
  const seen = new Set<string>()
  return sortCandidates(groups.flat(), original)
    .filter((candidate) => {
      const key = `${candidate.track.source}:${candidate.track.sourceId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

export async function findBestAlternativeTrack(
  original: Track,
  toSource: MusicSource,
): Promise<FallbackCandidate | null> {
  if (!SUPPORTED_SOURCES.has(original.source)) return null
  if (!SUPPORTED_SOURCES.has(toSource)) return null
  if (original.source === toSource) return null

  const scored = await searchScored(original, toSource)
  const best = scored[0]
  const second = scored[1]

  if (!best) return null

  // Ambiguous identities are worse than no fallback; duplicate entries of the same song are fine.
  const identity = (track: Track) =>
    `${normalizeLyricMatchText(track.title)}\u0002${track.artist.map(normalizeLyricMatchText).sort().join(',')}`
  if (second && identity(best.track) !== identity(second.track) && best.score - second.score < 5) return null

  return best
}
