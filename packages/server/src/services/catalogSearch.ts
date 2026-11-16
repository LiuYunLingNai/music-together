import Meting from '@meting/core'
import { MUSIC_SOURCE_CAPABILITIES, type MusicSource, type Track } from '@music-together/shared'
import ncmApi from '@neteasecloudmusicapienhanced/api'
import { nanoid } from 'nanoid'
import { logger } from '../utils/logger.js'
import { getCoverArtwork, normalizeKugouCoverUrl } from './coverArtwork.js'
import { withTimeoutOrNull as withTimeout } from '../utils/withTimeout.js'
import { SearchError } from './catalogUtils.js'

function failedSearch(label: string, err: unknown): never {
  if (err instanceof SearchError) throw err
  logger.error(label, err)
  throw new SearchError()
}

/** Meting 的网易云原始答复：业务码非 200（限流等）是拒绝而不是"无结果"。 */
async function neteaseRaw(type: number, keyword: string, limit: number, page: number): Promise<any> {
  const meting = new Meting('netease')
  meting.format(false) // Important: don't format because format expects songs
  const raw = await withTimeout(meting.search(keyword, { limit, page, type } as any))
  if (!raw) throw new SearchError()
  let data: any
  try {
    data = JSON.parse(raw as string)
  } catch {
    throw new SearchError()
  }
  if (typeof data !== 'object' || data === null || (data.code !== undefined && data.code !== 200)) {
    logger.warn('NetEase catalog search returned business code', { code: data?.code })
    throw new SearchError()
  }
  return data
}

/**
 * Search for albums. Returns a list of Playlist objects.
 */
export async function searchAlbums(
  source: MusicSource,
  keyword: string,
  limit = 20,
  page = 1,
  cookie?: string | null,
): Promise<import('@music-together/shared').Playlist[]> {
  if (!keyword.trim()) return []

  try {
    if (!MUSIC_SOURCE_CAPABILITIES[source].album) return []

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

      if (!response) throw new SearchError()

      const result = response['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
      if (result?.code !== 0) throw new SearchError()
      if (!result?.data?.body?.album?.list) return []

      return result.data.body.album.list.map((album: any) => ({
        id: String(album.albumMID || album.albumID),
        name: album.albumName || 'Unknown Album',
        ...getCoverArtwork('tencent', album.albumPic || ''),
        trackCount: album.song_count || 0,
        source: 'tencent',
        creator: album.singerName || '',
      }))
    }

    if (source === 'kugou') {
      const url = `http://mobilecdn.kugou.com/api/v3/search/album?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
      const response = await withTimeout(fetch(url).then((res) => res.json()))

      if (!response || response.errcode !== 0) throw new SearchError()
      if (!response.data?.info) return []

      return response.data.info.map((album: any) => ({
        id: String(album.albumid),
        name: album.albumname || 'Unknown Album',
        ...getCoverArtwork('kugou', normalizeKugouCoverUrl(album.imgurl, 400)),
        trackCount: album.songcount || 0,
        source: 'kugou',
        creator: album.singername || '',
      }))
    }

    if (source === 'netease') {
      const data = await neteaseRaw(10, keyword, limit, page)

      const albums = data?.result?.albums
      if (!Array.isArray(albums)) return []

      return albums.map((album: any) => ({
        id: String(album.id),
        name: album.name || 'Unknown Album',
        ...getCoverArtwork('netease', album.picUrl || album.blurPicUrl || ''),
        trackCount: album.size || 0,
        source: 'netease',
        creator: album.artist?.name || '',
      }))
    }

    return []
  } catch (err) {
    return failedSearch(`Search album failed for ${source}:`, err)
  }
}

/**
 * Search for playlists. Returns a list of Playlist objects.
 */
export async function searchPlaylists(
  source: MusicSource,
  keyword: string,
  limit = 20,
  page = 1,
  cookie?: string | null,
): Promise<import('@music-together/shared').Playlist[]> {
  if (!keyword.trim()) return []

  try {
    if (!MUSIC_SOURCE_CAPABILITIES[source].playlist) return []

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

      if (!response) throw new SearchError()

      const result = response['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
      if (result?.code !== 0) throw new SearchError()
      if (!result?.data?.body?.songlist?.list) return []

      return result.data.body.songlist.list.map((playlist: any) => ({
        id: String(playlist.dissid),
        name: playlist.dissname || 'Unknown Playlist',
        ...getCoverArtwork('tencent', playlist.imgurl || ''),
        trackCount: playlist.song_count || 0,
        source: 'tencent',
        creator: playlist.creator?.name || '',
        description: playlist.introduction || '',
      }))
    }

    if (source === 'kugou') {
      const url = `http://mobilecdn.kugou.com/api/v3/search/special?api_ver=1&area_code=1&correct=1&pagesize=${limit}&plat=2&tag=1&sver=5&showtype=10&page=${page}&keyword=${encodeURIComponent(keyword)}&version=8990`
      const response = await withTimeout(fetch(url).then((res) => res.json()))

      if (!response || response.errcode !== 0) throw new SearchError()
      if (!response.data?.info) return []

      return response.data.info.map((playlist: any) => ({
        id: String(playlist.specialid),
        name: playlist.specialname || 'Unknown Playlist',
        ...getCoverArtwork('kugou', normalizeKugouCoverUrl(playlist.imgurl, 400)),
        trackCount: playlist.songcount || 0,
        source: 'kugou',
        creator: playlist.nickname || '',
        description: playlist.intro || '',
      }))
    }

    if (source === 'netease') {
      const data = await neteaseRaw(1000, keyword, limit, page)

      const playlists = data?.result?.playlists
      if (!Array.isArray(playlists)) return []

      return playlists.map((playlist: any) => ({
        id: String(playlist.id),
        name: playlist.name || 'Unknown Playlist',
        ...getCoverArtwork('netease', playlist.coverImgUrl || playlist.picUrl || ''),
        trackCount: playlist.trackCount || 0,
        source: 'netease',
        creator: playlist.creator?.nickname || '',
        description: playlist.description || '',
      }))
    }

    return []
  } catch (err) {
    return failedSearch(`Search playlist failed for ${source}:`, err)
  }
}

