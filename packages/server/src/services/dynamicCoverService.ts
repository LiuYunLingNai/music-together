import { createHash } from 'node:crypto'
import ncmApi from '@neteasecloudmusicapienhanced/api'
import { LRUCache } from 'lru-cache'
import type { MusicSource, Track } from '@music-together/shared'
import { logger } from '../utils/logger.js'
import { findBestAlternativeTrack } from './trackFallbackService.js'

/**
 * 动态封面（视频封面）解析。
 *
 * 默认用酷狗源：视频通常 1080p、约 20 秒，观感比网易云固定的 4 秒片段稳定；
 * 酷狗拿不到时回退网易云。非酷狗音源先按元数据跨平台匹配目标平台的歌曲。
 * B 站曲目本身就是视频源，不做处理。
 *
 * 整个过程是纯异步旁路：调用方发一次 HTTP 请求即可，不参与房间播放/推流链路。
 */

// 签名 URL 有效期约 40 分钟，缓存只保留 10 分钟，避免下发临近过期的地址。
const CACHE_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8_000

const NETEASE_VIDEO_HOST = 'dcover.music.126.net'
const KUGOU_VIDEO_HOST = 'kgv.stream.tencentmusic.com'

// 酷狗标准版（手机版）签名参数，与 process.env.platform 无关。
const KUGOU_APP_ID = 1005
const KUGOU_CLIENT_VERSION = 20489
const KUGOU_DYCOVER_SALT = 'OIlwieks28dk2k092lksi2UIkp'

export interface DynamicCoverMeta {
  title?: string
  artists?: string[]
  duration?: number
  album?: string
}

interface SongDynamicCoverApi {
  song_dynamic_cover(params: {
    id: string | number
    crypto?: string
  }): Promise<{ body?: { data?: { videoPlayUrl?: string } } }>
}

const cache = new LRUCache<string, string>({ max: 500, ttl: CACHE_TTL_MS })
/** 同一首歌被房间里多个客户端同时请求时只跑一次上游链路。 */
const inflight = new Map<string, Promise<string | null>>()

function normalizeVideoCoverUrl(value: unknown, allowedHost: string): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.hostname.toLowerCase() !== allowedHost) return null
    url.protocol = 'https:'
    url.port = ''
    return url.toString()
  } catch {
    return null
  }
}

function fetchJson(url: string, headers?: Record<string, string>): Promise<Record<string, any>> {
  return fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<Record<string, any>>
  })
}

// ---------------------------------------------------------------------------
// 网易云
// ---------------------------------------------------------------------------

async function getNeteaseDynamicCoverUrl(id: string): Promise<string | null> {
  const response = await (ncmApi as unknown as SongDynamicCoverApi).song_dynamic_cover({ id, crypto: 'eapi' })
  return normalizeVideoCoverUrl(response.body?.data?.videoPlayUrl, NETEASE_VIDEO_HOST)
}

// ---------------------------------------------------------------------------
// 酷狗
// ---------------------------------------------------------------------------

function kugouParamString(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function kugouSignature(params: Record<string, unknown>): string {
  const joined = Object.keys(params)
    .sort()
    .map((key) => `${key}=${kugouParamString(params[key])}`)
    .join('')
  return createHash('md5').update(`${KUGOU_DYCOVER_SALT}${joined}${KUGOU_DYCOVER_SALT}`).digest('hex')
}

async function getKugouDynamicCoverUrl(hash: string): Promise<string | null> {
  const info = await fetchJson(
    `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(hash)}`,
    { 'User-Agent': 'Mozilla/5.0' },
  )
  const albumAudioId = Number(info?.album_audio_id)
  if (!albumAudioId) return null
  const albumId = Number(info?.albumid ?? info?.req_albumid ?? 0) || 0

  const data = [{ album_audio_id: albumAudioId, ...(albumId > 0 ? { album_id: albumId } : {}) }]
  const params = {
    appid: KUGOU_APP_ID,
    clientver: KUGOU_CLIENT_VERSION,
    data,
    isCdn: 1,
    query: 'audioPlay',
  }
  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(kugouParamString(params[key as keyof typeof params]))}`)
    .join('&')
  const signature = kugouSignature(params)

  const response = await fetchJson(`https://kmrcdn.service.kugou.com/v2/album/audio?${query}&signature=${signature}`, {
    dfid: '-',
    mid: 'undefined',
    clienttime: String(Math.floor(Date.now() / 1000)),
  })
  return normalizeVideoCoverUrl(response?.data?.[0]?.dycover?.h264_url, KUGOU_VIDEO_HOST)
}

// ---------------------------------------------------------------------------
// 跨源匹配
// ---------------------------------------------------------------------------

/** 匹配器只依赖标题/歌手/时长/专辑，其它字段用占位值即可。 */
function toMatchTrack(source: MusicSource, id: string, meta: DynamicCoverMeta): Track | null {
  if (!meta.title || !meta.artists?.length) return null
  return {
    id: 'dynamic-cover',
    source,
    sourceId: id,
    urlId: id,
    title: meta.title,
    artist: meta.artists,
    album: meta.album ?? '',
    duration: meta.duration && meta.duration > 0 ? meta.duration : 0,
    cover: '',
  }
}

async function findMatchedTrack(
  source: MusicSource,
  id: string,
  meta: DynamicCoverMeta,
  target: MusicSource,
): Promise<Track | null> {
  const original = toMatchTrack(source, id, meta)
  if (!original) return null
  try {
    const best = await findBestAlternativeTrack(original, target)
    return best?.track ?? null
  } catch {
    // 跨源匹配只是锦上添花；匹配接口失败不能阻断本平台自己的动态封面回退。
    return null
  }
}

// ---------------------------------------------------------------------------
// 解析策略：酷狗优先，网易云回退
// ---------------------------------------------------------------------------

async function resolveDynamicCover(source: MusicSource, id: string, meta: DynamicCoverMeta): Promise<string | null> {
  if (source === 'bilibili') return null

  if (source === 'kugou' || source === 'kugou_concept') {
    const direct = await getKugouDynamicCoverUrl(id)
    if (direct) return direct
    const netease = await findMatchedTrack(source, id, meta, 'netease')
    return netease ? getNeteaseDynamicCoverUrl(netease.urlId) : null
  }

  if (source === 'netease') {
    const kugou = await findMatchedTrack(source, id, meta, 'kugou')
    const kugouUrl = kugou ? await getKugouDynamicCoverUrl(kugou.urlId) : null
    if (kugouUrl) return kugouUrl
    return getNeteaseDynamicCoverUrl(id)
  }

  const kugou = await findMatchedTrack(source, id, meta, 'kugou')
  const kugouUrl = kugou ? await getKugouDynamicCoverUrl(kugou.urlId) : null
  if (kugouUrl) return kugouUrl
  const netease = await findMatchedTrack(source, id, meta, 'netease')
  return netease ? getNeteaseDynamicCoverUrl(netease.urlId) : null
}

/** 动态封面地址；无封面或解析失败返回 null。空结果同样缓存，避免反复打上游。 */
export async function getDynamicCoverUrl(
  source: MusicSource,
  id: string,
  meta: DynamicCoverMeta = {},
): Promise<string | null> {
  const key = `${source}:${id}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached || null

  const running = inflight.get(key)
  if (running) return running

  const task = resolveDynamicCover(source, id, meta)
    .catch((err) => {
      logger.warn('Dynamic cover lookup failed', { source, id, err })
      return null
    })
    .then((url) => {
      cache.set(key, url ?? '')
      return url
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, task)
  return task
}
