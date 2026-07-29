import Meting from '@meting/core'
import { get as kugouLrcGet, Format } from '@s4p/kugou-lrc'
import type { KrcInfo } from '@s4p/kugou-lrc'
import type { AudioQuality, BilibiliStreamFormat, MusicSource, Track } from '@music-together/shared'
import { LRUCache } from 'lru-cache'
import { nanoid } from 'nanoid'
import pLimit from 'p-limit'
import ncmApi from '@neteasecloudmusicapienhanced/api'
import * as kugouAuth from './kugouAuthService.js'
import * as tencentAuth from './tencentAuthService.js'
import * as bilibiliAuth from './bilibiliAuthService.js'
import { getKugouQualityFallbacks } from './audioQualityPolicy.js'
import { collectBilibiliAudioCandidates, selectBilibiliAudioCandidate } from './bilibiliAudioQuality.js'
import { config } from '../config.js'
import { parseCookieString } from '../utils/cookieUtils.js'
import { logger } from '../utils/logger.js'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const generateNeteaseConfig = require('@neteasecloudmusicapienhanced/api/generateConfig') as () => Promise<void> | void
let neteaseConfigReady: Promise<boolean> | null = null

function isXeapiPublicKeyMissing(err: unknown): boolean {
  return String(err instanceof Error ? err.message : err).includes('xeapi public key is missing')
}

function ensureNeteaseEnhancedConfig(force = false): Promise<boolean> {
  if (force) neteaseConfigReady = null
  if (!neteaseConfigReady) {
    neteaseConfigReady = Promise.resolve()
      .then(() => generateNeteaseConfig())
      .then(() => true)
      .catch((err: unknown) => {
        neteaseConfigReady = null
        logger.warn('Netease enhanced API config initialization failed', { err })
        return false
      })
  }
  return neteaseConfigReady
}

/** AMLL LyricLine 格式（与 @applemusic-like-lyrics/core 一致，避免引入 client 依赖） */
interface AmllLyricLine {
  words: Array<{ word: string; startTime: number; endTime: number; romanWord: string; obscene: boolean }>
  translatedLyric: string
  romanLyric: string
  startTime: number
  endTime: number
  isBG: boolean
  isDuet: boolean
}

/** 将 KRC 解析结果转为 AMLL LyricLine 格式 */
function krcToAmllLines(krcInfo: KrcInfo): AmllLyricLine[] {
  if (!krcInfo.items?.length) return []
  return krcInfo.items.map((line) => {
    if (!line.length) {
      return {
        words: [],
        translatedLyric: '',
        romanLyric: '',
        startTime: 0,
        endTime: 0,
        isBG: false,
        isDuet: false,
      }
    }
    const words = line.map((w) => ({
      word: w.word,
      startTime: Math.round(w.offset * 1000),
      endTime: Math.round((w.offset + w.duration) * 1000),
      romanWord: '',
      obscene: false,
    }))
    const first = words[0]!
    const last = words[words.length - 1]!
    return {
      words,
      translatedLyric: '',
      romanLyric: '',
      startTime: first.startTime,
      endTime: last.endTime,
      isBG: false,
      isDuet: false,
    }
  })
}

// ---------------------------------------------------------------------------
// Meting instance type (library has no TS declarations)
// ---------------------------------------------------------------------------
type MetingInstance = InstanceType<typeof Meting>

/** Parsed JSON from Meting API responses */
type MetingJson = Record<string, unknown>

/** Stream metadata returned by the upstream provider. */
export interface StreamUrlResult {
  url: string
  /** Actual bitrate reported/selected by the provider, in kbps. */
  actualBitrate: number | null
  /** Exact provider quality selected when it can be determined. */
  actualQuality?: AudioQuality
  /** Provider file prefix/format, for example AI00 or F000 on QQ Music. */
  providerFormat?: string
  /** Browser codec hint for Bilibili's fragmented MP4 audio stream. */
  streamFormat?: BilibiliStreamFormat
  /** Expected upstream file size in bytes. */
  fileSize?: number
  fromCache: boolean
}

type CachedStreamUrl = Omit<StreamUrlResult, 'fromCache'>

