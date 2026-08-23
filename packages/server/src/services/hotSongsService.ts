import type { HotSongsSource, Track } from '@music-together/shared'

const NETEASE_HOT_PLAYLIST_ID = '3778678'
const TENCENT_HOT_TOP_ID = 26
const KUGOU_HOT_RANK_ID = 8888
const CACHE_TTL_MS = 3 * 60 * 60 * 1000
const MAX_FETCH_LIMIT = 500

interface HotSongsCacheEntry {
  expiresAt: number
  tracks: Track[]
}

interface HotSongsProvider {
  getPlaylistPage(
    source: 'netease',
    playlistId: string,
    limit: number,
    offset: number,
    playlistTotal?: number,
    cookie?: string | null,
    type?: 'playlist',
  ): Promise<{ tracks: Track[] }>
}

type FetchLike = typeof fetch

function normalizeKugouCover(value: unknown): string {
  let url = String(value ?? '').trim().replace(/\{size\}/g, '400')
  if (url.startsWith('//')) url = `https:${url}`
  if (url.startsWith('http://')) url = url.replace(/^http:\/\//i, 'https://')
  return url.replace(/^https:\/\/imge\.kugou\.com/i, 'https://imgessl.kugou.com')
}

function normalizeKugouTrack(raw: Record<string, unknown>): Track | null {
  const hash = String(raw.hash ?? '').trim()
  if (!hash) return null
  const filename = String(raw.filename ?? raw.songname ?? '').trim()
  const separator = filename.indexOf(' - ')
  const artistText = separator >= 0 ? filename.slice(0, separator) : ''
  const title = separator >= 0 ? filename.slice(separator + 3).trim() : filename
  const artist = artistText
    .split(/[、,，&]/)
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    id: `hot-kugou-${hash}`,
    title: title || '未知歌曲',
    artist: artist.length ? artist : ['未知歌手'],
    album: String(raw.album_name ?? ''),
    duration: Number(raw.duration ?? 0) || 0,
    cover: normalizeKugouCover(
      (raw.trans_param as Record<string, unknown> | undefined)?.union_cover ?? raw.album_sizable_cover,
    ),
    source: 'kugou',
    sourceId: hash,
    urlId: hash,
    lyricId: hash,
    picId: hash,
  }
}

function normalizeTencentTrack(raw: Record<string, unknown>, rank?: Record<string, unknown>): Track | null {
  const album = (raw.album as Record<string, unknown> | undefined) ?? {}
  const singers = Array.isArray(raw.singer) ? raw.singer : []
  const artists = singers
    .map((singer) =>
      singer && typeof singer === 'object' ? String((singer as Record<string, unknown>).name ?? '') : '',
    )
    .filter(Boolean)
  const sourceId = String(raw.mid ?? raw.songmid ?? raw.id ?? rank?.songId ?? '').trim()
  if (!sourceId) return null
  const albumMid = String(album.pmid ?? album.mid ?? rank?.albumMid ?? '').trim()
  const rankCover = String(rank?.cover ?? '').trim()
  const cover = rankCover || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '')
  return {
    id: `hot-tencent-${sourceId}`,
    title: String(raw.name ?? raw.title ?? rank?.title ?? '未知歌曲'),
    artist: artists.length ? artists : [String(rank?.singerName ?? '未知歌手')],
    album: String(album.name ?? album.title ?? ''),
    duration: Number(raw.interval ?? 0) || 0,
    cover,
    source: 'tencent',
    sourceId,
    urlId: sourceId,
    lyricId: sourceId,
    picId: albumMid,
  }
}

