import type { MusicSource, Track } from '@music-together/shared'
import { nanoid } from 'nanoid'
import { normalizeKugouCoverUrl } from './coverArtwork.js'
import { parseKugouSongFields } from './kugouTrackFields.js'
import { parseNeteaseTrack } from './neteaseTrackParser.js'

type MetingJson = Record<string, unknown>

/** Navigate a dot-separated path in an object */
export function navigatePath(data: MetingJson, path: string): unknown {
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
export function rawToTrack(song: Record<string, unknown>, source: MusicSource): Track {
  // Cast to any for convenient dynamic property access on external API responses
  const s = song as Record<string, any>
  switch (source) {
    case 'netease': {
      return parseNeteaseTrack(song)
    }

    case 'tencent': {
      // Tencent sometimes wraps data in musicData
      const t = s.musicData || s
      const mid = String(t.mid || t.songmid || t.songMid || '').trim()
      const albumMid = String(t.album?.pmid || t.album?.mid || '').trim()
      const artists = (t.singer || [])
        .map((artist: Record<string, unknown>) => String(artist.name ?? '').trim())
        .filter(Boolean)
      // QQ 的 `title` 带括号译名或版本、`name` 是原名；显示沿用 `name`，
      // 另一个写法留给歌词搜索在标题搜不到时再搜一次。
      const otherTitle = t.name && t.title && t.name !== t.title ? String(t.title).trim() : ''
      return {
        id: nanoid(),
        title: t.name || t.title || 'Unknown',
        artist: artists.length > 0 ? artists : ['Unknown'],
        album: String(t.album?.title || t.album?.name || '').trim(),
        duration: t.interval || 0, // already in seconds
        cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : '',
        source,
        sourceId: mid,
        urlId: mid,
        lyricId: mid,
        picId: albumMid,
        // pay.pay_play=1 表示需要 VIP, pay.pay_month=1 表示月度VIP, pay.price_track>0 表示付费单曲
        vip: t.pay?.pay_play === 1 || t.pay?.pay_month === 1 || (t.pay?.price_track ?? 0) > 0,
        ...(otherTitle ? { lyricAliases: { title: otherTitle } } : {}),
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
      const originalTitle = String(s.OriSongName ?? '').trim()
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
        ...(originalTitle && originalTitle !== (trackName || 'Unknown')
          ? { lyricAliases: { title: originalTitle } }
          : {}),
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


/** Convert a kugou song object from getPlaylistTracks to a Track. */
export function kugouSongToTrack(song: Record<string, unknown>, source: 'kugou' | 'kugou_concept' = 'kugou'): Track | null {
  // 与搜索共用同一套字段解析：漫游/歌单同样可能拿到概念版的 PascalCase 行。
  const fields = parseKugouSongFields(song)
  if (!fields.hash) return null

  return {
    id: nanoid(),
    source,
    sourceId: fields.hash,
    title: fields.title,
    artist: fields.artists,
    album: fields.album,
    duration: fields.duration,
    cover: normalizeKugouCoverUrl(fields.cover),
    lyricId: fields.hash,
    urlId: fields.hash,
    picId: fields.hash,
    vip: fields.vip,
  }
}

