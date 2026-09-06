import type { MusicSource, Track } from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import type { AmllLyricLine, LyricResult } from './musicProvider.js'

const SUPPLEMENT_TIMEOUT_MS = 2_500
const DURATION_TOLERANCE_SECONDS = 3
const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1_000
const EMPTY_SUPPLEMENT: LyricSupplementResult = { source: null, lyric: '' }
const SUPPLEMENT_SOURCES = ['netease', 'kugou', 'tencent'] as const

export interface LyricSupplementRequest {
  source: MusicSource
  lyricId: string
  title: string
  artists: string[]
  duration: number
}

export interface LyricSupplementCandidate {
  source: (typeof SUPPLEMENT_SOURCES)[number]
  lyric: string
  tlyric?: string
  romalrc?: string
  yrc?: string
  wordByWord?: AmllLyricLine[]
}

export interface LyricSupplementResult extends Omit<LyricSupplementCandidate, 'source'> {
  source: LyricSupplementCandidate['source'] | null
  candidates?: LyricSupplementCandidate[]
}

export interface LyricSupplementProvider {
  search(source: MusicSource, keyword: string, limit?: number, page?: number): Promise<Track[]>
  getLyric(source: MusicSource, lyricId: string): Promise<LyricResult>
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function selectMatchingTrack(request: LyricSupplementRequest, tracks: Track[]): Track | null {
  const title = normalizeIdentity(request.title)
  const artists = new Set(request.artists.map(normalizeIdentity).filter(Boolean))

  const matches = tracks.filter((track) => {
    if (normalizeIdentity(track.title) !== title) return false
    if (!Number.isFinite(track.duration) || Math.abs(track.duration - request.duration) > DURATION_TOLERANCE_SECONDS) {
      return false
    }
    const candidateArtists = new Set(track.artist.map(normalizeIdentity).filter(Boolean))
    return artists.size > 0 && [...artists].every((artist) => candidateArtists.has(artist))
  })

  return (
    matches.sort((left, right) => {
      const durationDifference = Math.abs(left.duration - request.duration) - Math.abs(right.duration - request.duration)
      if (durationDifference !== 0) return durationDifference
      return left.artist.length - right.artist.length
    })[0] ?? null
  )
}

export class LyricSupplementService {
  private readonly cache = new LRUCache<string, LyricSupplementResult>({ max: 500, ttl: SUCCESS_CACHE_TTL_MS })
  private readonly inFlight = new Map<string, Promise<LyricSupplementResult>>()

  constructor(private readonly provider: LyricSupplementProvider) {}

  async getSupplement(request: LyricSupplementRequest): Promise<LyricSupplementResult> {
    const key = [request.source, request.lyricId, normalizeIdentity(request.title), request.duration].join(':')
    const cached = this.cache.get(key)
    if (cached) return cached

    let task = this.inFlight.get(key)
    if (!task) {
      task = this.resolveSupplement(request)
        .then((result) => {
          this.cache.set(key, result, { ttl: result.source ? SUCCESS_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS })
          return result
        })
        .finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, task)
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        task,
        new Promise<LyricSupplementResult>((resolve) => {
          timeout = setTimeout(() => resolve(EMPTY_SUPPLEMENT), SUPPLEMENT_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private async resolveSupplement(request: LyricSupplementRequest): Promise<LyricSupplementResult> {
    const keyword = `${request.title} ${request.artists.join(' ')}`
    const sources = SUPPLEMENT_SOURCES.filter((source) => source !== request.source)
    const candidates = await Promise.all(
      sources.map(async (source): Promise<LyricSupplementCandidate | null> => {
      try {
        const tracks = await this.provider.search(source, keyword, 10, 1)
        const track = selectMatchingTrack(request, tracks)
        if (!track) return null
        const lyric = await this.provider.getLyric(source, track.lyricId ?? track.sourceId)
        if (!lyric.lyric && !lyric.yrc && !lyric.wordByWord?.length) return null
        return {
          source,
          lyric: lyric.lyric,
          tlyric: lyric.tlyric,
          romalrc: lyric.romalrc,
          yrc: lyric.yrc,
          wordByWord: lyric.wordByWord,
        }
      } catch {
        return null
      }
      }),
    ).then((results) => results.filter((candidate): candidate is LyricSupplementCandidate => candidate !== null))

    if (candidates.length === 0) return EMPTY_SUPPLEMENT
    const legacyCandidate =
      candidates.find((candidate) => candidate.wordByWord?.length || candidate.yrc) ?? candidates[0]
    return { ...legacyCandidate, candidates }
  }
}