async function fetchTencentHotSongs(limit: number, fetchImpl: FetchLike): Promise<Track[]> {
  const response = await fetchImpl('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: 'https://y.qq.com/' },
    body: JSON.stringify({
      comm: { ct: 24, cv: 0 },
      toplist: {
        module: 'musicToplist.ToplistInfoServer',
        method: 'GetDetail',
        param: { topid: TENCENT_HOT_TOP_ID, offset: 0, num: Math.min(limit, 300), period: '' },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`QQ 热歌榜请求失败 (${response.status})`)
  const payload = (await response.json()) as Record<string, unknown>
  const toplist = (payload.toplist as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined
  const metadata = (toplist?.data as Record<string, unknown> | undefined) ?? toplist
  const ranks = Array.isArray(metadata?.song) ? metadata.song : []
  const details = Array.isArray(toplist?.songInfoList) ? toplist.songInfoList : []
  const tracks = ranks
    .map((rank, index) => {
      const rankRecord = rank as Record<string, unknown>
      const detail = (details[index] as Record<string, unknown> | undefined) ?? rankRecord
      return normalizeTencentTrack(detail, rankRecord)
    })
    .filter((track): track is Track => track !== null)
  if (!tracks.length) throw new Error('QQ 热歌榜返回空结果')
  return tracks.slice(0, limit)
}

async function fetchKugouHotSongs(limit: number, fetchImpl: FetchLike): Promise<Track[]> {
  const response = await fetchImpl(
    `http://mobilecdn.kugou.com/api/v3/rank/song?rankid=${KUGOU_HOT_RANK_ID}&page=1&pagesize=${Math.min(limit, MAX_FETCH_LIMIT)}&showtype=2`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) },
  )
  if (!response.ok) throw new Error(`酷狗热歌榜请求失败 (${response.status})`)
  const payload = (await response.json()) as Record<string, unknown>
  const data = payload.data as Record<string, unknown> | undefined
  const songs = Array.isArray(data?.info) ? data.info : []
  const tracks = songs
    .map((song) => normalizeKugouTrack(song as Record<string, unknown>))
    .filter((track): track is Track => track !== null)
  if (!tracks.length) throw new Error('酷狗热歌榜返回空结果')
  return tracks.slice(0, limit)
}

export function createHotSongsService(provider: HotSongsProvider, now = Date.now, fetchImpl: FetchLike = fetch) {
  const cache = new Map<HotSongsSource, HotSongsCacheEntry>()
  const inflight = new Map<HotSongsSource, Promise<Track[]>>()

  const load = (source: HotSongsSource): Promise<Track[]> => {
    if (source === 'netease') {
      return provider
        .getPlaylistPage('netease', NETEASE_HOT_PLAYLIST_ID, MAX_FETCH_LIMIT, 0, undefined, null, 'playlist')
        .then((result) => result.tracks)
    }
    return source === 'tencent'
      ? fetchTencentHotSongs(300, fetchImpl)
      : fetchKugouHotSongs(MAX_FETCH_LIMIT, fetchImpl)
  }

  return {
    async getHotSongs(
      source: HotSongsSource,
      limit: number,
      offset = 0,
      forceRefresh = false,
    ): Promise<{ tracks: Track[]; total: number; hasMore: boolean }> {
      const safeLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_FETCH_LIMIT)
      const safeOffset = Math.min(Math.max(Math.floor(offset), 0), MAX_FETCH_LIMIT)
      const current = cache.get(source)
      if (!forceRefresh && current && current.expiresAt > now()) {
        return {
          tracks: current.tracks.slice(safeOffset, safeOffset + safeLimit),
          total: current.tracks.length,
          hasMore: safeOffset + safeLimit < current.tracks.length,
        }
      }

      let request = inflight.get(source)
      if (!request) {
        request = load(source)
          .then((tracks) => {
            if (!tracks.length) throw new Error(`${source} 热歌榜返回空结果`)
            cache.set(source, { expiresAt: now() + CACHE_TTL_MS, tracks })
            return tracks
          })
          .finally(() => inflight.delete(source))
        inflight.set(source, request)
      }
      const tracks = await request
      return {
        tracks: tracks.slice(safeOffset, safeOffset + safeLimit),
        total: tracks.length,
        hasMore: safeOffset + safeLimit < tracks.length,
      }
    },
    resetCache(source?: HotSongsSource): void {
      if (source) cache.delete(source)
      else cache.clear()
    },
  }
}

export const hotSongsPlaylistId = NETEASE_HOT_PLAYLIST_ID
export const hotSongsRankIds = { tencent: TENCENT_HOT_TOP_ID, kugou: KUGOU_HOT_RANK_ID } as const
