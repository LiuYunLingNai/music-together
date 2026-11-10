import {
  searchQuerySchema,
  unifiedSearchQuerySchema,
  urlQuerySchema,
  likedQuerySchema,
  likedSetSchema,
  lyricQuerySchema,
  lyricSupplementQuerySchema,
  lyricCandidatesQuerySchema,
  fallbackCandidatesQuerySchema,
  ttmlQuerySchema,
  amllTtmlQuerySchema,
  coverQuerySchema,
  dynamicCoverQuerySchema,
  downloadOptionsQuerySchema,
  downloadQuerySchema,
  playlistQuerySchema,
  recommendationsQuerySchema,
  hotSongsQuerySchema,
  type Track,
  type MusicSource,
  type PlatformRecommendation,
} from '@music-together/shared'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ZodSchema } from 'zod'
import { musicProvider } from '../services/musicProvider.js'
import { resolveStream } from '../services/streamResolutionService.js'
import * as trackFallbackService from '../services/trackFallbackService.js'
import { searchAllSources } from '../services/unifiedSearchService.js'
import * as authService from '../services/authService.js'
import { getEffectiveQuality } from '../services/audioQualityPolicy.js'
import { getDynamicCoverUrl } from '../services/dynamicCoverService.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { audioProxyPolicyRepo } from '../repositories/audioProxyPolicyRepository.js'
import { logger } from '../utils/logger.js'
import {
  createKugouDecryptStream,
  getKugouEncryptedAudio,
  kugouAudioContentType,
} from '../services/kugouEncryptedAudio.js'
import { isIssuedKugouAudio, isKugouProxyRequiredAudio } from '../services/kugouAudioProxy.js'
import {
  canRedirectKugouAudioDirect,
  isKugouEncryptedAudioUrl,
  normalizeKugouAudioUrl,
} from '../services/kugouAudioUrl.js'
import { BILIBILI_BVID_PATTERN, BILIBILI_STREAM_ID_PATTERN } from '../services/bilibiliInput.js'
import { MusicDownloadError, resolveDownloadOptions, streamDownload } from '../services/musicDownloadService.js'
import { audioProxyRateLimit, musicMetadataRateLimit } from '../middleware/httpRateLimiter.js'
import { createHotSongsService, hotSongsPlaylistId } from '../services/hotSongsService.js'
import { LyricSupplementService } from '../services/lyricSupplementService.js'
import { getTtml, TtmlProxyError } from '../services/ttmlProxyService.js'
import { getAmllTtml, searchAmllCandidates, searchAmllTtml } from '../services/amllLyricsService.js'

const router: RouterType = Router()
const hotSongsService = createHotSongsService(musicProvider)
const lyricSupplementService = new LyricSupplementService(musicProvider)

const LYRIC_TIMING_TAG = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]|\[\d+,\d+\]|\(\d+,\d+,\d+\)|<[^>]+>/g
const LYRIC_META_LINE = /^\s*\[[a-z][^\]]*:.*]\s*$/i

function lyricPreview(text: string): string {
  const qrc = text.match(/LyricContent="([\s\S]*?)"/)?.[1]
  const content = (qrc ?? text).replace(/&quot;/g, '"').replace(/&#10;/g, '\n')
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(LYRIC_TIMING_TAG, '').trim()
    if (!line || LYRIC_META_LINE.test(line) || /^[/.\s]+$/.test(line)) continue
    return line.slice(0, 80)
  }
  return ''
}

/**
 * Wrap an async route handler with validation + error handling.
 * Eliminates repeated try/catch + Zod boilerplate in each route.
 */
