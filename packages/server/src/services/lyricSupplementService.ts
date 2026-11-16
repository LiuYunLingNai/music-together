import {
  isLyricMatchAcceptable,
  isPureMusicLyricText,
  LYRIC_SUPPLEMENT_SOURCE_IDS,
  MUSIC_SOURCE_CAPABILITIES,
  normalizeLyricMatchText,
  scoreLyricMatch,
  type LyricMatchScore,
  type MusicSource,
  type Track,
} from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import type { AmllLyricLine, LyricResult } from './musicProvider.js'

const SUPPLEMENT_TIMEOUT_MS = 2_500
const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1_000
const EMPTY_SUPPLEMENT: LyricSupplementResult = {
  source: null,
  lyric: '',
  lyricId: '',
  title: '',
  artist: [],
  duration: 0,
}
const SUPPLEMENT_SOURCES = LYRIC_SUPPLEMENT_SOURCE_IDS.filter(
  (source) => MUSIC_SOURCE_CAPABILITIES[source].lyrics.supplement,
)

export interface LyricSupplementRequest {
  source: MusicSource
  lyricId: string
  title: string
  artists: string[]
  duration: number
  /** 平台给的另一种歌名（原名/译名）；按显示歌名搜不到时换它再搜一次。 */
  originalTitle?: string
  /** 平台给的另一位歌手写法（音译/旧名）。 */
  alternateArtist?: string
}

export interface LyricSupplementCandidate {
  source: (typeof SUPPLEMENT_SOURCES)[number]
  lyricId: string
  title: string
  artist: string[]
  duration: number
  lyric: string
  tlyric?: string
  romalrc?: string
  yrc?: string
  wordByWord?: AmllLyricLine[]
  wordLyric?: string
  wordFormat?: LyricResult['wordFormat']
  /** Identity score used to pick this candidate; exposed for diagnostics and future UI. */
  matchScore?: LyricMatchScore
}

export interface LyricSupplementResult extends Omit<LyricSupplementCandidate, 'source'> {
  source: LyricSupplementCandidate['source'] | null
  candidates?: LyricSupplementCandidate[]
}

export interface LyricSupplementProvider {
  search(source: MusicSource, keyword: string, limit?: number, page?: number): Promise<Track[]>
  getLyric(source: MusicSource, lyricId: string): Promise<LyricResult>
}

function selectMatchingTrack(
  request: LyricSupplementRequest,
  tracks: Track[],
): { track: Track; matchScore: LyricMatchScore } | null {
  const scored = tracks
    .map((track) => ({
      track,
      matchScore: scoreLyricMatch(
        { title: request.title, artists: request.artists, duration: request.duration },
        { title: track.title, artists: track.artist, album: track.album, duration: track.duration },
      ),
    }))
    .filter(({ matchScore }) => isLyricMatchAcceptable(matchScore))
    .sort((left, right) => {
      if (right.matchScore.score !== left.matchScore.score) return right.matchScore.score - left.matchScore.score
      const durationDifference =
        Math.abs(left.track.duration - request.duration) - Math.abs(right.track.duration - request.duration)
      if (durationDifference !== 0) return durationDifference
      return left.track.artist.length - right.track.artist.length
    })
  return scored[0] ?? null
}

/** 伴奏/卡拉 OK 版本不能拿原名去搜，否则会配上原唱的逐字歌词。 */
const INSTRUMENTAL_MARKER = /伴奏|伴唱|纯音乐|instrumental|off\s*vocal|カラオケ|karaoke|\binst\.?\b/i

/** 按显示歌名搜不到时，用平台给的另一种歌名/歌手写法再搜一次；没有可用别名时返回 null。 */
function aliasRequest(request: LyricSupplementRequest): (LyricSupplementRequest & { keyword: string }) | null {
  const aliasTitle = request.originalTitle?.trim() ?? ''
  const aliasArtist = request.alternateArtist?.trim() ?? ''
  const titleChanged = Boolean(aliasTitle) && aliasTitle !== request.title
  const artistChanged = Boolean(aliasArtist) && aliasArtist !== request.artists.join(', ')
  if (!titleChanged && !artistChanged) return null
  if (INSTRUMENTAL_MARKER.test(request.title) || (titleChanged && INSTRUMENTAL_MARKER.test(aliasTitle))) return null
  const title = titleChanged ? aliasTitle : request.title
  const artists = artistChanged
    ? aliasArtist.split(/\s*[,、&/]\s*/).map((name) => name.trim()).filter(Boolean)
    : request.artists
  if (artists.length === 0) return null
  return { ...request, title, artists, keyword: `${title} ${artists.join(' ')}` }
}

export class LyricSupplementService {
  private readonly cache = new LRUCache<string, LyricSupplementResult>({ max: 500, ttl: SUCCESS_CACHE_TTL_MS })
  private readonly inFlight = new Map<string, Promise<LyricSupplementResult>>()

  constructor(private readonly provider: LyricSupplementProvider) {}

  async getSupplement(request: LyricSupplementRequest): Promise<LyricSupplementResult> {
    const key = [request.source, request.lyricId, normalizeLyricMatchText(request.title), request.duration].join(':')
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
    const alias = aliasRequest(request)
    const sources = SUPPLEMENT_SOURCES.filter((source) => source !== request.source)
    const candidates = await Promise.all(
      sources.map(async (source): Promise<LyricSupplementCandidate | null> => {
        try {
          let match = selectMatchingTrack(request, await this.provider.search(source, keyword, 10, 1))
          if (!match && alias) {
            // 显示歌名在别的平台是译名时按原名/另一种写法再搜一次；匹配也用别名算分。
            match = selectMatchingTrack(alias, await this.provider.search(source, alias.keyword, 10, 1))
          }
          if (!match) return null
          const lyric = await this.provider.getLyric(source, match.track.lyricId ?? match.track.sourceId)
          if (!lyric.lyric && !lyric.yrc && !lyric.wordLyric && !lyric.wordByWord?.length) return null
          if (isPureMusicLyricText(lyric.lyric)) return null
          return {
            source,
            lyricId: match.track.lyricId ?? match.track.sourceId,
            title: match.track.title,
            artist: match.track.artist,
            duration: match.track.duration,
            lyric: lyric.lyric,
            tlyric: lyric.tlyric,
            romalrc: lyric.romalrc,
            yrc: lyric.yrc,
            wordByWord: lyric.wordByWord,
            wordLyric: lyric.wordLyric,
            wordFormat: lyric.wordFormat,
            matchScore: match.matchScore,
          }
        } catch {
          return null
        }
      }),
    ).then((results) => results.filter((candidate): candidate is LyricSupplementCandidate => candidate !== null))

    if (candidates.length === 0) return EMPTY_SUPPLEMENT
    const legacyCandidate =
      candidates.find((candidate) => candidate.wordByWord?.length || candidate.wordLyric || candidate.yrc) ??
      candidates[0]
    return { ...legacyCandidate, candidates }
  }
}