/** 歌手搜索结果：名称 + 头像；点击后由客户端用名称继续搜歌。 */
export async function searchArtists(
  source: MusicSource,
  keyword: string,
  limit = 20,
  page = 1,
  cookie?: string | null,
): Promise<Track[]> {
  if (!keyword.trim() || source === 'bilibili') return []
  const size = Math.max(1, Math.min(50, Math.floor(limit)))
  const currentPage = Math.max(1, Math.floor(page))

  try {
    if (source === 'netease') {
      const result = await withTimeout(
        ncmApi.cloudsearch({
          keywords: keyword,
          type: 100,
          limit: size,
          offset: (currentPage - 1) * size,
          ...(cookie ? { cookie } : {}),
          timestamp: Date.now(),
        }),
      )
      if (!result || result.body?.code !== 200) throw new SearchError()
      const artists = result.body.result?.artists
      if (!Array.isArray(artists)) return []
      return artists.flatMap((artist) => {
        const id = String(artist.id ?? '').trim()
        if (!id) return []
        return [
          {
            id: nanoid(),
            source: 'netease' as const,
            sourceId: id,
            urlId: id,
            title: artist.name || 'Unknown',
            artist: [],
            album: '',
            duration: 0,
            cover: String(artist.picUrl ?? '').replace(/^http:/, 'https:'),
          },
        ]
      })
    }

    if (source === 'tencent') {
      const payload = {
        comm: { ct: '6', cv: '80600', tmeAppID: 'qqmusic' },
        'music.search.SearchCgiService.DoSearchForQQMusicDesktop': {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: { num_per_page: size, page_num: currentPage, search_type: 1, query: keyword, grp: 1 },
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
        }).then((res) => res.json() as Promise<Record<string, any>>),
      )
      const answer = response?.['music.search.SearchCgiService.DoSearchForQQMusicDesktop']
      if (!answer || answer.code !== 0) throw new SearchError()
      const singers = answer.data?.body?.singer?.list
      if (!Array.isArray(singers)) return []
      return singers.flatMap((singer: Record<string, any>) => {
        const mid = String(singer.singerMID ?? '').trim()
        if (!mid) return []
        return [
          {
            id: nanoid(),
            source: 'tencent' as const,
            sourceId: mid,
            urlId: mid,
            title: String(singer.singerName ?? 'Unknown'),
            artist: [],
            album: '',
            duration: 0,
            cover: String(singer.singerPic ?? '').replace(/^http:/, 'https:'),
          },
        ]
      })
    }

    const params = new URLSearchParams({
      keyword,
      page: String(currentPage),
      pagesize: String(size),
    })
    const response = await withTimeout(
      fetch(`https://mobilecdn.kugou.com/api/v3/search/singer?${params}`).then(
        (res) => res.json() as Promise<Record<string, any>>,
      ),
    )
    if (!response) throw new SearchError()
    const singers = Array.isArray(response.data) ? response.data.slice(0, size) : []
    return singers.flatMap((singer: Record<string, any>) => {
      const id = String(singer.singerid ?? '').trim()
      if (!id) return []
      return [
        {
          id: nanoid(),
          source: source as 'kugou' | 'kugou_concept',
          sourceId: id,
          urlId: id,
          title: String(singer.singername ?? 'Unknown'),
          artist: [],
          album: '',
          duration: 0,
          cover: '',
        },
      ]
    })
  } catch (error) {
    return failedSearch(`Artist search failed for ${source}`, error)
  }
}