function validated<T>(
  schema: ZodSchema<T>,
  label: string,
  handler: (data: T, req: Request, res: Response) => Promise<void>,
) {
  return async (req: Request, res: Response) => {
    try {
      const parsed = schema.safeParse(req.query)
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query parameters' })
        return
      }
      await handler(parsed.data, req, res)
    } catch (err) {
      logger.error(`${label} failed`, err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

router.get(
  '/search',
  musicMetadataRateLimit,
  validated(searchQuerySchema, 'Search', async (data, _req, res) => {
    const { source, keyword, limit: pageSize, page: pageNum, type, roomId } = data

    let cookie: string | null = null
    if (roomId) {
      const identityUserId = _req.identityUserId
      if (identityUserId) {
        const room = roomRepo.get(roomId)
        if (room && room.users.some((u) => u.id === identityUserId)) {
          cookie = authService.getUserCookie(identityUserId, source, roomId)
        }
      }
    }

    if (type === 'album') {
      const albums = await musicProvider.searchAlbum(source, keyword, pageSize, pageNum, cookie)
      res.json({ tracks: albums, page: pageNum, hasMore: albums.length >= pageSize })
    } else if (type === 'artist') {
      const artists = await musicProvider.searchArtist(source, keyword, pageSize, pageNum, cookie)
      res.json({ tracks: artists, page: pageNum, hasMore: artists.length >= pageSize })
    } else if (type === 'playlist') {
      const playlists = await musicProvider.searchPlaylist(source, keyword, pageSize, pageNum, cookie)
      res.json({ tracks: playlists, page: pageNum, hasMore: playlists.length >= pageSize })
    } else {
      const tracks = await musicProvider.search(source, keyword, pageSize, pageNum, cookie)
      res.json({ tracks, page: pageNum, hasMore: tracks.length >= pageSize })
    }
  }),
)

router.get(
  '/search-all',
  musicMetadataRateLimit,
  validated(unifiedSearchQuerySchema, 'Unified search', async (data, _req, res) => {
    const { keyword, limit, roomId } = data
    const identityUserId = _req.identityUserId
    const room = roomId ? roomRepo.get(roomId) : undefined
    const canUseRoomAuth = Boolean(roomId && identityUserId && room?.users.some((user) => user.id === identityUserId))
    const cookieFor = (source: MusicSource): string | null =>
      canUseRoomAuth && identityUserId && roomId ? authService.getUserCookie(identityUserId, source, roomId) : null
    res.json(await searchAllSources(keyword, limit, cookieFor))
  }),
)

router.get('/bilibili-collection', musicMetadataRateLimit, async (req: Request, res: Response) => {
  const bvid = typeof req.query.bvid === 'string' ? req.query.bvid.trim() : ''
  if (!BILIBILI_BVID_PATTERN.test(bvid)) {
    res.status(400).json({ error: 'Invalid Bilibili video id' })
    return
  }

  try {
    const collection = await musicProvider.getBilibiliCollection(bvid)
    res.json(collection)
  } catch (err) {
    logger.error('Get Bilibili collection failed', err, { bvid })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get(
  '/recommendations',
  musicMetadataRateLimit,
  validated(
    recommendationsQuerySchema,
    'Get recommendations',
    async (
      { roomId, platform: requestedPlatform, limit, radarPage, playlistOffset, neteasePlaylistOffset },
      req,
      res,
    ) => {
      const identityUserId = req.identityUserId
      if (!identityUserId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const room = roomRepo.get(roomId)
      if (!room || !room.users.some((user) => user.id === identityUserId)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }

      const loggedPlatforms = authService
        .getUserAuthStatus(identityUserId, roomId)
        .filter((status) => status.loggedIn && (!requestedPlatform || status.platform === requestedPlatform))
        .map((status) => status.platform)

      const recommendations = await Promise.all(
        loggedPlatforms.map(async (platform): Promise<PlatformRecommendation> => {
          const cookie = authService.getUserCookie(identityUserId, platform, roomId)
          const emptyResult =
            platform === 'bilibili' ? { platform, tracks: [] } : { platform, tracks: [], playlists: [] }
          if (!cookie) return { ...emptyResult, unavailableReason: 'upstream_unavailable' }

          try {
            const recommendationLimit = platform === 'bilibili' ? 20 : limit
            const result = await musicProvider.getRecommendations(platform, cookie, recommendationLimit, {
              radarPage,
              playlistOffset,
              neteasePlaylistOffset,
            })
            const hasContent = result.tracks.length > 0 || (result.playlists?.length ?? 0) > 0
            return hasContent ? { platform, ...result } : { platform, ...result, unavailableReason: 'empty' }
          } catch (err) {
            logger.warn('Platform recommendation feed failed', { platform, roomId, identityUserId, err })
            return { ...emptyResult, unavailableReason: 'upstream_unavailable' }
          }
        }),
      )

      res.setHeader('Cache-Control', 'private, no-store')
      res.json({ recommendations })
    },
  ),
)

router.get(
  '/hot',
  musicMetadataRateLimit,
  validated(hotSongsQuerySchema, 'Get hot songs', async ({ roomId, source, limit, offset, refresh }, req, res) => {
    const identityUserId = req.identityUserId
    if (!identityUserId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const room = roomRepo.get(roomId)
    if (!room || !room.users.some((user) => user.id === identityUserId)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const result = await hotSongsService.getHotSongs(source, limit, offset, refresh)
    res.setHeader('Cache-Control', 'private, max-age=300')
    const names = { netease: '网易云热歌榜', tencent: 'QQ 音乐热歌榜', kugou: '酷狗热歌榜' } as const
    res.json({
      id: source === 'netease' ? hotSongsPlaylistId : source,
      source,
      name: names[source],
      ...result,
      offset,
    })
  }),
)

router.get(
  '/url',
  musicMetadataRateLimit,
  validated(urlQuerySchema, 'Get stream URL', async (data, _req, res) => {
    const { source, urlId, bitrate, roomId, purpose } = data
    let cookie: string | undefined
    let vipType: 0 | 1 | 2 = 0
    let quality = bitrate
    if (roomId) {
      const identityUserId = _req.identityUserId
      const room = roomRepo.get(roomId)
      const trackInRoom = Boolean(
        room &&
        ((room.currentTrack?.source === source && room.currentTrack.urlId === urlId) ||
          room.queue.some((item) => item.source === source && item.urlId === urlId)),
      )
      if (identityUserId && trackInRoom && room?.users.some((user) => user.id === identityUserId)) {
        const auth = authService.getBestAuth(source, roomId)
        if (auth) {
          cookie = auth.cookie
          vipType = auth.vipType
        }
        quality = getEffectiveQuality(source, bitrate, vipType)
      }
    }
    const stream = await resolveStream(source, urlId, quality, { cookie, vipType, purpose })
    res.json({ url: stream?.url ?? null })
  }),
)

router.get(
  '/liked',
  musicMetadataRateLimit,
  validated(likedQuerySchema, 'Get liked state', async ({ source, id, roomId }, req, res) => {
    if (source !== 'netease') {
      res.json({ liked: false })
      return
    }
    const identityUserId = req.identityUserId
    const room = roomRepo.get(roomId)
    if (!identityUserId || !room || !room.users.some((user) => user.id === identityUserId)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    const cookie = authService.getUserCookie(identityUserId, source, roomId)
    if (!cookie) {
      res.json({ liked: false })
      return
    }
    res.json({ liked: await musicProvider.isNeteaseLiked(cookie, id) })
  }),
)

router.post('/liked', musicMetadataRateLimit, async (req, res) => {
  const parsed = likedSetSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    return
  }
  const { source, id, roomId, liked } = parsed.data
  if (source !== 'netease') {
    res.status(400).json({ error: '该平台暂不支持喜欢操作' })
    return
  }
  const identityUserId = req.identityUserId
  const room = roomRepo.get(roomId)
  if (!identityUserId || !room || !room.users.some((user) => user.id === identityUserId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const cookie = authService.getUserCookie(identityUserId, source, roomId)
  if (!cookie) {
    res.status(401).json({ error: '请先登录网易云账号' })
    return
  }
  const ok = await musicProvider.setNeteaseLiked(cookie, id, liked)
  res.status(ok ? 200 : 502).json({ liked: ok ? liked : !liked, ok })
})

function getAuthorizedCurrentTrack(roomId: string, trackId: string, req: Request, res: Response): Track | null {
  const identityUserId = req.identityUserId
  if (!identityUserId) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  const room = roomRepo.get(roomId)
  if (!room || !room.users.some((user) => user.id === identityUserId)) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  if (!room.currentTrack || room.currentTrack.id !== trackId) {
    res.status(404).json({ error: '当前歌曲已切换' })
    return null
  }
  return room.currentTrack
}

router.get(
  '/download-options',
  musicMetadataRateLimit,
  validated(downloadOptionsQuerySchema, 'Get download options', async ({ roomId, trackId }, req, res) => {
    const track = getAuthorizedCurrentTrack(roomId, trackId, req, res)
    if (!track) return
    const result = await resolveDownloadOptions(roomId, track)
    if (roomRepo.get(roomId)?.currentTrack?.id !== track.id) {
      res.status(409).json({ error: '当前歌曲已切换' })
      return
    }
    res.setHeader('Cache-Control', 'private, no-store')
    res.json(result)
  }),
)

router.get('/download', async (req: Request, res: Response) => {
  const parsed = downloadQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query parameters' })
    return
  }

  const { roomId, trackId, quality } = parsed.data
  const track = getAuthorizedCurrentTrack(roomId, trackId, req, res)
  if (!track) return

  try {
    await streamDownload(req, res, roomId, track, quality)
  } catch (error) {
    if (req.aborted) return
    logger.error('Music download failed', error, { roomId, trackId, source: track.source, quality })
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined)
      return
    }
    const statusCode = error instanceof MusicDownloadError ? error.statusCode : 500
    const message = error instanceof MusicDownloadError ? error.message : '下载失败'
    res.status(statusCode).json({ error: message })
  }
})

router.get(
  '/lyric',
  musicMetadataRateLimit,
  validated(lyricQuerySchema, 'Get lyric', async (data, _req, res) => {
    const { source, lyricId } = data
    const result = await musicProvider.getLyric(source, lyricId)
    const hasLyric = !!(result.lyric || result.yrc || result.wordLyric || result.wordByWord?.length)
    res.setHeader('Cache-Control', hasLyric ? 'private, max-age=3600' : 'private, no-store')
    res.json(result)
  }),
)

router.get(
  '/lyric-supplement',
  musicMetadataRateLimit,
  validated(lyricSupplementQuerySchema, 'Get lyric supplement', async (data, _req, res) => {
    const result = await lyricSupplementService.getSupplement(data)
    res.setHeader('Cache-Control', result.source ? 'private, max-age=3600' : 'private, no-store')
    res.json(result)
  }),
)

router.get(
  '/lyric-candidates',
  musicMetadataRateLimit,
  validated(lyricCandidatesQuerySchema, 'Get lyric candidates', async (data, _req, res) => {
    const [result, ttmlCandidates] = await Promise.all([
      data.source && data.lyricId
        ? lyricSupplementService.getSupplement({
            source: data.source,
            lyricId: data.lyricId,
            title: data.title,
            artists: data.artists,
            duration: data.duration,
          })
        : null,
      searchAmllCandidates({ title: data.title, artists: data.artists, duration: data.duration }).catch(() => []),
    ])
    res.setHeader(
      'Cache-Control',
      result?.candidates?.length || ttmlCandidates.length ? 'private, max-age=600' : 'private, no-store',
    )
    res.json({
      candidates: (result?.candidates ?? []).map(
        ({ source, lyricId, title, artist, duration, lyric, wordLyric, yrc, wordByWord, matchScore }) => ({
          source,
          lyricId,
          title,
          artist,
          duration,
          preview: lyricPreview(lyric || wordLyric || yrc || ''),
          hasWordTiming: Boolean(wordByWord?.length || wordLyric || yrc),
          matchScore,
        }),
      ),
      ttmlCandidates,
    })
  }),
)

router.get(
  '/fallback-candidates',
  musicMetadataRateLimit,
  validated(fallbackCandidatesQuerySchema, 'Get fallback candidates', async (data, _req, res) => {
    const original: Track = {
      id: 'fallback-query',
      title: data.title,
      artist: data.artists,
      album: data.album ?? '',
      duration: data.duration,
      cover: '',
      source: data.source,
      sourceId: '',
      urlId: '',
    }
    const candidates = await trackFallbackService.findAlternativeTracks(original)
    res.setHeader('Cache-Control', candidates.length ? 'private, max-age=120' : 'private, no-store')
    res.json({ candidates })
  }),
)

router.get(
  '/ttml',
  musicMetadataRateLimit,
  validated(ttmlQuerySchema, 'Get TTML', async (data, req, res) => {
    try {
      const ifNoneMatch = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined
      const result = await getTtml(data.url, ifNoneMatch)
      if (!result) {
        res.status(404).end()
        return
      }
      res.setHeader('ETag', result.etag)
      if (result.notModified) {
        res.status(304).end()
        return
      }
      res.setHeader('Content-Type', 'application/ttml+xml; charset=utf-8')
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
      res.status(200).send(result.body)
    } catch (error) {
      const statusCode = error instanceof TtmlProxyError ? error.statusCode : 502
      let host = 'invalid'
      try {
        host = new URL(data.url).hostname
      } catch {
        // Keep the log useful even when the client sent an invalid URL.
      }
      logger.warn('TTML 代理请求失败', {
        statusCode,
        host,
        message: error instanceof Error ? error.message : String(error),
      })
      res.status(statusCode).json({ error: 'TTML unavailable' })
    }
  }),
)

router.get(
  '/amll-ttml',
  musicMetadataRateLimit,
  validated(amllTtmlQuerySchema, 'Get AMLL TTML', async (data, req, res) => {
    const ifNoneMatch = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined
    let result = await getAmllTtml(data.platform, data.id, ifNoneMatch)
    if (!result && data.title) {
      result = await searchAmllTtml(
        data.platform,
        { title: data.title, artists: data.artists ?? [], album: data.album, duration: data.duration },
        ifNoneMatch,
      )
    }
    if (!result) {
      res.status(404).end()
      return
    }
    res.setHeader('ETag', result.etag)
    if (result.notModified) {
      res.status(304).end()
      return
    }
    res.setHeader('Content-Type', 'application/ttml+xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
    res.status(200).send(result.body)
  }),
)

router.get(
  '/cover',
  musicMetadataRateLimit,
  validated(coverQuerySchema, 'Get cover', async (data, _req, res) => {
    const { source, picId, size } = data
    const url = await musicProvider.getCover(source, picId, size)
    res.json({ url })
  }),
)

router.get(
  '/dynamic-cover',
  musicMetadataRateLimit,
  validated(dynamicCoverQuerySchema, 'Get dynamic cover', async (data, _req, res) => {
    const { source, id, title, artists, duration, album } = data
    const url = await getDynamicCoverUrl(source, id, { title, artists, duration, album })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ url })
  }),
)

router.get(
  '/playlist',
  musicMetadataRateLimit,
  validated(playlistQuerySchema, 'Get playlist', async (data, _req, res) => {
    const { source, id, limit, offset, total, roomId, type } = data

    let cookie: string | null = null
    if (roomId) {
      const identityUserId = _req.identityUserId
      if (!identityUserId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      const room = roomRepo.get(roomId)
      if (!room || !room.users.some((u) => u.id === identityUserId)) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      // 歌单详情属于个人数据：只认请求者自己的凭据，不回退到房间共享账号。
      cookie = authService.getUserCookie(identityUserId, source, roomId)
    }

    const result = await musicProvider.getPlaylistPage(source, id, limit, offset, total, cookie, type)
    res.json({ tracks: result.tracks, total: result.total, offset, hasMore: result.hasMore })
  }),
)

// ---------------------------------------------------------------------------
// 封面图片代理 — 解决外部 CDN（如 QQ 音乐 y.gtimg.cn）的 CORS 限制
// AMLL 的 BackgroundRender 用 WebGL 纹理加载图片，需要同源或 CORS 允许
// ---------------------------------------------------------------------------
const ALLOWED_COVER_HOSTS = [
  'y.gtimg.cn',
  'y.qq.com',
  'ly.qq.com',
  'qpic.y.qq.com',
  'p1.music.126.net',
  'p2.music.126.net',
  'p3.music.126.net',
  'p4.music.126.net',
  'imgessl.kugou.com',
]

const MAX_COVER_BYTES = 10 * 1024 * 1024
const MAX_COVER_REDIRECTS = 3

const BILIBILI_AUDIO_HOST_SUFFIXES = ['bilivideo.com', 'bilivideo.cn']
const KUGOU_AUDIO_HOST_SUFFIXES = ['kugou.com', 'kugou.net']
const KUGOU_UPSTREAM_CONNECT_TIMEOUT_MS = 15_000

function isAllowedCoverUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (!url.port || url.port === '443') &&
      ALLOWED_COVER_HOSTS.includes(url.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

function normalizeCoverProxyUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (
      url.protocol === 'http:' &&
      (!url.port || url.port === '80') &&
      ALLOWED_COVER_HOSTS.includes(url.hostname.toLowerCase())
    ) {
      url.protocol = 'https:'
      url.port = ''
    }
    return isAllowedCoverUrl(url.toString()) ? url.toString() : null
  } catch {
    return null
  }
}

async function fetchAllowedCover(initialUrl: string): Promise<globalThis.Response | null> {
  let currentUrl = initialUrl
  for (let redirectCount = 0; redirectCount <= MAX_COVER_REDIRECTS; redirectCount += 1) {
    if (!isAllowedCoverUrl(currentUrl)) return null
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (response.status < 300 || response.status >= 400) return response

    const location = response.headers.get('location')
    if (!location || redirectCount === MAX_COVER_REDIRECTS) return null
    currentUrl = new URL(location, currentUrl).toString()
  }
  return null
}

function isAllowedBilibiliAudioUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return false
    const hostname = url.hostname.toLowerCase()
    return BILIBILI_AUDIO_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

function isAllowedKugouAudioUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || (url.port && url.port !== '80' && url.port !== '443'))
      return false
    const hostname = url.hostname.toLowerCase()
    return KUGOU_AUDIO_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

router.get('/cover-proxy', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string | undefined
  if (!imageUrl) {
    res.status(400).json({ error: 'Missing url parameter' })
    return
  }

  try {
    // Older rooms and native clients may still retain provider-issued HTTP
    // artwork URLs. Upgrade only exact allowlisted hosts before applying the
    // normal HTTPS and redirect policy.
    const normalizedImageUrl = normalizeCoverProxyUrl(imageUrl)
    if (!normalizedImageUrl) {
      res.status(403).json({ error: 'Host not allowed' })
      return
    }

    const response = await fetchAllowedCover(normalizedImageUrl)
    if (!response) {
      res.status(403).json({ error: 'Redirect host not allowed' })
      return
    }

    if (!response.ok) {
      res.status(response.status).json({ error: 'Upstream fetch failed' })
      return
    }

    const contentType = response.headers.get('content-type') || ''
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (!contentType.toLowerCase().startsWith('image/')) {
      res.status(415).json({ error: 'Upstream response is not an image' })
      return
    }
    if (Number.isFinite(contentLength) && contentLength > MAX_COVER_BYTES) {
      res.status(413).json({ error: 'Image is too large' })
      return
    }

    // 这里不要直接 pipe web stream。
    // 上游 CDN 超时/中断时，Readable 的异步 error 可能逃出当前 try/catch，导致 Node 进程崩溃。
    // 封面图体积小，直接读成 buffer 更稳，失败也会在当前 await 中被 catch。
    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_COVER_BYTES) {
      res.status(413).json({ error: 'Image is too large' })
      return
    }
    const buffer = Buffer.from(arrayBuffer)

    // 透传 content-type，设置缓存（封面图不会频繁变化）
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Cache-Control', 'public, max-age=86400') // 24h 缓存
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(200).end(buffer)
  } catch (err) {
    logger.error('Cover proxy failed', err, { imageUrl })
    if (!res.headersSent) {
      res.status(504).json({ error: 'Cover proxy failed' })
    } else {
      res.end()
    }
  }
})

/**
 * Browsers cannot reliably request Bilibili's audio CDN directly: its CORS
 * and referer rules vary between CDN nodes. Keep the upstream URL constrained
 * to Bilibili-owned audio CDNs and proxy byte ranges for the HTML5 player.
 */
router.get('/bilibili-audio-proxy', async (req: Request, res: Response) => {
  const audioUrl = typeof req.query.url === 'string' ? req.query.url : ''
  const bvid = typeof req.query.bvid === 'string' ? req.query.bvid : ''
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : ''
  const room = roomRepo.get(roomId)
  const isCurrentTrack =
    room?.currentTrack?.source === 'bilibili' &&
    room.currentTrack.urlId === bvid &&
    room.currentTrack.streamUrl === audioUrl
  if (!isAllowedBilibiliAudioUrl(audioUrl) || !BILIBILI_STREAM_ID_PATTERN.test(bvid) || !isCurrentTrack) {
    res.status(400).json({ error: 'Invalid Bilibili audio request' })
    return
  }

  const controller = new AbortController()
  req.once('aborted', () => controller.abort())

  try {
    const range = req.headers.range
    const cookie = authService.getAnyCookie('bilibili', roomId)
    const headers = {
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Referer: `https://www.bilibili.com/video/${bvid}/`,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(typeof range === 'string' ? { Range: range } : {}),
    }
    let upstream: globalThis.Response | null = null
    let upstreamUrl = audioUrl

    // Validate every redirect target instead of allowing fetch() to follow a
    // Bilibili CDN response to an arbitrary host.
    for (let redirects = 0; redirects < 4; redirects += 1) {
      const response = await fetch(upstreamUrl, { signal: controller.signal, headers, redirect: 'manual' })
      if (response.status < 300 || response.status >= 400) {
        upstream = response
        break
      }
      const location = response.headers.get('location')
      if (!location) break
      const nextUrl = new URL(location, upstreamUrl).toString()
      if (!isAllowedBilibiliAudioUrl(nextUrl)) break
      upstreamUrl = nextUrl
    }

    if (!upstream) {
      res.status(502).json({ error: 'Invalid Bilibili audio redirect' })
      return
    }

    if (!upstream.ok && upstream.status !== 206) {
      logger.warn('Bilibili audio proxy upstream request failed', { status: upstream.status, bvid })
      res.status(upstream.status).json({ error: 'Bilibili audio request failed' })
      return
    }
    if (!upstream.body) {
      res.status(502).json({ error: 'Bilibili audio response was empty' })
      return
    }

    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding']) {
      const value = upstream.headers.get(header)
      if (value) res.setHeader(header, value)
    }
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(upstream.status)

    await pipeline(Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream), res)
  } catch (err) {
    if (controller.signal.aborted) return
    logger.error('Bilibili audio proxy failed', err, { bvid })
    if (!res.headersSent) res.status(502).json({ error: 'Bilibili audio proxy failed' })
    else res.destroy(err instanceof Error ? err : undefined)
  }
})

/**
 * KuGou's CDN URLs are signed but frequently omit browser CORS headers,
 * especially for Concept Edition's lossless resources. Standard plain audio
 * may be redirected to the CDN when policy allows; protected resources stay
 * proxied and preserve byte ranges so the HTML5 player can seek normally.
 */
router.get('/kugou-audio-proxy', audioProxyRateLimit, async (req: Request, res: Response) => {
  const audioUrl = typeof req.query.url === 'string' ? req.query.url : ''
  if (!isAllowedKugouAudioUrl(audioUrl)) {
    res.status(400).json({ error: 'Invalid Kugou audio URL' })
    return
  }
  // Only forward URLs this server resolved; any other kugou.com path would turn
  // the endpoint into an open proxy serving third-party content from our origin.
  const encryptedAudio = getKugouEncryptedAudio(audioUrl)
  if (!isIssuedKugouAudio(audioUrl) && !encryptedAudio && !isKugouProxyRequiredAudio(audioUrl)) {
    res.status(403).json({ error: 'Unknown Kugou audio URL' })
    return
  }

  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  let upstreamTimedOut = false
  const upstreamTimeout = setTimeout(() => {
    upstreamTimedOut = true
    controller.abort()
  }, KUGOU_UPSTREAM_CONNECT_TIMEOUT_MS)

  try {
    // The Web player still targets this endpoint for backwards compatibility.
    // When standard Kugou is allowed to go direct, redirect before fetching any
    // bytes so the server is not part of the audio data path. Concept Edition
    // and registered QMC2 resources must retain the proxy/decryption path.
    const requiresServerProxy =
      Boolean(encryptedAudio) || isKugouProxyRequiredAudio(audioUrl) || isKugouEncryptedAudioUrl(audioUrl)
    if (canRedirectKugouAudioDirect(audioUrl, audioProxyPolicyRepo.get().kugouForceProxy, requiresServerProxy)) {
      res.redirect(307, normalizeKugouAudioUrl(audioUrl))
      return
    }

    const range = req.headers.range
    const headers = {
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Referer: 'https://www.kugou.com/',
      ...(typeof range === 'string' ? { Range: range } : {}),
    }
    let upstream: globalThis.Response | null = null
    let upstreamUrl = normalizeKugouAudioUrl(audioUrl)

    for (let redirects = 0; redirects < 4; redirects += 1) {
      const response = await fetch(upstreamUrl, { signal: controller.signal, headers, redirect: 'manual' })
      if (response.status < 300 || response.status >= 400) {
        upstream = response
        break
      }
      const location = response.headers.get('location')
      if (!location) break
      const nextUrl = normalizeKugouAudioUrl(new URL(location, upstreamUrl).toString())
      if (!isAllowedKugouAudioUrl(nextUrl)) break
      upstreamUrl = nextUrl
    }
    clearTimeout(upstreamTimeout)

    if (!upstream) {
      res.status(502).json({ error: 'Invalid Kugou audio redirect' })
      return
    }
    if (!upstream.ok && upstream.status !== 206) {
      logger.warn('酷狗音频代理的上游请求失败', { status: upstream.status })
      res.status(upstream.status).json({ error: 'Kugou audio request failed' })
      return
    }
    if (!upstream.body) {
      res.status(502).json({ error: 'Kugou audio response was empty' })
      return
    }

    for (const header of ['content-length', 'content-range', 'accept-ranges', 'content-encoding']) {
      const value = upstream.headers.get(header)
      if (value) res.setHeader(header, value)
    }
    const upstreamType = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    const contentType = encryptedAudio
      ? kugouAudioContentType(encryptedAudio.format)
      : /^(?:audio|video)\/[\w.+-]+$/.test(upstreamType)
        ? upstreamType
        : 'application/octet-stream'
    res.setHeader('Content-Type', contentType)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(upstream.status)

    const source = Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream)
    if (encryptedAudio) {
      const contentRange = upstream.headers.get('content-range')
      const rangeStart = contentRange?.match(/^bytes (\d+)-\d+\/\d+$/i)?.[1]
      const startOffset = rangeStart ? Number(rangeStart) : 0
      await pipeline(source, createKugouDecryptStream(encryptedAudio.cipher, startOffset), res)
    } else {
      await pipeline(source, res)
    }
  } catch (err) {
    clearTimeout(upstreamTimeout)
    if (upstreamTimedOut) {
      const upstream = new URL(audioUrl)
      logger.warn('酷狗音频代理连接上游超时', {
        host: upstream.hostname,
        protocol: upstream.protocol,
        timeoutMs: KUGOU_UPSTREAM_CONNECT_TIMEOUT_MS,
      })
      if (!res.headersSent) res.status(504).json({ error: 'Kugou audio upstream timed out' })
      else res.destroy()
      return
    }
    if (controller.signal.aborted) return
    logger.error('酷狗音频代理失败', err)
    if (!res.headersSent) res.status(502).json({ error: 'Kugou audio proxy failed' })
    else res.destroy(err instanceof Error ? err : undefined)
  } finally {
    clearTimeout(upstreamTimeout)
  }
})

export default router