/** Loosely typed ncmApi response (the library has no TS declarations). */
interface NcmApiResponse {
  body?: {
    code?: number
    songs?: Record<string, unknown>[]
    playlist?: Record<string, unknown>[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface QQMusicApiSearchResponse {
  code?: number
  msg?: string
  data?: unknown
}

interface QQMusicApiSearchSong {
  mid?: unknown
  name?: unknown
  singer?: unknown
  album?: unknown
  pmid?: unknown
  cover?: unknown
}

/** Tencent native desktop search API response. */
interface TencentSearchResponse {
  'music.search.SearchCgiService.DoSearchForQQMusicDesktop'?: {
    code?: number
    data?: {
      body?: {
        song?: {
          list?: TencentSearchSong[]
        }
      }
    }
  }
}

interface TencentSearchSong {
  mid?: string
  name?: string
  title?: string
  interval?: number
  singer?: Array<{ name?: string }>
  album?: {
    mid?: string
    name?: string
    pmid?: string
  }
  pay?: {
    pay_down?: number
    pay_month?: number
  }
  action?: {
    msgpay?: number
  }
}

interface TencentTrackInfo {
  mid?: string
  type?: number
  interval?: number
  vs?: unknown[]
  file?: {
    media_mid?: string
    size_128mp3?: number
    size_192aac?: number
    size_320mp3?: number
    size_flac?: number
    size_new?: unknown[]
  }
}

interface TencentVkeyResponse {
  req_0?: {
    code?: number
    data?: {
      sip?: unknown[]
      midurlinfo?: Array<{
        filename?: string
        purl?: string
        vkey?: string
        result?: number
      }>
    }
  }
}

interface TencentStreamSpec {
  quality: AudioQuality
  prefix: string
  extension: string
  mediaMid: string
  fileSize: number
}

interface BilibiliSearchVideo {
  bvid?: unknown
  title?: unknown
  author?: unknown
  duration?: unknown
  pic?: unknown
}

interface BilibiliViewData {
  aid: number
  cid: number
  cover: string
}

/** External API timeout (ms) */
const API_TIMEOUT_MS = 15_000

/** Race a promise against a timeout. Returns null on timeout. */
async function withTimeout<T>(promise: Promise<T>, ms = API_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Normalize cover URLs returned by Kugou's mobile APIs. */
function normalizeKugouCoverUrl(value: unknown, size = 300): string {
  let url = String(value || '')
    .trim()
    .replace(/\{size\}/g, String(size))
  if (!url) return ''
  if (url.startsWith('//')) url = `https:${url}`
  if (url.startsWith('http://')) url = url.replace(/^http:\/\//, 'https://')

  // imgessl is already handled by the client's cover proxy and is equivalent
  // to the older imge host returned in trans_param.union_cover.
  return url.replace(/^https:\/\/imge\.kugou\.com/i, 'https://imgessl.kugou.com')
}

function normalizeBilibiliCoverUrl(value: unknown): string {
  let url = String(value ?? '').trim()
  if (!url) return ''
  if (url.startsWith('//')) url = `https:${url}`
  if (url.startsWith('http://')) url = url.replace(/^http:\/\//, 'https://')
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`
  return url
}

/** Normalize provider bitrate values (some APIs use bps, others use kbps). */
function normalizeBitrate(value: unknown): number | null {
  const bitrate = Number(value)
  if (!Number.isFinite(bitrate) || bitrate <= 0) return null
  return Math.round(bitrate >= 10_000 ? bitrate / 1000 : bitrate)
}

type NeteaseSoundQualityLevel =
  | 'standard'
  | 'higher'
  | 'exhigh'
  | 'lossless'
  | 'dolby'
  | 'hires'
  | 'jyeffect'
  | 'jymaster'
  | 'sky'

function neteaseQualityToLevel(quality: AudioQuality): NeteaseSoundQualityLevel | null {
  switch (quality) {
    case 128:
      return 'standard'
    case 192:
      return 'higher'
    case 320:
      return 'exhigh'
    case 999:
      return 'lossless'
    case 'netease_dolby':
      return 'dolby'
    case 'netease_hires':
      return 'hires'
    case 'netease_jyeffect':
      return 'jyeffect'
    case 'netease_spatial':
      return 'sky'
    case 'netease_master':
      return 'jymaster'
    default:
      return null
  }
}

function neteaseLevelToQuality(level: unknown): AudioQuality | undefined {
  const qualities: Record<NeteaseSoundQualityLevel, AudioQuality> = {
    standard: 128,
    higher: 192,
    exhigh: 320,
    lossless: 999,
    dolby: 'netease_dolby',
    hires: 'netease_hires',
    jyeffect: 'netease_jyeffect',
    jymaster: 'netease_master',
    sky: 'netease_spatial',
  }
  return qualities[String(level ?? '').toLowerCase() as NeteaseSoundQualityLevel]
}

function qualityToBitrate(quality: AudioQuality): 128 | 192 | 320 | 999 {
  return typeof quality === 'number' ? quality : 999
}

function hashTencentGtk(value: string): number {
  let hash = 5381
  for (const character of value) hash += (hash << 5) + character.charCodeAt(0)
  return hash & 0x7fffffff
}

function positiveNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function getExactTencentStreamSpec(track: TencentTrackInfo, quality: AudioQuality): TencentStreamSpec | null {
  const file = track.file
  if (!file) return null

  const mediaMid = String(file.media_mid ?? '').trim()
  const variants = Array.isArray(track.vs) ? track.vs : []
  const modernSizes = Array.isArray(file.size_new) ? file.size_new : []

  switch (quality) {
    case 'tencent_master': {
      const masterMid = String(variants[3] ?? '').trim()
      const fileSize = positiveNumber(modernSizes[0])
      return masterMid && fileSize
        ? { quality, prefix: 'AI00', extension: '.flac', mediaMid: masterMid, fileSize }
        : null
    }
    case 'tencent_flac':
    case 999: {
      const fileSize = positiveNumber(file.size_flac)
      return mediaMid && fileSize
        ? { quality: 'tencent_flac', prefix: 'F000', extension: '.flac', mediaMid, fileSize }
        : null
    }
    case 320: {
      const fileSize = positiveNumber(file.size_320mp3)
      return mediaMid && fileSize ? { quality, prefix: 'M800', extension: '.mp3', mediaMid, fileSize } : null
    }
    case 192: {
      const fileSize = positiveNumber(file.size_192aac)
      return mediaMid && fileSize ? { quality, prefix: 'C600', extension: '.m4a', mediaMid, fileSize } : null
    }
    case 128: {
      const fileSize = positiveNumber(file.size_128mp3)
      return mediaMid && fileSize ? { quality, prefix: 'M500', extension: '.mp3', mediaMid, fileSize } : null
    }
    default:
      return null
  }
}

/** Select the best file the song provides without exceeding the membership-capped request. */
function getTencentStreamSpec(track: TencentTrackInfo, quality: AudioQuality): TencentStreamSpec | null {
  const ladder: AudioQuality[] = [128, 192, 320, 'tencent_flac', 'tencent_master']
  const requestedIndex = ladder.indexOf(quality)
  if (requestedIndex === -1) return null
  for (let index = requestedIndex; index >= 0; index -= 1) {
    const spec = getExactTencentStreamSpec(track, ladder[index])
    if (spec) return spec
  }
  return null
}

// Path to song list in raw (non-formatted) API response per platform
const SEARCH_PATHS: Record<MusicSource, string> = {
  netease: 'result.songs',
  tencent: 'data.song.list',
  kugou: 'data.info',
  kugou_concept: 'data.info',
  bilibili: '',
}

// Path to song list in raw playlist API response per platform
const PLAYLIST_PATHS: Record<MusicSource, string> = {
  netease: 'playlist.tracks', // Not used (Netease uses ncmApi)
  tencent: 'data.cdlist.0.songlist', // JS arrays support string numeric index
  kugou: 'data.info',
  kugou_concept: 'data.info',
  bilibili: '',
}

// ---------------------------------------------------------------------------
// Cache TTL constants
// ---------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

// ---------------------------------------------------------------------------
// TrackMeta — Track without per-instance fields (id, requestedBy)
// ---------------------------------------------------------------------------
type TrackMeta = Omit<Track, 'id' | 'requestedBy'>

class MusicProvider {
  // Shared instances with format(true) — used for url/lyric/cover operations (no cookie)
  private instances = new Map<MusicSource, MetingInstance>()

  // ---------------------------------------------------------------------------
  // 3-Layer Cache Architecture
  // ---------------------------------------------------------------------------

  // Layer 1: Track Registry — single source of truth for all track metadata.
  // Every track that passes through the system (search, playlist) gets registered
  // here. Cross-context enrichment: search provides duration + cover, playlist
  // provides additional tracks. Merge strategy keeps the richest data.
  private trackRegistry = new LRUCache<string, TrackMeta>({
    max: 10_000,
    ttl: 2 * HOUR,
  })

  // Layer 2: Reference Indexes — store only sourceId arrays, NOT full Track objects.
  // Memory-efficient: a 2000-track playlist costs ~40KB (IDs) instead of ~1MB (Track[]).
  private searchIndex = new LRUCache<string, { source: MusicSource; ids: string[] }>({
    max: 200,
    ttl: 10 * MINUTE,
  })
  private playlistIndex = new LRUCache<string, { source: MusicSource; ids: string[] }>({
    max: 50,
    ttl: 30 * MINUTE,
  })

  // Layer 3: Resource Caches — scalar values for stream URLs, covers, lyrics.
  private streamUrlCache = new LRUCache<string, CachedStreamUrl>({ max: 500, ttl: 1 * HOUR })
  private coverCache = new LRUCache<string, string>({ max: 1000, ttl: 24 * HOUR })
  private lyricCache = new LRUCache<
    string,
    { lyric: string; tlyric: string; romalrc: string; yrc: string; wordByWord?: AmllLyricLine[] }
  >({
    max: 500,
    ttl: 24 * HOUR,
  })
  private bilibiliViewCache = new LRUCache<string, BilibiliViewData>({ max: 500, ttl: 1 * HOUR })
  private bilibiliWbiMixinKey: { value: string; expiresAt: number } | null = null
  private bilibiliBuvid3: { value: string; expiresAt: number } | null = null
  private bilibiliBuvid3Request: Promise<string | null> | null = null

  private getInstance(source: MusicSource): MetingInstance {
    let m = this.instances.get(source)
    if (!m) {
      m = new Meting(source)
      m.format(true)
      this.instances.set(source, m)
    }
    return m
  }

  // ---------------------------------------------------------------------------
  // Track Registry helpers
  // ---------------------------------------------------------------------------

  /**
   * Register tracks into the registry, merging with existing data.
   * Merge strategy: keep the richer value for each field (non-empty wins).
   * This enables cross-context enrichment: search provides duration + cover,
   * playlist provides additional tracks, and both benefit from each other.
   */
  private registerTracks(tracks: Track[]): void {
    for (const t of tracks) {
      const key = `${t.source}:${t.sourceId}`
      const existing = this.trackRegistry.get(key)
      const { id: _id, requestedBy: _rb, ...meta } = t
      if (existing) {
        const merged: TrackMeta = {
          ...existing,
          cover: existing.cover || meta.cover,
          duration: existing.duration || meta.duration,
          vip: existing.vip || meta.vip,
          lyricId: meta.lyricId ?? existing.lyricId,
          picId: meta.picId ?? existing.picId,
          metadataSource: meta.metadataSource ?? existing.metadataSource,
        }
        this.trackRegistry.set(key, merged)
      } else {
        this.trackRegistry.set(key, meta)
      }
    }
  }

  /**
   * Enrich a track in-place from the registry (fill missing cover, duration, vip).
   * Called before caching playlist tracks so that previously-searched tracks
   * get their duration and cover carried over.
   */
  private enrichFromRegistry(track: Track): void {
    const cached = this.trackRegistry.get(`${track.source}:${track.sourceId}`)
    if (!cached) return
    if (!track.cover && cached.cover) track.cover = cached.cover
    if (!track.duration && cached.duration) track.duration = cached.duration
    if (!track.vip && cached.vip) track.vip = cached.vip
  }

  /**
   * Hydrate sourceId[] back into Track[] from the registry.
   * Returns null if ANY id is missing (registry eviction) — caller should
   * treat this as a cache miss and re-fetch from Meting.
   * Each hydrated Track gets a fresh nanoid for its `id` field.
   */
  private hydrateFromRegistry(source: MusicSource, ids: string[]): Track[] | null {
    const tracks: Track[] = []
    for (const sourceId of ids) {
      const meta = this.trackRegistry.get(`${source}:${sourceId}`)
      if (!meta) return null
      tracks.push({ ...meta, id: nanoid() })
    }
    return tracks
  }

  // ---------------------------------------------------------------------------
  // Public API — Search
  // ---------------------------------------------------------------------------

  private static stripBilibiliMarkup(value: unknown): string {
    return String(value ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim()
  }

  private static readonly BILIBILI_WBI_KEY_TABLE = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
    41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
    20, 34, 44, 52,
  ]

  private static encodeBilibiliWbiParam(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  }

  private async fetchBilibiliJson(
    url: string,
    referer = 'https://www.bilibili.com/',
    cookie?: string,
  ): Promise<Record<string, any> | null> {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          Referer: referer,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      }).then(async (res) => {
        const contentType = res.headers.get('content-type') ?? ''
        if (!res.ok || !contentType.includes('json')) {
          logger.warn('Bilibili API returned a non-JSON response', {
            status: res.status,
            contentType,
            path: new URL(url).pathname,
          })
          return null
        }
        try {
          return (await res.json()) as Record<string, any>
        } catch {
          logger.warn('Bilibili API returned invalid JSON', { path: new URL(url).pathname })
          return null
        }
      }),
    )
    return response ?? null
  }

  private async getBilibiliWbiMixinKey(cookie?: string): Promise<string | null> {
    if (this.bilibiliWbiMixinKey && this.bilibiliWbiMixinKey.expiresAt > Date.now()) {
      return this.bilibiliWbiMixinKey.value
    }
    const nav = await this.fetchBilibiliJson('https://api.bilibili.com/x/web-interface/nav', undefined, cookie)
    const imgUrl = String(nav?.data?.wbi_img?.img_url ?? '')
    const subUrl = String(nav?.data?.wbi_img?.sub_url ?? '')
    const imgKey = imgUrl.split('/').pop()?.split('.')[0] ?? ''
    const subKey = subUrl.split('/').pop()?.split('.')[0] ?? ''
    const rawKey = `${imgKey}${subKey}`
    if (rawKey.length < 64) return null

    const mixinKey = MusicProvider.BILIBILI_WBI_KEY_TABLE.map((index) => rawKey[index] ?? '')
      .join('')
      .slice(0, 32)
    if (!mixinKey) return null
    this.bilibiliWbiMixinKey = { value: mixinKey, expiresAt: Date.now() + HOUR }
    return mixinKey
  }

  private async withBilibiliDeviceCookie(cookie?: string): Promise<string | undefined> {
    if (/(?:^|;\s*)buvid3=/i.test(cookie ?? '')) return cookie
    if (!this.bilibiliBuvid3 || this.bilibiliBuvid3.expiresAt <= Date.now()) {
      this.bilibiliBuvid3Request ??= this.fetchBilibiliJson('https://api.bilibili.com/x/frontend/finger/spi')
        .then((response) => {
          const value = String(response?.data?.b_3 ?? '').trim()
          if (!value) return null
          this.bilibiliBuvid3 = { value, expiresAt: Date.now() + 24 * HOUR }
          return value
        })
        .finally(() => {
          this.bilibiliBuvid3Request = null
        })
      const value = await this.bilibiliBuvid3Request
      if (!value) return cookie
    }

    const buvid3 = this.bilibiliBuvid3?.value
    if (!buvid3) return cookie
    const pair = `buvid3=${buvid3}`
    return cookie ? `${cookie.replace(/;\s*$/, '')}; ${pair}` : pair
  }

  private async signBilibiliWbiParams(params: Record<string, string>, cookie?: string): Promise<string | null> {
    const mixinKey = await this.getBilibiliWbiMixinKey(cookie)
    if (!mixinKey) return null

    const signedParams = { ...params, wts: String(Math.floor(Date.now() / 1000)) }
    const query = Object.entries(signedParams)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) => `${MusicProvider.encodeBilibiliWbiParam(key)}=${MusicProvider.encodeBilibiliWbiParam(value)}`,
      )
      .join('&')
    return `${query}&w_rid=${MusicProvider.md5(`${query}${mixinKey}`)}`
  }

  private async searchBilibiliWbi(keyword: string, limit: number, page: number): Promise<Record<string, any> | null> {
    const query = await this.signBilibiliWbiParams({
      keyword,
      page: String(page),
      page_size: String(limit),
      search_type: 'video',
    })
    if (!query) return null
    return this.fetchBilibiliJson(`https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`)
  }

  private static parseBilibiliDuration(value: unknown): number {
    const parts = String(value ?? '')
      .trim()
      .split(':')
      .map((part) => Number(part))
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0
    return parts.reduce((total, part) => total * 60 + part, 0)
  }

  /** Search public Bilibili video results. The audio URL is resolved only when queued for playback. */
  private async searchBilibili(keyword: string, limit = 20, page = 1): Promise<Track[]> {
    try {
      let response = await this.searchBilibiliWbi(keyword, limit, page)
      if (!response || response.code !== 0) {
        const params = new URLSearchParams({
          search_type: 'video',
          keyword,
          page: String(page),
          page_size: String(limit),
        })
        response = await this.fetchBilibiliJson(`https://api.bilibili.com/x/web-interface/search/type?${params}`)
      }
      if (!response || response.code !== 0) return []
      const videos = (response?.data?.result ?? []) as BilibiliSearchVideo[]
      const tracks: Track[] = videos.flatMap((video) => {
        const bvid = String(video.bvid ?? '').trim()
        if (!bvid) return []
        const cover = normalizeBilibiliCoverUrl(video.pic)
        return [
          {
            id: nanoid(),
            source: 'bilibili' as const,
            sourceId: bvid,
            urlId: bvid,
            title: MusicProvider.stripBilibiliMarkup(video.title) || 'Unknown',
            artist: [MusicProvider.stripBilibiliMarkup(video.author) || 'Bilibili'],
            album: 'Bilibili',
            duration: MusicProvider.parseBilibiliDuration(video.duration),
            cover,
            bilibiliCover: cover,
          },
        ]
      })
      this.registerTracks(tracks)
      return tracks
    } catch (err) {
      logger.error('Bilibili search failed', err, { keyword, page })
      return []
    }
  }

  private async getBilibiliView(bvid: string): Promise<BilibiliViewData | null> {
    const cached = this.bilibiliViewCache.get(bvid)
    if (cached) return cached
    const params = new URLSearchParams({ bvid })
    const response = await this.fetchBilibiliJson(`https://api.bilibili.com/x/web-interface/view?${params}`)
    const aid = Number(response?.data?.aid)
    const cid = Number(response?.data?.cid)
    if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(cid) || cid <= 0) return null
    const value = { aid, cid, cover: normalizeBilibiliCoverUrl(response?.data?.pic) }
    this.bilibiliViewCache.set(bvid, value)
    return value
  }

  private async getBilibiliStreamUrl(
    bvid: string,
    quality: AudioQuality,
    cookie?: string,
  ): Promise<CachedStreamUrl | null> {
    const view = await this.getBilibiliView(bvid)
    if (!view) return null
    const requestCookie = await this.withBilibiliDeviceCookie(cookie)
    const query = await this.signBilibiliWbiParams(
      {
        avid: String(view.aid),
        cid: String(view.cid),
        fnval: '4048',
        fnver: '0',
        fourk: '1',
        from_client: 'BROWSER',
        otype: 'json',
        qn: '127',
        support_multi_audio: 'true',
        ...(!cookie ? { try_look: '1' } : {}),
      },
      requestCookie,
    )
    if (!query) return null
    const response = await this.fetchBilibiliJson(
      `https://api.bilibili.com/x/player/wbi/playurl?${query}`,
      `https://www.bilibili.com/video/${bvid}/`,
      requestCookie,
    )
    if (response?.code !== 0) {
      logger.warn('Bilibili playurl request failed', { bvid, code: response?.code, authenticated: Boolean(cookie) })
      return null
    }

    const findUsableUrl = (audio: Record<string, unknown>): string | null => {
      const rawUrls = [
        audio.baseUrl,
        audio.base_url,
        ...(Array.isArray(audio.backupUrl) ? audio.backupUrl : []),
        ...(Array.isArray(audio.backup_url) ? audio.backup_url : []),
      ]
      return (
        rawUrls
          .map((value) => String(value ?? '').replace(/^http:\/\//, 'https://'))
          .find((value) => {
            try {
              const parsed = new URL(value)
              return parsed.protocol === 'https:' && (!parsed.port || parsed.port === '443')
            } catch {
              return false
            }
          }) ?? null
      )
    }

    const candidates = collectBilibiliAudioCandidates(response?.data?.dash).filter((candidate) =>
      Boolean(findUsableUrl(candidate.raw)),
    )
    const audio = selectBilibiliAudioCandidate(candidates, quality)
    const url = audio ? findUsableUrl(audio.raw) : null
    if (!audio || !url) return null

    const actualBitrate = normalizeBitrate(audio.bandwidth)
    logger.info('Bilibili audio stream resolved', {
      event: 'music.bilibili_stream_resolved',
      bvid,
      requestedQuality: quality,
      actualQuality: audio.quality,
      providerFormat: audio.providerFormat,
      dashAudioId: audio.id,
      actualBitrate,
      availableQualities: [...new Set(candidates.map((candidate) => candidate.quality))],
      authenticated: Boolean(cookie),
    })
    return {
      url,
      actualBitrate,
      actualQuality: audio.quality,
      providerFormat: audio.providerFormat,
      streamFormat: audio.format,
    }
  }

  /**
   * Search Kugou using the native mobile API.
   * The legacy Meting API returns empty results, so we use the direct API.
   */
  private async searchKugou(
    keyword: string,
    limit = 20,
    page = 1,
    source: 'kugou' | 'kugou_concept' = 'kugou',
  ): Promise<Track[]> {
    if (!keyword.trim()) return []

    try {
      const concept = source === 'kugou_concept'
      let response: Record<string, any>
      let usedPublicSearchFallback = false
      if (concept) {
        const clienttime = Math.floor(Date.now() / 1000)
        const params: Record<string, string | number> = {
          dfid: '-',
          mid: kugouAuth.getDeviceMid(),
          uuid: '-',
          appid: MusicProvider.KUGOU_CONCEPT_APP_ID,
          clientver: MusicProvider.KUGOU_CONCEPT_CLIENT_VERSION,
          clienttime,
          albumhide: 0,
          iscorrection: 1,
          keyword,
          nocollect: 0,
          page,
          pagesize: limit,
          platform: 'AndroidFilter',
        }
        params.signature = MusicProvider.kugouAndroidSignature(params, true)
        const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
        response = await withTimeout(
          fetch(`https://gateway.kugou.com/v3/search/song?${query}`, {
            headers: {
              'User-Agent': 'Android16-1070-11440-130-0-DiscoveryDRADProtocol-wifi',
              'x-router': 'complexsearch.kugou.com',
              mid: String(params.mid),
              clienttime: String(clienttime),
              dfid: '-',
              'kg-rc': '1',
              'kg-thash': '5d816a0',
              'kg-rec': '1',
              'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
            },
          }).then((res) => res.json()),
        )

        // The Concept Edition search gateway intermittently responds with
        // error_code=152 and an empty list, even for common songs. Its stream
        // endpoint still accepts the same hashes, so use the public Kugou
        // index only to discover songs and retain the Concept Edition source
        // for metadata, playback and account privileges.
        const conceptSongs = response?.data?.info ?? response?.data?.lists
        if (response?.error_code !== 0 || !Array.isArray(conceptSongs) || conceptSongs.length === 0) {
          logger.warn('Kugou Concept search returned no usable results; falling back to public search index', {
            keyword,
            page,
            errorCode: response?.error_code ?? response?.errcode,
          })
          const url = `http://mobilecdn.kugou.com/api/v3/search/song?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
          response = await withTimeout(fetch(url).then((res) => res.json()))
          usedPublicSearchFallback = true
        }
      } else {
        const url = `http://mobilecdn.kugou.com/api/v3/search/song?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
        response = await withTimeout(fetch(url).then((res) => res.json()))
      }

      const songList = response?.data?.info ?? response?.data?.lists
      if (!response || (response.errcode !== 0 && response.status !== 1) || !Array.isArray(songList)) {
        logger.warn(`Kugou search failed: errcode=${response?.errcode ?? response?.error_code}`)
        return []
      }

      const tracks: Track[] = []
      for (const song of songList) {
        const hash = String(song.hash || song.FileHash || '')
        if (!hash) continue

        const filename = String(song.filename || song.songname || song.SongName || '')
        const parts = filename.split(' - ')
        let trackName = filename
        const artists: string[] = String(song.SingerName || song.singername || '')
          .split(/[,，、]/)
          .map((artist) => artist.trim())
          .filter(Boolean)
        if (parts.length >= 2) {
          artists.length = 0
          for (const a of parts[0].split(/[、,，&]/)) {
            const trimmed = a.trim()
            if (trimmed) artists.push(trimmed)
          }
          trackName = parts.slice(1).join(' - ')
        }

        let duration = Number(song.duration ?? song.Duration ?? song.timelen ?? 0)
        if (duration > 100000) duration = Math.floor(duration / 1000)

        const cover = normalizeKugouCoverUrl(
          song.trans_param?.union_cover ||
            song.audio_info?.trans_param?.union_cover ||
            song.imgurl ||
            song.Image ||
            song.album_img,
        )

        const privilege = Number(song.privilege ?? song.pay_type ?? 0)
        const isVip = (privilege & 8) !== 0 || privilege > 0

        tracks.push({
          id: nanoid(),
          source,
          sourceId: hash,
          title: trackName || 'Unknown',
          artist: artists.length > 0 ? artists : ['Unknown'],
          album: String(song.album_name || song.AlbumName || ''),
          duration,
          cover,
          urlId: hash,
          lyricId: hash,
          picId: hash,
          vip: isVip,
        })
      }

      this.registerTracks(tracks)

      logger.info(`在酷狗音乐搜索“${keyword}”，找到 ${tracks.length} 条结果`, {
        event: 'music.search_completed',
        source,
        keyword,
        resultCount: tracks.length,
        provider:
          source === 'kugou_concept'
            ? usedPublicSearchFallback
              ? 'public_index_fallback'
              : 'concept_native'
            : 'public_native',
      })
      return tracks
    } catch (error) {
      logger.error('Kugou search failed:', error)
      return []
    }
  }

  /** Search QQ Music tracks through the configured API, or QQ's native API when unconfigured. */
  private async searchTencent(keyword: string, limit = 20, page = 1, cookie?: string | null): Promise<Track[]> {
    if (!keyword.trim()) return []

    try {
      if (!config.qqMusicApi.url || !config.qqMusicApi.key) {
        logger.info('QQ 音乐搜索 API 未配置，使用 QQ 原生搜索接口')
        return await this.searchTencentNative(keyword, limit, page, cookie)
      }

      const url = new URL(config.qqMusicApi.url)
      if (url.pathname === '/' || url.pathname === '') {
        url.pathname = '/api'
      }
      url.searchParams.set('action', 'search')
      url.searchParams.set('keyword', keyword)
      url.searchParams.set('page', String(page))
      url.searchParams.set('limit', String(limit))

      const response = await withTimeout(
        fetch(url, {
          headers: { 'X-API-Key': config.qqMusicApi.key },
        }).then(async (res) => ({
          ok: res.ok,
          status: res.status,
          body: (await res.json()) as QQMusicApiSearchResponse,
        })),
      )

      if (!response) {
        logger.warn(`QQ 音乐搜索 API 请求超时: "${keyword}"`)
        return []
      }

      if (!response.ok || response.body.code !== 200 || !Array.isArray(response.body.data)) {
        logger.warn('QQ 音乐搜索 API 返回失败', {
          status: response.status,
          code: response.body.code,
          message: response.body.msg,
        })
        return []
      }

      const tracks: Track[] = response.body.data.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const song = value as QQMusicApiSearchSong
        const mid = typeof song.mid === 'string' ? song.mid.trim() : ''
        if (!mid) return []

        const pmid = typeof song.pmid === 'string' ? song.pmid.trim() : ''
        const cover = typeof song.cover === 'string' ? song.cover.trim() : ''
        return [
          {
            id: nanoid(),
            source: 'tencent' as const,
            sourceId: mid,
            title: typeof song.name === 'string' && song.name.trim() ? song.name : 'Unknown',
            artist: typeof song.singer === 'string' && song.singer.trim() ? [song.singer] : ['Unknown'],
            album: typeof song.album === 'string' ? song.album : '',
            duration: 0,
            cover: cover || (pmid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${pmid}.jpg` : ''),
            urlId: mid,
            lyricId: mid,
            picId: pmid,
            vip: false,
          },
        ]
      })

      // Register into track registry and search index
      this.registerTracks(tracks)

      logger.info(`在 QQ 音乐搜索“${keyword}”，找到 ${tracks.length} 条结果`, {
        event: 'music.search_completed',
        source: 'tencent',
        keyword,
        resultCount: tracks.length,
      })
      return tracks
    } catch (error) {
      logger.error('QQ 音乐搜索 API 请求失败:', error)
      return []
    }
  }

  /** Search QQ Music through the native desktop API when no external API is configured. */
  private async searchTencentNative(
    keyword: string,
    limit: number,
    page: number,
    cookie?: string | null,
  ): Promise<Track[]> {
    const payload = {
      comm: {
        ct: '6',
        cv: '80600',
        tmeAppID: 'qqmusic',
      },
      'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          num_per_page: limit,
          page_num: page,
          search_type: 0,
          query: keyword,
          grp: 1,
        },
      },
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com',
      'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/73222',
    }
    if (cookie) headers.Cookie = cookie

    const response = await withTimeout(
      fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }).then((res) => res.json() as Promise<TencentSearchResponse>),
    )
    const result = response?.['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
    const songList = result?.code === 0 ? result.data?.body?.song?.list : undefined
    if (!songList) {
      logger.warn(`QQ 原生搜索失败: code ${result?.code}`)
      return []
    }

    const tracks: Track[] = songList.flatMap((song) => {
      const mid = song.mid?.trim()
      if (!mid) return []
      return [
        {
          id: nanoid(),
          source: 'tencent' as const,
          sourceId: mid,
          title: song.name || song.title || 'Unknown',
          artist: song.singer?.map((singer) => singer.name).filter((name): name is string => Boolean(name)) || [
            'Unknown',
          ],
          album: song.album?.name || '',
          duration: song.interval || 0,
          cover: song.album?.pmid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.pmid}.jpg` : '',
          urlId: mid,
          lyricId: mid,
          picId: song.album?.mid || '',
          vip: song.pay?.pay_month === 1 || song.pay?.pay_down === 1 || (song.action?.msgpay ?? 0) > 0,
        },
      ]
    })

    this.registerTracks(tracks)
    logger.info(`在 QQ 音乐搜索“${keyword}”，找到 ${tracks.length} 条结果`, {
      event: 'music.search_completed',
      source: 'tencent',
      keyword,
      resultCount: tracks.length,
      provider: 'native',
    })
    return tracks
  }

  /**
   * Search for tracks. Uses format(false) to get raw API data including duration,
   * then batch-resolves cover URLs.
   */

  /**
   * Search for albums. Returns a list of Playlist objects.
   */
  async searchAlbum(
    source: MusicSource,
    keyword: string,
    limit = 20,
    page = 1,
    cookie?: string | null,
  ): Promise<import('@music-together/shared').Playlist[]> {
    if (!keyword.trim()) return []

    try {
      if (source === 'bilibili') return []

      if (source === 'tencent') {
        const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
        const payload = {
          comm: { ct: '6', cv: '80600', tmeAppID: 'qqmusic' },
          'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
            module: 'music.search.SearchCgiService',
            method: 'DoSearchForQQMusicDesktop',
            param: { num_per_page: limit, page_num: page, search_type: 2, query: keyword, grp: 1 },
          },
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Referer: 'https://y.qq.com',
          'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/73222',
        }
        if (cookie) {
          headers['Cookie'] = cookie
        }

        const response = await withTimeout(
          fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          }).then((res) => res.json()),
        )

        if (!response) return []

        const result = response['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
        if (result?.code !== 0 || !result?.data?.body?.album?.list) return []

        return result.data.body.album.list.map((album: any) => ({
          id: String(album.albumMID || album.albumID),
          name: album.albumName || 'Unknown Album',
          cover: album.albumPic || '',
          trackCount: album.song_count || 0,
          source: 'tencent',
          creator: album.singerName || '',
        }))
      }

      if (source === 'kugou') {
        const url = `http://mobilecdn.kugou.com/api/v3/search/album?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
        const response = await withTimeout(fetch(url).then((res) => res.json()))

        if (!response || response.errcode !== 0 || !response.data?.info) return []

        return response.data.info.map((album: any) => ({
          id: String(album.albumid),
          name: album.albumname || 'Unknown Album',
          cover: normalizeKugouCoverUrl(album.imgurl, 400),
          trackCount: album.songcount || 0,
          source: 'kugou',
          creator: album.singername || '',
        }))
      }

      if (source === 'netease') {
        const meting = new Meting('netease')
        meting.format(false) // Important: don't format because format expects songs
        const raw = await withTimeout(meting.search(keyword, { limit, page, type: 10 } as any))
        if (!raw) return []

        let data: any
        try {
          data = JSON.parse(raw as string)
        } catch {
          return []
        }

        const albums = data?.result?.albums
        if (!Array.isArray(albums)) return []

        return albums.map((album: any) => ({
          id: String(album.id),
          name: album.name || 'Unknown Album',
          cover: album.picUrl || album.blurPicUrl || '',
          trackCount: album.size || 0,
          source: 'netease',
          creator: album.artist?.name || '',
        }))
      }

      return []
    } catch (err) {
      logger.error(`Search album failed for ${source}:`, err)
      return []
    }
  }

  /**
   * Search for playlists. Returns a list of Playlist objects.
   */
  async searchPlaylist(
    source: MusicSource,
    keyword: string,
    limit = 20,
    page = 1,
    cookie?: string | null,
  ): Promise<import('@music-together/shared').Playlist[]> {
    if (!keyword.trim()) return []

    try {
      if (source === 'bilibili') return []

      if (source === 'tencent') {
        const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
        const payload = {
          comm: { ct: '6', cv: '80600', tmeAppID: 'qqmusic' },
          'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
            module: 'music.search.SearchCgiService',
            method: 'DoSearchForQQMusicDesktop',
            param: { num_per_page: limit, page_num: page, search_type: 3, query: keyword, grp: 1 },
          },
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Referer: 'https://y.qq.com',
          'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/73222',
        }
        if (cookie) {
          headers['Cookie'] = cookie
        }

        const response = await withTimeout(
          fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          }).then((res) => res.json()),
        )

        if (!response) return []

        const result = response['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
        if (result?.code !== 0 || !result?.data?.body?.songlist?.list) return []

        return result.data.body.songlist.list.map((playlist: any) => ({
          id: String(playlist.dissid),
          name: playlist.dissname || 'Unknown Playlist',
          cover: playlist.imgurl || '',
          trackCount: playlist.song_count || 0,
          source: 'tencent',
          creator: playlist.creator?.name || '',
          description: playlist.introduction || '',
        }))
      }

      if (source === 'kugou') {
        const url = `http://mobilecdn.kugou.com/api/v3/search/special?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
        const response = await withTimeout(fetch(url).then((res) => res.json()))

        if (!response || response.errcode !== 0 || !response.data?.info) return []

        return response.data.info.map((playlist: any) => ({
          id: String(playlist.specialid),
          name: playlist.specialname || 'Unknown Playlist',
          cover: normalizeKugouCoverUrl(playlist.imgurl, 400),
          trackCount: playlist.songcount || 0,
          source: 'kugou',
          creator: playlist.nickname || '',
          description: playlist.intro || '',
        }))
      }

      if (source === 'netease') {
        const meting = new Meting('netease')
        meting.format(false) // Important: don't format because format expects songs
        const raw = await withTimeout(meting.search(keyword, { limit, page, type: 1000 } as any))
        if (!raw) return []

        let data: any
        try {
          data = JSON.parse(raw as string)
        } catch {
          return []
        }

        const playlists = data?.result?.playlists
        if (!Array.isArray(playlists)) return []

        return playlists.map((playlist: any) => ({
          id: String(playlist.id),
          name: playlist.name || 'Unknown Playlist',
          cover: playlist.coverImgUrl || playlist.picUrl || '',
          trackCount: playlist.trackCount || 0,
          source: 'netease',
          creator: playlist.creator?.nickname || '',
          description: playlist.description || '',
        }))
      }

      return []
    } catch (err) {
      logger.error(`Search playlist failed for ${source}:`, err)
      return []
    }
  }

  async search(source: MusicSource, keyword: string, limit = 20, page = 1, cookie?: string | null): Promise<Track[]> {
    const cacheKey = `${source}:${keyword}:${limit}:${page}`

    // Check reference index
    const indexed = this.searchIndex.get(cacheKey)
    if (indexed) {
      const hydrated = this.hydrateFromRegistry(indexed.source, indexed.ids)
      if (hydrated) {
        logger.debug('命中音乐搜索缓存', { source, keyword, page, resultCount: hydrated.length })
        return hydrated
      }
      // Registry eviction — stale index, fall through to re-fetch
      this.searchIndex.delete(cacheKey)
      logger.debug('音乐搜索索引已过期，正在重新查询', { source, keyword, page })
    }

    try {
      if (source === 'bilibili') {
        const tracks = await this.searchBilibili(keyword, limit, page)
        this.registerTracks(tracks)
        return tracks
      }

      // QQ 音乐单曲搜索使用配置的 API；专辑和歌单搜索走各自的独立方法。
      if (source === 'tencent') {
        const tracks = await this.searchTencent(keyword, limit, page, cookie)
        this.searchIndex.set(cacheKey, {
          source,
          ids: tracks.map((t) => t.sourceId),
        })
        return tracks
      }

      // 酷狗使用原生搜索 API (Meting API 已失效)
      if (source === 'kugou' || source === 'kugou_concept') {
        const tracks = await this.searchKugou(keyword, limit, page, source)
        this.searchIndex.set(cacheKey, {
          source,
          ids: tracks.map((t) => t.sourceId),
        })
        return tracks
      }

      // Fresh instance without format — gets raw API response with all fields
      const meting = new Meting(source)
      const raw = await withTimeout(meting.search(keyword, { limit, page }))
      if (raw === null) {
        logger.warn(`Search timeout for ${source}: "${keyword}"`)
        return []
      }

      let rawData: MetingJson
      try {
        rawData = JSON.parse(raw) as MetingJson
      } catch (parseError) {
        logger.error(`Search JSON parse failed for ${source}`)
        logger.error(`Parse error:`, parseError)
        logger.error(`Full raw response:`, raw)
        logger.error(`Raw response type:`, typeof raw)
        logger.error(`Raw response length:`, raw?.length)
        return []
      }

      const songs = this.navigatePath(rawData, SEARCH_PATHS[source])
      if (!Array.isArray(songs) || songs.length === 0) return []

      const tracks = songs.map((song: MetingJson) => this.rawToTrack(song, source))

      // Batch resolve cover URLs for tracks that don't already have one
      await this.batchResolveCover(tracks, source)

      // Register into Layer 1 and index into Layer 2
      this.registerTracks(tracks)
      this.searchIndex.set(cacheKey, {
        source,
        ids: tracks.map((t) => t.sourceId),
      })

      logger.info(`在 ${source} 搜索“${keyword}”，找到 ${tracks.length} 条结果`, {
        event: 'music.search_completed',
        source,
        keyword,
        resultCount: tracks.length,
        page,
      })
      return tracks
    } catch (err) {
      logger.error(`Search failed for ${source}:`, err)
      return []
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — Stream URL, Lyric, Cover (unchanged from original)
  // ---------------------------------------------------------------------------

  private static readonly KUGOU_APP_ID = 1005
  private static readonly KUGOU_TRACKER_CLIENT_VERSION = 11430
  private static readonly KUGOU_ANDROID_SIGNATURE_SALT = 'OIlwieks28dk2k092lksi2UIkp'
  private static readonly KUGOU_TRACKER_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d'
  private static readonly KUGOU_CONCEPT_APP_ID = 3116
  private static readonly KUGOU_CONCEPT_CLIENT_VERSION = 11440
  private static readonly KUGOU_CONCEPT_TRACKER_CLIENT_VERSION = 11430
  private static readonly KUGOU_CONCEPT_ANDROID_SIGNATURE_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'
  private static readonly KUGOU_CONCEPT_TRACKER_KEY_SALT = '185672dd44712f60bb1736df5a377e82'

  private static md5(value: string): string {
    return crypto.createHash('md5').update(value).digest('hex')
  }

  private static kugouAndroidSignature(params: Record<string, string | number>, concept = false): string {
    const joined = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('')
    return MusicProvider.md5(
      `${concept ? MusicProvider.KUGOU_CONCEPT_ANDROID_SIGNATURE_SALT : MusicProvider.KUGOU_ANDROID_SIGNATURE_SALT}${joined}${concept ? MusicProvider.KUGOU_CONCEPT_ANDROID_SIGNATURE_SALT : MusicProvider.KUGOU_ANDROID_SIGNATURE_SALT}`,
    )
  }

  private async getKugouSongInfo(hash: string): Promise<Record<string, any> | null> {
    const params = new URLSearchParams({ cmd: 'playInfo', hash })
    const raw = await withTimeout<Record<string, any>>(
      fetch(`https://m.kugou.com/app/i/getSongInfo.php?${params}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Record<string, any>>
      }),
      8_000,
    )
    return raw
  }

  private static selectKugouQuality(
    hash: string,
    requested: AudioQuality,
    songInfo: Record<string, any> | null,
  ): {
    hash: string
    quality: '128' | '320' | 'flac' | 'viper_clear' | 'viper_tape'
    actualBitrate: number
    actualQuality: AudioQuality
  } {
    if (requested === 'kugou_master') {
      return { hash, quality: 'viper_tape', actualBitrate: 999, actualQuality: 'kugou_master' }
    }
    if (requested === 'kugou_hires') {
      return { hash, quality: 'viper_clear', actualBitrate: 999, actualQuality: 'kugou_hires' }
    }

    const bitrate = qualityToBitrate(requested)
    const extra = songInfo?.extra ?? {}
    const hash128 = String(extra['128hash'] || songInfo?.hash || hash).trim()
    const hash320 = String(extra['320hash'] || '').trim()
    const hashFlac = String(extra.sqhash || '').trim()

    if (bitrate >= 999 && hashFlac) {
      return { hash: hashFlac, quality: 'flac', actualBitrate: 999, actualQuality: 999 }
    }
    if (bitrate >= 320 && hash320) {
      return { hash: hash320, quality: '320', actualBitrate: 320, actualQuality: 320 }
    }
    return { hash: hash128 || hash, quality: '128', actualBitrate: 128, actualQuality: 128 }
  }

  private async getKugouStreamUrl(
    hash: string,
    quality: AudioQuality,
    cookie?: string,
    concept = false,
  ): Promise<CachedStreamUrl | null> {
    const bitrate = qualityToBitrate(quality)
    const cookieObj = cookie ? parseCookieString(cookie) : {}
    const token = cookieObj['token'] || ''
    const userid = cookieObj['userid'] || ''

    if (!token || !userid) {
      logger.warn('Kugou URL: no valid VIP cookie, VIP songs will fail')
    }

    try {
      // KuGouMusicApi resolves album_audio_id and the quality-specific hash
      // before calling trackercdn. /play/songinfo rejects a raw hash with 30020.
      const songInfo = await this.getKugouSongInfo(hash)
      const mid = cookieObj['mid'] || cookieObj['kg_mid'] || kugouAuth.getDeviceMid()
      // A dfid must either be issued by Kugou's device-registration endpoint or
      // be the official anonymous sentinel. A locally generated random dfid is
      // rejected with error 20028 (device verification required).
      const dfid = cookieObj['dfid'] || cookieObj['kg_dfid'] || '-'
      const clienttime = Math.floor(Date.now() / 1000)
      const numericUserId = Number(userid || 0)

      const appId = concept ? MusicProvider.KUGOU_CONCEPT_APP_ID : MusicProvider.KUGOU_APP_ID
      const clientVersion = concept
        ? MusicProvider.KUGOU_CONCEPT_TRACKER_CLIENT_VERSION
        : MusicProvider.KUGOU_TRACKER_CLIENT_VERSION
      const attemptedSelections = new Set<string>()
      for (const fallbackQuality of getKugouQualityFallbacks(quality)) {
        const selected = MusicProvider.selectKugouQuality(hash, fallbackQuality, songInfo)
        const selectionKey = `${selected.quality}:${selected.hash.toLowerCase()}`
        if (attemptedSelections.has(selectionKey)) continue
        attemptedSelections.add(selectionKey)

        const params: Record<string, string | number> = {
          dfid,
          mid,
          uuid: '-',
          appid: appId,
          clientver: clientVersion,
          clienttime,
          album_id: Number(songInfo?.albumid ?? songInfo?.req_albumid ?? 0),
          area_code: 1,
          hash: selected.hash.toLowerCase(),
          ssa_flag: 'is_fromtrack',
          version: clientVersion,
          page_id: concept ? 967177915 : 151369488,
          quality: selected.quality,
          album_audio_id: Number(songInfo?.album_audio_id ?? 0),
          behavior: 'play',
          pid: concept ? 411 : 2,
          cmd: 26,
          pidversion: 3001,
          IsFreePart: 0,
          ppage_id: concept ? '356753938,823673182,967485191' : '463467626,350369493,788954147',
          cdnBackup: 1,
          module: '',
        }
        if (token) params.token = token
        if (userid) params.userid = userid

        params.key = MusicProvider.md5(
          `${params.hash}${concept ? MusicProvider.KUGOU_CONCEPT_TRACKER_KEY_SALT : MusicProvider.KUGOU_TRACKER_KEY_SALT}${appId}${mid}${numericUserId}`,
        )
        params.signature = MusicProvider.kugouAndroidSignature(params, concept)

        const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
        const response = await withTimeout<Record<string, any>>(
          fetch(`https://gateway.kugou.com/v5/url?${query}`, {
            headers: {
              'User-Agent': concept
                ? 'Android16-1070-11440-130-0-DiscoveryDRADProtocol-wifi'
                : 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
              'x-router': 'trackercdn.kugou.com',
              dfid,
              clienttime: String(clienttime),
              mid,
              'kg-rc': '1',
              'kg-thash': '5d816a0',
              'kg-rec': '1',
              'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
            },
          }).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return res.json() as Promise<Record<string, any>>
          }),
          10_000,
        )

        if (!response) {
          logger.warn('酷狗音源接口请求超时，尝试较低音质', {
            source: concept ? 'kugou_concept' : 'kugou',
            urlId: hash,
            quality: selected.quality,
          })
          continue
        }

        const candidates = [response.url, response.backupUrl, response.backup_url]
        let playUrl = ''
        for (const candidate of candidates) {
          if (Array.isArray(candidate)) {
            playUrl = String(candidate.find(Boolean) || '')
          } else if (candidate) {
            playUrl = String(candidate)
          }
          if (playUrl) break
        }

        if (!playUrl) {
          logger.warn('Kugou tracker returned no playable URL; trying lower quality', {
            status: response.status,
            errorCode: response.error_code ?? response.errcode,
            error: response.error ?? response.message,
            quality: selected.quality,
          })
          continue
        }

        const actualBitrate = normalizeBitrate(response.bitrate ?? response.bitRate) ?? selected.actualBitrate
        logger.debug('酷狗播放地址解析成功', {
          source: concept ? 'kugou_concept' : 'kugou',
          urlId: hash,
          requestedQuality: quality,
          actualQuality: selected.actualQuality,
          actualBitrate,
        })
        return { url: playUrl, actualBitrate, actualQuality: selected.actualQuality }
      }

      return this.getKugouStreamUrlLegacy(hash, bitrate)
    } catch (err) {
      logger.error('Kugou tracker URL error:', err)
      return this.getKugouStreamUrlLegacy(hash, bitrate)
    }
  }

