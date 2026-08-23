import type { Track } from '@music-together/shared'
import { nanoid } from 'nanoid'

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? value as Record<string, any> : null
}

/** Parse both the modern song-detail shape and the legacy private-FM shape. */
export function parseNeteaseTrack(song: Record<string, unknown>): Track {
  const root = song as Record<string, any>
  const nested = asRecord(root.song)
    ?? asRecord(root.track)
    ?? asRecord(root.resource?.song)
    ?? asRecord(root.resource?.resourceExtInfo?.songData)
  const data = nested ?? root
  const album = asRecord(data.al) ?? asRecord(data.album) ?? {}
  const rawArtists = Array.isArray(data.ar)
    ? data.ar
    : Array.isArray(data.artists)
      ? data.artists
      : data.artist
        ? [data.artist]
        : []
  const artists = rawArtists
    .map((artist: unknown) => String(asRecord(artist)?.name ?? '').trim())
    .filter(Boolean)
  const sourceId = String(data.id ?? root.resourceId ?? '').trim()
  const rawDuration = Number(data.dt ?? data.duration ?? data.hMusic?.playTime ?? 0)
  const duration = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.round(rawDuration > 1000 ? rawDuration / 1000 : rawDuration)
    : 0
  const cover = String(album.picUrl ?? album.blurPicUrl ?? data.picUrl ?? '').trim()

  return {
    id: nanoid(),
    title: String(data.name ?? root.name ?? 'Unknown'),
    artist: artists.length > 0 ? artists : ['Unknown'],
    album: String(album.name ?? ''),
    duration,
    cover,
    source: 'netease',
    sourceId,
    urlId: sourceId,
    lyricId: sourceId,
    picId: String(album.pic_str ?? album.pic ?? album.picId ?? ''),
    // fee: 0=free, 1=VIP, 4=paid album, 8=low-quality free.
    vip: data.fee === 1 || data.fee === 4 || data.privilege?.fee === 1 || data.privilege?.fee === 4,
  }
}
