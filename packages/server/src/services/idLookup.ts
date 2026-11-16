import Meting from '@meting/core'
import { UNKNOWN_ARTIST, type MusicRefKind, type MusicSource, type Playlist, type Track } from '@music-together/shared'
import { nanoid } from 'nanoid'
import { logger } from '../utils/logger.js'
import { withTimeoutOrNull } from '../utils/withTimeout.js'
import { artistService, ArtistError } from './artistService.js'
import { SearchError } from './catalogUtils.js'
import { getCoverArtwork, normalizeKugouCoverUrl } from './coverArtwork.js'
import { musicProvider } from './musicProvider.js'
import { rawToTrack } from './trackMapping.js'

/**
 * 按 ID 查一首歌、一张专辑、一个歌单或一位歌手。ID 已由 `normalizeMusicId` 校验；返回的形状与搜索结果一致，
 * 对话框按搜索结果展示。没找到是空列表；平台没有回答是 `SearchError`。
 * 酷狗的专辑和歌单答复只有歌曲，所以名称和封面取自其中的歌曲。
 */

const LOOKUP_TIMEOUT_MS = 15_000

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>
type MetingCall = 'song' | 'album' | 'playlist'

async function raw(source: MusicSource, call: MetingCall, id: string): Promise<Raw | null> {
  const meting = new Meting(source as 'netease' | 'tencent' | 'kugou')
  meting.format(false)
  const answer = await withTimeoutOrNull(meting[call](id) as Promise<string>, LOOKUP_TIMEOUT_MS)
  if (answer === null) throw new SearchError()
  try {
    const parsed = JSON.parse(answer)
    return parsed && typeof parsed === 'object' ? (parsed as Raw) : null
  } catch {
    return null
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const count = (value: unknown): number => Number(value) || 0

function playlistEntry(
  source: MusicSource,
  fields: { id: string; name: string; cover: string; trackCount: unknown; creator?: unknown; description?: unknown },
): Playlist {
  return {
    id: fields.id,
    name: fields.name,
    ...getCoverArtwork(source, fields.cover),
    trackCount: count(fields.trackCount),
    source,
    creator: text(fields.creator),
    ...(fields.description ? { description: text(fields.description) } : {}),
  }
}

async function neteaseSong(id: string): Promise<Track[]> {
  const songs = (await raw('netease', 'song', id))?.songs
  if (!Array.isArray(songs)) return []
  return musicProvider.ingest(songs.map((song: Raw) => rawToTrack(song, 'netease')))
}

async function tencentSong(id: string): Promise<Track[]> {
  const song = (await raw('tencent', 'song', id))?.data?.[0]
  if (!song || typeof song !== 'object' || !song.mid) return []
  return musicProvider.ingest([rawToTrack(song, 'tencent')])
}

async function kugouSong(hash: string): Promise<Track[]> {
  const song = await raw('kugou', 'song', hash)
  if (!song || song.errcode !== 0 || !song.hash) return []
  const artists = text(song.author_name)
    .split(/[、,，&]/)
    .map((name) => name.trim())
    .filter(Boolean)
  const cover = text(song.album_img || song.imgUrl)
  const track: Track = {
    id: nanoid(),
    source: 'kugou',
    sourceId: String(song.hash),
    title: text(song.songName) || text(song.fileName) || 'Unknown',
    artist: artists.length ? artists : [UNKNOWN_ARTIST],
    album: '',
    duration: count(song.timeLength),
    cover: cover ? normalizeKugouCoverUrl(cover, 400) : '',
    urlId: String(song.hash),
    lyricId: String(song.hash),
    picId: String(song.hash),
    vip: count(song.privilege) > 0 || count(song.pay_type) > 0,
  }
  return musicProvider.ingest([track])
}

async function neteaseAlbum(id: string): Promise<Playlist[]> {
  const album = (await raw('netease', 'album', id))?.album
  if (!album?.name) return []
  return [
    playlistEntry('netease', {
      id,
      name: album.name,
      cover: text(album.picUrl || album.blurPicUrl),
      trackCount: album.size,
      creator: album.artist?.name,
    }),
  ]
}

async function tencentAlbum(id: string): Promise<Playlist[]> {
  const data = (await raw('tencent', 'album', id))?.data
  const info = data?.getAlbumInfo
  if (!info?.Falbum_name) return []
  const mid = text(info.Falbum_mid) || id
  return [
    playlistEntry('tencent', {
      id: mid,
      name: info.Falbum_name,
      cover: `https://y.gtimg.cn/music/photo_new/T002R800x800M000${mid}.jpg`,
      trackCount: Array.isArray(data.getSongInfo) ? data.getSongInfo.length : 0,
      creator: info.Fsinger_name ?? info.Fsingername ?? data.getSongInfo?.[0]?.singer?.[0]?.name,
    }),
  ]
}

async function tencentPlaylist(id: string): Promise<Playlist[]> {
  const list = (await raw('tencent', 'playlist', id))?.data?.cdlist?.[0]
  if (!list?.dissname) return []
  return [
    playlistEntry('tencent', {
      id: text(list.disstid) || id,
      name: list.dissname,
      cover: text(list.dir_pic_url2 || list.logo),
      trackCount: list.songnum ?? list.cur_song_num,
      creator: list.nickname ?? list.nick,
      description: list.desc,
    }),
  ]
}

async function neteasePlaylist(id: string): Promise<Playlist[]> {
  const playlist = (await raw('netease', 'playlist', id))?.playlist
  if (!playlist?.name) return []
  return [
    playlistEntry('netease', {
      id,
      name: playlist.name,
      cover: text(playlist.coverImgUrl),
      trackCount: playlist.trackCount,
      creator: playlist.creator?.nickname,
      description: playlist.description,
    }),
  ]
}

/** 酷狗的列表答复只有歌曲：专辑用歌曲共有的专辑名，否则用 ID 命名。 */
async function kugouList(call: 'album' | 'playlist', id: string): Promise<Playlist[]> {
  const data = (await raw('kugou', call, id))?.data
  const songs: Raw[] = Array.isArray(data?.info) ? data.info : []
  if (songs.length === 0) return []
  const first = songs[0]
  const cover = text(first.trans_param?.union_cover || first.album_sizable_cover)
  return [
    playlistEntry('kugou', {
      id,
      name:
        (call === 'album' ? text(first.album_name || first.remark) : '') ||
        (call === 'album' ? `专辑 ${id}` : `歌单 ${id}`),
      cover: cover ? normalizeKugouCoverUrl(cover, 400) : '',
      trackCount: data.total ?? songs.length,
      creator:
        call === 'album' && text(first.filename).includes(' - ')
          ? text(first.filename).split(' - ')[0].trim()
          : undefined,
    }),
  ]
}

/** 歌手结果沿用搜索的曲目外形：名称与头像，点击后由客户端继续处理。 */
async function neteaseArtist(id: string): Promise<Track[]> {
  try {
    const { artist } = await artistService.getArtist('netease', id)
    return [
      {
        id: nanoid(),
        source: 'netease',
        sourceId: artist.id,
        urlId: artist.id,
        title: artist.name || 'Unknown',
        artist: [],
        album: '',
        duration: 0,
        cover: artist.cover.replace(/^http:/, 'https:'),
      },
    ]
  } catch (error) {
    if (error instanceof ArtistError && error.code === 'ARTIST_NOT_FOUND') return []
    throw error
  }
}

type Lookup = (id: string) => Promise<Track[] | Playlist[]>

const LOOKUPS: Partial<Record<MusicSource, Partial<Record<MusicRefKind, Lookup>>>> = {
  netease: { song: neteaseSong, album: neteaseAlbum, playlist: neteasePlaylist, artist: neteaseArtist },
  tencent: { song: tencentSong, album: tencentAlbum, playlist: tencentPlaylist },
  kugou: { song: kugouSong, album: (id) => kugouList('album', id), playlist: (id) => kugouList('playlist', id) },
}

/** 这个（已校验的）ID 对应的东西，最多一个：不存在或无法按 ID 查找时为空列表。 */
export async function lookupById(source: MusicSource, kind: MusicRefKind, id: string): Promise<Track[] | Playlist[]> {
  const lookup = LOOKUPS[source]?.[kind]
  if (!lookup) return []
  try {
    return await lookup(id)
  } catch (error) {
    if (error instanceof SearchError || (error as { kind?: string })?.kind) throw error
    logger.error(`Lookup by id failed for ${source} ${kind}:`, error)
    throw new SearchError()
  }
}
