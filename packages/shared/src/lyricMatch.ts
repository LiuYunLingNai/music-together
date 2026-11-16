/**
 * Pure lyric-candidate matching shared by the server supplement search and, later, the client
 * matching UI. The score is an adaptation of folia's title/artist/album/duration weighting:
 * title 45, artist 25, album 30, multiplied by a duration factor, with a 75-point floor.
 */

export const LYRIC_MATCH_MIN_SCORE = 75

const TITLE_WEIGHT = 45
const ARTIST_WEIGHT = 25
const ALBUM_WEIGHT = 30
const TITLE_MATCH_THRESHOLD = 0.85
const ARTIST_MATCH_THRESHOLD = 0.7
const NEUTRAL_ALBUM_SIMILARITY = 0.75

export interface LyricMatchRequest {
  title: string
  artists: string[]
  album?: string
  duration?: number
}

export interface LyricMatchCandidate {
  title: string
  artists: string[]
  album?: string
  duration?: number
}

export interface LyricMatchScore {
  score: number
  titleMatched: boolean
  artistMatched: boolean
  albumMatched: boolean
  titleSimilarity: number
  artistSimilarity: number
  albumSimilarity: number
  durationFactor: number
}

const ARTIST_SEPARATOR = /\s*(?:,|&|、|\/|;|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bvs\.?\b)\s*/i

/** Normalize text for identity comparison: width, case, punctuation and trailing feat credits. */
export function normalizeLyricMatchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[([{]\s*(?:feat|ft|featuring)\.?\s+[^)\]}]+[)\]}]/gi, ' ')
    .replace(/\b(?:feat|ft|featuring)\.?\s+[^()[\]{}]+$/i, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function splitArtists(value: string): string[] {
  return value.split(ARTIST_SEPARATOR).map(normalizeLyricMatchText).filter(Boolean)
}

function textSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (longer.includes(shorter)) {
    return Math.max(0.6, shorter.length / longer.length)
  }
  const leftChars = new Set(left)
  const rightChars = new Set(right)
  let shared = 0
  for (const char of leftChars) {
    if (rightChars.has(char)) shared += 1
  }
  return shared / (leftChars.size + rightChars.size - shared)
}

function artistSimilarity(requestArtists: string[], candidateArtists: string[]): number {
  if (requestArtists.length === 0) return 0
  if (candidateArtists.length === 0) return 0
  return (
    requestArtists.reduce(
      (total, requestArtist) =>
        total + Math.max(...candidateArtists.map((candidateArtist) => textSimilarity(requestArtist, candidateArtist))),
      0,
    ) / requestArtists.length
  )
}

function durationFactor(requestDuration?: number, candidateDuration?: number): number {
  if (!Number.isFinite(requestDuration) || !Number.isFinite(candidateDuration)) return 0.9
  const difference = Math.abs((requestDuration as number) - (candidateDuration as number))
  if (difference <= 1) return 1
  if (difference <= 3) return 0.95
  if (difference <= 5) return 0.75
  if (difference <= 10) return 0.35
  return 0.1
}

export function scoreLyricMatch(request: LyricMatchRequest, candidate: LyricMatchCandidate): LyricMatchScore {
  const titleSimilarity = textSimilarity(
    normalizeLyricMatchText(request.title),
    normalizeLyricMatchText(candidate.title),
  )
  const requestArtists = request.artists.flatMap(splitArtists)
  const candidateArtists = candidate.artists.flatMap(splitArtists)
  const artistsSimilarity = artistSimilarity(requestArtists, candidateArtists)
  const requestAlbum = request.album ? normalizeLyricMatchText(request.album) : ''
  const candidateAlbum = candidate.album ? normalizeLyricMatchText(candidate.album) : ''
  const albumsSimilarity =
    requestAlbum && candidateAlbum ? textSimilarity(requestAlbum, candidateAlbum) : NEUTRAL_ALBUM_SIMILARITY
  const factor = durationFactor(request.duration, candidate.duration)
  const score = Math.round(
    (TITLE_WEIGHT * titleSimilarity + ARTIST_WEIGHT * artistsSimilarity + ALBUM_WEIGHT * albumsSimilarity) * factor,
  )
  return {
    score,
    titleMatched: titleSimilarity >= TITLE_MATCH_THRESHOLD,
    artistMatched: requestArtists.length === 0 || artistsSimilarity >= ARTIST_MATCH_THRESHOLD,
    albumMatched: albumsSimilarity >= ARTIST_MATCH_THRESHOLD,
    titleSimilarity,
    artistSimilarity: artistsSimilarity,
    albumSimilarity: albumsSimilarity,
    durationFactor: factor,
  }
}

/** A candidate must at least match the title and artist chain before the 75-point floor applies. */
export function isLyricMatchAcceptable(match: LyricMatchScore): boolean {
  return match.titleMatched && match.artistMatched && match.score >= LYRIC_MATCH_MIN_SCORE
}