  private async getKugouStreamUrlLegacy(hash: string, bitrate: number): Promise<CachedStreamUrl | null> {
    try {
      const body = {
        relate: 1,
        userid: '0',
        vip: 0,
        appid: 1000,
        token: '',
        behavior: 'download',
        area_code: '1',
        clientver: '8990',
        resource: [{ id: 0, type: 'audio', hash }],
      }

      const res = await withTimeout(
        fetch('http://media.store.kugou.com/v1/get_res_privilege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.json()),
        8_000,
      )

      if (!res) return null

      const resourceList = (res as any)?.data?.[0]?.relate_goods
      if (!Array.isArray(resourceList)) return null

      // Find the best bitrate match
      let bestItem: any = null
      for (const item of resourceList) {
        if (
          item.info?.bitrate &&
          item.info.bitrate <= bitrate &&
          (!bestItem || item.info.bitrate > bestItem.info.bitrate)
        ) {
          bestItem = item
        }
      }

      if (!bestItem) return null

      // Get play URL from trackercdn
      const key = crypto
        .createHash('md5')
        .update(bestItem.hash + 'kgcloudv2')
        .digest('hex')
      const cdnUrl = `http://trackercdn.kugou.com/i/v2/?hash=${bestItem.hash}&key=${key}&pid=3&behavior=play&cmd=25&version=8990`

      const cdnRes = await withTimeout(
        fetch(cdnUrl).then((r) => r.json()),
        8_000,
      )
      if (!cdnRes || cdnRes.status !== 2) {
        logger.warn('Kugou legacy CDN: no URL (status=' + cdnRes?.status + ')')
        return null
      }

      const url = Array.isArray(cdnRes.url) ? cdnRes.url[0] : cdnRes.url
      if (!url) return null

      // See the native tracker path above: preserve the upstream protocol for
      // the server-side Kugou audio proxy.
      const urlStr = String(url)
      const actualBitrate = normalizeBitrate(cdnRes.bitRate) ?? normalizeBitrate(bestItem.info?.bitrate)
      logger.debug('酷狗备用播放地址解析成功', { source: 'kugou', urlId: hash, actualBitrate })
      return { url: urlStr, actualBitrate }
    } catch (err) {
      logger.error('Kugou legacy URL error:', err)
      return null
    }
  }

  /**
   * Get a stream URL and the bitrate actually reported/selected upstream.
   * This can be lower than the requested room quality. Cookie-backed VIP
   * results use a fresh Meting instance and are intentionally not cached.
   */
  private async getNeteaseStreamUrlV1(
    urlId: string,
    quality: AudioQuality,
    cookie?: string,
    retried = false,
  ): Promise<CachedStreamUrl | null> {
    const level = neteaseQualityToLevel(quality)
    if (!level) return null

    try {
      await ensureNeteaseEnhancedConfig()
      const res = await withTimeout(
        ncmApi.song_url_v1({ id: urlId, level, timestamp: Date.now(), ...(cookie ? { cookie } : {}) }),
      )
      const data = res?.body?.data?.[0] as MetingJson | undefined
      if (!data) return null
      const url = String(data.url ?? '').replace(/^http:\/\//, 'https://')
      if (!url) return null
      return {
        url,
        actualBitrate: normalizeBitrate(data.br) ?? qualityToBitrate(quality),
        actualQuality: neteaseLevelToQuality(data.level) ?? quality,
      }
    } catch (err) {
      if (!retried && isXeapiPublicKeyMissing(err) && (await ensureNeteaseEnhancedConfig(true))) {
        return this.getNeteaseStreamUrlV1(urlId, quality, cookie, true)
      }
      logger.warn('Netease song_url_v1 failed', { urlId, level, err })
      return null
    }
  }

  private async getTencentTrackInfo(urlId: string, cookie?: string): Promise<TencentTrackInfo | null> {
    const payload = {
      comm: { ct: '6', cv: '80600', tmeAppID: 'qqmusic' },
      req: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: { song_type: 0, song_mid: urlId },
      },
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/',
      'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/73222',
    }
    if (cookie) headers.Cookie = cookie

    const response = await withTimeout(
      fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }).then((result) => result.json() as Promise<Record<string, any>>),
    )
    return (response?.req?.data?.track_info as TencentTrackInfo | undefined) ?? null
  }

  /** Resolve an exact QQ Music file tier through the native VKey API. */
  private async getTencentStreamUrl(
    urlId: string,
    quality: AudioQuality,
    cookie?: string,
  ): Promise<CachedStreamUrl | null> {
    if (typeof quality === 'string' && !cookie) return null

    try {
      const track = await this.getTencentTrackInfo(urlId, cookie)
      if (!track) return null

      const spec = getTencentStreamSpec(track, quality)
      if (!spec) {
        logger.debug('QQ 音乐歌曲不提供请求的音质规格', { source: 'tencent', urlId, requestedQuality: quality })
        return null
      }

      const cookies = cookie ? parseCookieString(cookie) : {}
      const uin = String(cookies.uin ?? cookies.qqmusic_uin ?? '0').replace(/^o0*/, '') || '0'
      const musicKey = cookies.qm_keyst ?? cookies.qqmusic_key ?? cookies.p_skey ?? ''
      const gTk = musicKey ? hashTencentGtk(musicKey) : 5381
      const filename = `${spec.prefix}${spec.mediaMid}${spec.extension}`
      const payload = {
        comm: {
          ct: 24,
          cv: 4747474,
          platform: 'yqq.json',
          uin: Number(uin) || 0,
          g_tk: gTk,
          g_tk_new_20200303: gTk,
          format: 'json',
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          notice: 0,
          needNewCode: 1,
        },
        req_0: {
          module: 'music.vkey.GetVkey',
          method: 'UrlGetVkey',
          param: {
            uin,
            filename: [filename],
            guid: String(crypto.randomInt(1_000_000_000, 9_999_999_999)),
            songmid: [urlId],
            songtype: [positiveNumber(track.type)],
            ctx: 0,
          },
        },
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QQMusic/20.01',
      }
      if (cookie) headers.Cookie = cookie

      const response = await withTimeout(
        fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        }).then((result) => result.json() as Promise<TencentVkeyResponse>),
      )
      const data = response?.req_0?.data
      const urlInfo = data?.midurlinfo?.[0]
      const purl = String(urlInfo?.purl ?? '').trim()
      if (response?.req_0?.code !== 0 || urlInfo?.result !== 0 || !purl) {
        logger.debug('QQ 音乐原生 VKey 未授权请求的音质规格', {
          source: 'tencent',
          urlId,
          requestedQuality: quality,
          providerFormat: spec.prefix,
          result: urlInfo?.result ?? null,
        })
        return null
      }

      const baseUrl = String(data?.sip?.[0] ?? 'https://isure.stream.qqmusic.qq.com/')
      const url = new URL(purl, baseUrl).toString().replace(/^http:\/\//, 'https://')
      const duration = positiveNumber(track.interval)
      const actualBitrate = duration > 0 ? Math.round((spec.fileSize * 8) / duration / 1000) : null

      logger.info('QQ 音乐原生播放地址解析成功', {
        event: 'music.tencent_stream_resolved',
        source: 'tencent',
        urlId,
        requestedQuality: quality,
        actualQuality: spec.quality,
        providerFormat: spec.prefix,
        fileSize: spec.fileSize,
        averageBitrateKbps: actualBitrate,
        authenticated: Boolean(cookie),
      })
      return {
        url,
        actualBitrate,
        actualQuality: spec.quality,
        providerFormat: spec.prefix,
        fileSize: spec.fileSize,
      }
    } catch (err) {
      logger.warn('QQ 音乐原生播放地址解析失败', { source: 'tencent', urlId, requestedQuality: quality, err })
      return null
    }
  }

  async getStreamInfo(
    source: MusicSource,
    urlId: string,
    quality: AudioQuality = 320,
    cookie?: string,
    forceRefresh = false,
  ): Promise<StreamUrlResult | null> {
    const bitrate = qualityToBitrate(quality)
    const qualityCacheKey = String(quality)
    // Skip cache when cookie is provided (VIP URLs are user-specific). Bilibili
    // DASH responses vary by CDN node and codec, so always resolve a fresh
    // compatible audio track when playback starts.
    if (!cookie && source !== 'bilibili') {
      const cacheKey = `${source}:${urlId}:${qualityCacheKey}`
      if (forceRefresh) this.streamUrlCache.delete(cacheKey)
      const cached = this.streamUrlCache.get(cacheKey)
      if (!forceRefresh && cached) {
        logger.debug('命中播放地址缓存', {
          source,
          urlId,
          requestedBitrate: bitrate,
          actualBitrate: cached.actualBitrate,
        })
        return { ...cached, fromCache: true }
      }
    }

    try {
      if (source === 'bilibili') {
        const result = await this.getBilibiliStreamUrl(urlId, quality, cookie)
        if (result) {
          return { ...result, fromCache: false }
        }
        return null
      }

      if (source === 'tencent') {
        const result = await this.getTencentStreamUrl(urlId, quality, cookie)
        if (result) {
          if (!cookie) this.streamUrlCache.set(`${source}:${urlId}:${qualityCacheKey}`, result)
          return { ...result, fromCache: false }
        }
        // Do not let exact/lossless QQ tiers fall through to Meting, which can
        // only express numeric legacy tiers and would report a false success.
        if (typeof quality === 'string' || quality === 999) return null
      }

      if (source === 'netease') {
        const result = await this.getNeteaseStreamUrlV1(urlId, quality, cookie)
        if (result) {
          if (!cookie) this.streamUrlCache.set(`${source}:${urlId}:${qualityCacheKey}`, result)
          return { ...result, fromCache: false }
        }
        if (typeof quality === 'string' || quality === 999) return null
      }

      // Kugou: use native API that properly handles VIP authentication.
      // Concept Edition has its own app ID, signature salt and tracker params.
      if (source === 'kugou' || source === 'kugou_concept') {
        const result = await this.getKugouStreamUrl(urlId, quality, cookie, source === 'kugou_concept')
        if (result) {
          if (!cookie) {
            this.streamUrlCache.set(`${source}:${urlId}:${qualityCacheKey}`, result)
          }
          return { ...result, fromCache: false }
        }
        return null
      }

      let meting: MetingInstance
      if (cookie) {
        // Fresh instance with cookie — don't pollute the shared one
        meting = new Meting(source)
        meting.format(true)
        meting.cookie(cookie)
      } else {
        meting = this.getInstance(source)
      }
      const raw = await withTimeout(meting.url(urlId, bitrate))
      if (raw === null || raw === undefined) {
        logger.warn(`URL fetch timeout for ${source}: ${urlId}`)
        return null
      }
      let data: MetingJson
      try {
        data = JSON.parse(raw as string) as MetingJson
      } catch {
        return null
      }
      let url = (data.url as string) || null
      // 强制 HTTPS，避免 HTTPS 页面加载 HTTP 音频触发 Mixed Content 警告
      if (url?.startsWith('http://')) {
        url = url.replace(/^http:\/\//, 'https://')
      }

      if (!url) return null

      const result: CachedStreamUrl = {
        url,
        actualBitrate: normalizeBitrate(data.br),
      }

      // Only cache non-cookie & successful results (null = transient failure, retry next time)
      if (!cookie) this.streamUrlCache.set(`${source}:${urlId}:${qualityCacheKey}`, result)

      return { ...result, fromCache: false }
    } catch (err) {
      logger.error('获取播放地址失败', err, { source, urlId, requestedBitrate: bitrate })
      return null
    }
  }

  /** Backwards-compatible URL-only helper used by the public REST endpoint. */
  async getStreamUrl(
    source: MusicSource,
    urlId: string,
    quality: AudioQuality = 320,
    cookie?: string,
  ): Promise<string | null> {
    return (await this.getStreamInfo(source, urlId, quality, cookie))?.url ?? null
  }

  async getLyric(
    source: MusicSource,
    lyricId: string,
  ): Promise<{ lyric: string; tlyric: string; romalrc: string; yrc: string; wordByWord?: AmllLyricLine[] }> {
    const cacheKey = `${source}:${lyricId}`
    const cached = this.lyricCache.get(cacheKey)
    if (cached) {
      logger.debug('命中歌词缓存', { source, lyricId })
      return cached
    }

    const empty = { lyric: '', tlyric: '', romalrc: '', yrc: '' as string }

    try {
      if (source === 'bilibili') return empty

      let result: { lyric: string; tlyric: string; romalrc: string; yrc: string; wordByWord?: AmllLyricLine[] } = {
        ...empty,
      }

      if (source === 'netease') {
        // 使用 ncmApi.lyric_new 获取包含逐词歌词 (YRC) 的完整响应
        const res = await withTimeout(ncmApi.lyric_new({ id: lyricId }))
        if (!res?.body) {
          logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
          return empty
        }
        const body = res.body
        result = {
          lyric: (body.lrc?.lyric as string) || '',
          tlyric: (body.tlyric?.lyric as string) || '',
          romalrc: ((body.romalrc as Record<string, unknown> | undefined)?.lyric as string) || '',
          yrc: (body.yrc?.lyric as string) || '',
        }
        if (result.yrc) {
          logger.debug('已获取网易云逐字歌词', { source: 'netease', lyricId })
        }
      } else if (source === 'kugou' || source === 'kugou_concept') {
        // 酷狗：Meting 获取 LRC + kugou-lrc 获取 KRC 逐字歌词
        const meting = this.getInstance('kugou')
        const raw = await withTimeout(meting.lyric(lyricId))
        if (raw === null || raw === undefined) {
          logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
          return empty
        }
        try {
          const data = JSON.parse(raw as string) as MetingJson
          result = {
            lyric: (data.lyric as string) || '',
            tlyric: (data.tlyric as string) || '',
            romalrc: '',
            yrc: '',
          }
        } catch {
          return empty
        }
        // 尝试获取 KRC 逐字歌词
        try {
          const krcInfo = await withTimeout(kugouLrcGet({ hash: lyricId, fmt: Format.krc }))
          if (krcInfo?.items?.length) {
            result.wordByWord = krcToAmllLines(krcInfo)
            logger.debug('已获取酷狗逐字歌词', { source: 'kugou', lyricId })
          }
        } catch {
          /* 静默回退到 LRC */
        }
      } else {
        // QQ 音乐：使用 Meting 默认流程
        const meting = this.getInstance(source)
        const raw = await withTimeout(meting.lyric(lyricId))
        if (raw === null || raw === undefined) {
          logger.warn(`Lyric fetch timeout for ${source}: ${lyricId}`)
          return empty
        }
        try {
          const data = JSON.parse(raw as string) as MetingJson
          result = {
            lyric: (data.lyric as string) || '',
            tlyric: (data.tlyric as string) || '',
            romalrc: '',
            yrc: '',
          }
        } catch {
          return empty
        }
      }

      this.lyricCache.set(cacheKey, result)
      return result
    } catch (err) {
      logger.error(`Get lyric failed for ${source}:`, err)
      return empty
    }
  }

  async getCover(source: MusicSource, picId: string, size = 300): Promise<string> {
    const cacheKey = `${source}:${picId}:${size}`
    const cached = this.coverCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    try {
      if (source === 'bilibili') {
        const view = await this.getBilibiliView(picId)
        return view?.cover ?? ''
      }
      const meting = this.getInstance(source === 'kugou_concept' ? 'kugou' : source)
      const raw = await withTimeout(meting.pic(picId, size))
      if (raw === null || raw === undefined) {
        logger.warn(`Cover fetch timeout for ${source}: ${picId}`)
        return ''
      }
      let data: MetingJson
      try {
        data = JSON.parse(raw as string) as MetingJson
      } catch {
        return ''
      }
      const url = (data.url as string) || ''

      this.coverCache.set(cacheKey, url)
      return url
    } catch (err) {
      logger.error(`Get cover failed for ${source}:`, err)
      return ''
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — Playlist (new: paginated)
  // ---------------------------------------------------------------------------

  /**
   * Ensure a playlist's track IDs are in the registry + index.
   * Does NOT resolve covers (that's deferred to getPlaylistPage).
   * Returns the full sourceId list and total count.
   */
  async fetchFullPlaylist(
    source: MusicSource,
    playlistId: string,
    playlistTotal?: number,
    cookie?: string | null,
    type: 'playlist' | 'album' = 'playlist',
  ): Promise<{ ids: string[]; total: number }> {
    const cacheKey = `${source}:${playlistId}`

    // Check reference index — verify registry still has all tracks
    const indexed = this.playlistIndex.get(cacheKey)
    if (indexed) {
      const allPresent = indexed.ids.every((id) => this.trackRegistry.get(`${indexed.source}:${id}`) !== undefined)
      if (allPresent) {
        logger.debug('命中歌单索引缓存', { source, playlistId, trackCount: indexed.ids.length })
        return { ids: indexed.ids, total: indexed.ids.length }
      }
      this.playlistIndex.delete(cacheKey)
      logger.debug('歌单索引已过期，正在重新获取', { source, playlistId })
    }

    // Netease: use ncmApi.playlist_track_all to bypass Meting's 1000-track limit
    if (source === 'netease') {
      if (type === 'album') {
        return this.fetchNeteaseAlbum(playlistId, cacheKey)
      }
      return this.fetchNeteasePlaylist(playlistId, cacheKey, playlistTotal, cookie)
    }

    // Kugou: try native API (works with global_collection_id from user playlists)
    // Falls back to Meting for public playlists / special IDs
    if (source === 'kugou' || source === 'kugou_concept') {
      if (type === 'album') {
        return source === 'kugou' ? this.fetchMetingPlaylist(source, playlistId, cacheKey, type) : { ids: [], total: 0 }
      }
      const result = await this.fetchKugouPlaylist(playlistId, cacheKey, cookie, source)
      if (result.total > 0) return result
      logger.debug('酷狗原生歌单接口返回空结果，尝试备用接口', { source, playlistId })
      if (source === 'kugou_concept') return result
    }

    // Tencent: use new native API (supports fav & custom lists)
    if (source === 'tencent') {
      if (type === 'album') {
        return this.fetchMetingPlaylist(source, playlistId, cacheKey, type)
      }
      const result = await this.fetchTencentPlaylist(playlistId, cacheKey, cookie)
      if (result.total > 0) return result
      logger.debug('QQ 音乐原生歌单接口返回空结果，尝试备用接口', { source: 'tencent', playlistId })
    }

    // Fallback: use Meting raw mode
    return this.fetchMetingPlaylist(source, playlistId, cacheKey, type)
  }

  /**
   * Fetch full Netease playlist via ncmApi.playlist_track_all.
   * No 1000-track limit; returns full song data including duration/album/artist.
   */

  /** Fetch Netease album using ncmApi.album */
  private async fetchNeteaseAlbum(albumId: string, cacheKey: string): Promise<{ ids: string[]; total: number }> {
    try {
      const res = await withTimeout(ncmApi.album({ id: albumId, timestamp: Date.now() }), 30_000)
      if (res === null) {
        logger.warn(`Netease album timeout: ${albumId}`)
        return { ids: [], total: 0 }
      }

      const songs = res?.body?.songs
      if (!Array.isArray(songs) || songs.length === 0) {
        return { ids: [], total: 0 }
      }

      const allTracks = songs.map((song: any) => this.rawToTrack(song, 'netease'))

      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source: 'netease', ids })

      logger.info(`已获取网易云专辑 ${albumId}，共 ${ids.length} 首歌曲`, {
        source: 'netease',
        albumId,
        trackCount: ids.length,
      })
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Netease album failed: ${albumId}`, err)
      return { ids: [], total: 0 }
    }
  }

  private async fetchNeteasePlaylist(
    playlistId: string,
    cacheKey: string,
    playlistTotal?: number,
    cookie?: string | null,
  ): Promise<{ ids: string[]; total: number }> {
    // Netease /api/v3/song/detail can't handle more than ~1000 IDs per request,
    // so we paginate through playlist_track_all in chunks of 1000.
    const CHUNK_SIZE = 1000
    const totalToFetch = playlistTotal || 100000
    const baseParams = { id: playlistId, timestamp: Date.now(), ...(cookie ? { cookie } : {}) }

    try {
      const allTracks: Track[] = []
      let offset = 0

      while (offset < totalToFetch) {
        const res = await withTimeout(ncmApi.playlist_track_all({ ...baseParams, limit: CHUNK_SIZE, offset }), 60_000)

        if (res === null) {
          logger.warn(`Netease playlist_track_all timeout: ${playlistId} (offset=${offset})`)
          break
        }

        const songs = res?.body?.songs
        if (!Array.isArray(songs) || songs.length === 0) {
          if (offset === 0) {
            logger.warn(`Netease playlist_track_all empty: ${playlistId}`, { code: res?.body?.code })
            return { ids: [], total: 0 }
          }
          break
        }

        const chunk = songs.map((song: Record<string, unknown>) => this.rawToTrack(song, 'netease'))
        allTracks.push(...chunk)

        // If we got fewer than CHUNK_SIZE, we've reached the end
        if (songs.length < CHUNK_SIZE) break
        offset += CHUNK_SIZE
      }

      if (allTracks.length === 0) return { ids: [], total: 0 }

      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source: 'netease', ids })

      logger.info(`已获取网易云歌单 ${playlistId}，共 ${ids.length} 首歌曲`, {
        source: 'netease',
        playlistId,
        trackCount: ids.length,
        chunks: Math.ceil(ids.length / CHUNK_SIZE),
      })
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Netease playlist_track_all failed: ${playlistId}`, err)
      return { ids: [], total: 0 }
    }
  }

  /**
   * Fetch kugou playlist via native kugou API (global_collection_id).
   * Supports user playlists that Meting cannot access.
   */
  private async fetchKugouPlaylist(
    playlistId: string,
    cacheKey: string,
    cookie?: string | null,
    source: 'kugou' | 'kugou_concept' = 'kugou',
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const PAGE_SIZE = 300
      const allTracks: Track[] = []
      let page = 1
      let totalFromApi = 0

      // Paginate until all tracks are fetched
      while (true) {
        const { songs, total } =
          source === 'kugou_concept'
            ? await kugouAuth.getConceptPlaylistTracks(playlistId, page, PAGE_SIZE, cookie)
            : await kugouAuth.getPlaylistTracks(playlistId, page, PAGE_SIZE, cookie)
        if (page === 1) totalFromApi = total

        if (songs.length === 0) break

        for (const song of songs) {
          const track = this.kugouSongToTrack(song, source)
          if (track) allTracks.push(track)
        }

        if (allTracks.length >= totalFromApi || songs.length < PAGE_SIZE) break
        page++
      }

      if (allTracks.length === 0) return { ids: [], total: 0 }

      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source, ids })

      logger.info(`已获取酷狗歌单 ${playlistId}，共 ${ids.length} 首歌曲`, {
        source,
        playlistId,
        trackCount: ids.length,
        pages: page,
      })
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Kugou playlist fetch failed: ${playlistId}`, err)
      return { ids: [], total: 0 }
    }
  }

  /**
   * Fetch Tencent playlist via native API.
   * Leverages the new encrypted-uin based getPlaylistTracks implementation.
   */
  private async fetchTencentPlaylist(
    playlistId: string,
    cacheKey: string,
    cookie?: string | null,
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const PAGE_SIZE = 100
      const allTracks: Track[] = []
      let page = 1
      let totalFromApi = 0

      while (true) {
        const { songs, total } = await tencentAuth.getPlaylistTracks(playlistId, page, PAGE_SIZE, cookie)
        if (page === 1) totalFromApi = total

        if (songs.length === 0) break

        for (const song of songs) {
          const track = this.rawToTrack(song, 'tencent')
          if (track) allTracks.push(track)
        }

        if (allTracks.length >= totalFromApi || songs.length < PAGE_SIZE) break
        page++
      }

      if (allTracks.length === 0) return { ids: [], total: 0 }

      for (const t of allTracks) this.enrichFromRegistry(t)
      this.registerTracks(allTracks)

      const ids = allTracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source: 'tencent', ids })

      logger.info(`已获取 QQ 音乐歌单 ${playlistId}，共 ${ids.length} 首歌曲`, {
        source: 'tencent',
        playlistId,
        trackCount: ids.length,
        pages: page,
      })
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Tencent playlist fetch failed: ${playlistId}`, err)
      return { ids: [], total: 0 }
    }
  }

  /** Convert a kugou song object from getPlaylistTracks to a Track. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- external Kugou API response shape
  private kugouSongToTrack(song: Record<string, unknown>, source: 'kugou' | 'kugou_concept' = 'kugou'): Track | null {
    // Cast for convenient dynamic property access
    const song_ = song as Record<string, any>
    const hash = song_.hash || song_.audio_info?.hash || ''
    if (!hash) return null

    // filename is typically "Artist - Title" or "Artist1、Artist2 - Title"
    const filename = String(song_.filename || song_.name || '')
    const parts = filename.split(' - ')
    const artistStr = parts.length > 1 ? parts[0].trim() : ''
    const artists = artistStr
      ? artistStr
          .split(/[、,，&]/)
          .map((a: string) => a.trim())
          .filter(Boolean)
      : []
    const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : filename

    // Duration: Kugou's native API returns seconds (e.g. 240), but some endpoints
    // return milliseconds (e.g. 240000). Threshold 100000 (~27 hours in seconds)
    // safely distinguishes the two — any value above it is assumed to be milliseconds.
    let duration = Number(song_.duration ?? song_.timelen ?? 0)
    if (duration > 100000) duration = Math.floor(duration / 1000)

    // VIP / privilege
    const privilege = song_.privilege ?? song_.pay_type ?? 0
    const isVip = privilege > 0

    return {
      id: nanoid(),
      source,
      sourceId: hash,
      title,
      artist: artists,
      album: String(song_.album_name || song_.remark || ''),
      duration,
      cover: normalizeKugouCoverUrl(
        song_.trans_param?.union_cover || song_.audio_info?.trans_param?.union_cover || song_.imgurl || song_.album_img,
      ),
      lyricId: hash,
      urlId: hash,
      picId: hash,
      vip: isVip,
    }
  }

  /**
   * Fetch playlist via Meting raw mode — used for Tencent/Kugou.
   * Raw mode preserves VIP/pay fields and duration (format mode strips them).
   */
  private async fetchMetingPlaylist(
    source: MusicSource,
    playlistId: string,
    cacheKey: string,
    type: 'playlist' | 'album' = 'playlist',
  ): Promise<{ ids: string[]; total: number }> {
    try {
      const meting = new Meting(source)
      const raw = await withTimeout(type === 'album' ? meting.album(playlistId) : meting.playlist(playlistId), 30_000)
      if (raw === null) {
        logger.warn(`Playlist fetch timeout for ${source}: ${playlistId}`)
        return { ids: [], total: 0 }
      }

      let rawData: MetingJson
      try {
        rawData = JSON.parse(raw as string) as MetingJson
      } catch {
        logger.error(`Playlist JSON parse failed for ${source}`, (raw as string)?.substring?.(0, 200))
        return { ids: [], total: 0 }
      }

      // For Tencent album, the path is data.getSongInfo, for Kugou it's data.info
      let path = PLAYLIST_PATHS[source]
      if (type === 'album') {
        if (source === 'tencent') path = 'data.getSongInfo'
        if (source === 'kugou') path = 'data.info'
      }
      const songs = this.navigatePath(rawData, path)
      if (!Array.isArray(songs) || songs.length === 0) return { ids: [], total: 0 }

      const tracks = songs.map((song: MetingJson) => this.rawToTrack(song, source))
      for (const t of tracks) this.enrichFromRegistry(t)
      this.registerTracks(tracks)

      const ids = tracks.map((t) => t.sourceId)
      this.playlistIndex.set(cacheKey, { source, ids })

      logger.info(`已获取 ${source} 歌单 ${playlistId}，共 ${tracks.length} 首歌曲`, {
        source,
        playlistId,
        trackCount: tracks.length,
        mode: 'raw',
      })
      return { ids, total: ids.length }
    } catch (err) {
      logger.error(`Get playlist failed for ${source}:`, err)
      return { ids: [], total: 0 }
    }
  }

  /**
   * Get a paginated slice of a playlist's tracks.
   * Covers are resolved only for the requested page, not the entire playlist.
   * After resolution, covers are written back to the registry for future reuse.
   */
  async getPlaylistPage(
    source: MusicSource,
    playlistId: string,
    limit: number,
    offset: number,
    playlistTotal?: number,
    cookie?: string | null,
    type: 'playlist' | 'album' = 'playlist',
  ): Promise<{ tracks: Track[]; total: number; hasMore: boolean }> {
    if (source === 'bilibili') {
      if (type !== 'playlist' || !cookie) return { tracks: [], total: 0, hasMore: false }
      // Bilibili's favorite-resource endpoint accepts at most 20 videos per
      // request. Native clients request 100 by default, which Bilibili rejects
      // as an invalid parameter and previously surfaced as an empty folder.
      const pageSize = Math.min(limit, 20)
      const page = Math.floor(offset / pageSize) + 1
      const result = await bilibiliAuth.getFavoriteVideos(playlistId, page, pageSize, cookie)
      const tracks: Track[] = result.videos.map((video) => {
        const cover = normalizeBilibiliCoverUrl(video.cover)
        return {
          id: nanoid(),
          source: 'bilibili',
          sourceId: video.bvid,
          urlId: video.bvid,
          title: video.title,
          artist: [video.author],
          album: 'Bilibili 收藏夹',
          duration: video.duration,
          cover,
          bilibiliCover: cover,
        }
      })
      this.registerTracks(tracks)
      return { tracks, total: result.total, hasMore: offset + tracks.length < result.total }
    }

    const { ids, total } = await this.fetchFullPlaylist(source, playlistId, playlistTotal, cookie, type)
    if (total === 0) return { tracks: [], total: 0, hasMore: false }

    const pageIds = ids.slice(offset, offset + limit)

    // Hydrate page from registry
    let tracks = this.hydrateFromRegistry(source, pageIds)
    if (!tracks) {
      // Registry eviction between fetchFullPlaylist and hydrate (very rare).
      // Clear index and retry once.
      this.playlistIndex.delete(`${source}:${playlistId}`)
      logger.warn(`Playlist page hydration failed, retrying: ${source}/${playlistId}`)
      const retry = await this.fetchFullPlaylist(source, playlistId, playlistTotal, cookie)
      if (retry.total === 0) return { tracks: [], total: 0, hasMore: false }
      const retryPageIds = retry.ids.slice(offset, offset + limit)
      tracks = this.hydrateFromRegistry(source, retryPageIds)
      if (!tracks) {
        logger.error(`Playlist page hydration failed after retry: ${source}/${playlistId}`)
        return { tracks: [], total: retry.total, hasMore: offset + limit < retry.total }
      }
    }

    // Resolve covers for this page only (tracks with cover already set are skipped)
    await this.batchResolveCover(tracks, source)

    // Write newly resolved covers back to registry for cross-page / cross-context reuse
    this.registerTracks(tracks)

    return { tracks, total, hasMore: offset + limit < total }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Navigate a dot-separated path in an object */
  private navigatePath(data: MetingJson, path: string): unknown {
    let result: unknown = data
    for (const key of path.split('.')) {
      result = (result as Record<string, unknown>)?.[key]
    }
    return result
  }

  /**
   * Convert raw platform-specific song data to our Track format.
   * Each platform returns different field names, so we need per-platform parsing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- platform API shapes are too dynamic for strict typing
  private rawToTrack(song: Record<string, unknown>, source: MusicSource): Track {
    // Cast to any for convenient dynamic property access on external API responses
    const s = song as Record<string, any>
    switch (source) {
      case 'netease': {
        const neteaseArtists = s.ar?.map((a: Record<string, unknown>) => a.name).filter(Boolean)
        return {
          id: nanoid(),
          title: s.name || 'Unknown',
          artist: neteaseArtists?.length ? neteaseArtists : ['Unknown'],
          album: s.al?.name || '',
          duration: Math.round((s.dt || 0) / 1000), // ms -> seconds
          cover: '', // resolved via pic()
          source,
          sourceId: String(s.id),
          urlId: String(s.id),
          lyricId: String(s.id),
          picId: String(s.al?.pic_str || s.al?.pic || ''),
          // fee: 0=免费, 1=VIP, 4=付费专辑, 8=低音质免费
          vip: s.fee === 1 || s.fee === 4 || s.privilege?.fee === 1 || s.privilege?.fee === 4,
        }
      }

      case 'tencent': {
        // Tencent sometimes wraps data in musicData
        const t = s.musicData || s
        return {
          id: nanoid(),
          title: t.name || 'Unknown',
          artist: (t.singer || []).map((a: Record<string, unknown>) => a.name),
          album: (t.album?.title || '').trim(),
          duration: t.interval || 0, // already in seconds
          cover: '', // resolved via pic()
          source,
          sourceId: String(t.mid),
          urlId: String(t.mid),
          lyricId: String(t.mid),
          picId: String(t.album?.mid || ''),
          // pay.pay_play=1 表示需要 VIP, pay.pay_month=1 表示月度VIP, pay.price_track>0 表示付费单曲
          vip: t.pay?.pay_play === 1 || t.pay?.pay_month === 1 || (t.pay?.price_track ?? 0) > 0,
        }
      }

      case 'kugou':
      case 'kugou_concept': {
        // Kugou encodes artist/title in filename: "Artist - Title"
        const filename = s.filename || s.fileName || ''
        const parts = filename.split(' - ')
        let trackName = filename
        let artists: string[] = []
        if (parts.length >= 2) {
          artists = parts[0]
            .split(/[、,，&]/)
            .map((a: string) => a.trim())
            .filter(Boolean)
          trackName = parts.slice(1).join(' - ')
        }
        return {
          id: nanoid(),
          title: trackName || 'Unknown',
          artist: artists.length > 0 ? artists : ['Unknown'],
          album: s.album_name || '',
          duration: s.duration || 0, // seconds
          cover: normalizeKugouCoverUrl(
            s.trans_param?.union_cover || s.audio_info?.trans_param?.union_cover || s.imgurl || s.album_img,
          ),
          source,
          sourceId: String(s.hash),
          urlId: String(s.hash),
          lyricId: String(s.hash),
          picId: String(s.hash),
          // privilege 位掩码: & 8 表示 VIP; pay_type > 0 也表示付费
          vip: ((s.privilege ?? 0) & 8) !== 0 || (s.pay_type ?? 0) > 0,
        }
      }

      case 'bilibili':
        throw new Error('Bilibili tracks are created by the native video search')

      default: {
        // Exhaustive check — if a new MusicSource is added, TypeScript will error here
        const _exhaustive: never = source
        throw new Error(`Unsupported music source: ${_exhaustive}`)
      }
    }
  }

  /**
   * Batch-resolve cover URLs for tracks that don't have one.
   * - netease/tencent: pic() is pure URL generation (instant, no API call)
   * - kugou: pic() makes an API call per track (slower)
   *
   * Each pic() call uses a fresh Meting instance to avoid race conditions.
   */
  private async batchResolveCover(tracks: Track[], source: MusicSource): Promise<void> {
    const toResolve = tracks.filter((t) => !t.cover && t.picId)
    if (toResolve.length === 0) return

    // For platforms that need API calls, limit concurrency
    const needsApiCall = source === 'kugou'
    const limit = pLimit(needsApiCall ? 3 : toResolve.length)

    await Promise.allSettled(
      toResolve.map((track) =>
        limit(async () => {
          // Check cover cache first
          const cacheKey = `${source}:${track.picId!}:300`
          const cached = this.coverCache.get(cacheKey)
          if (cached !== undefined) {
            track.cover = cached
            return
          }

          try {
            // Fresh instance per call to avoid shared state race conditions
            const instance = new Meting(source)
            const raw = await instance.pic(track.picId!, 300)
            const data = JSON.parse(raw)
            if (data.url) {
              track.cover = data.url
              this.coverCache.set(cacheKey, data.url)
            }
          } catch {
            // Leave cover empty — frontend shows placeholder
          }
        }),
      ),
    )
  }
}

export const musicProvider = new MusicProvider()
