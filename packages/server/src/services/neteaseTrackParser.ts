import type { Track } from '@music-together/shared'
import { nanoid } from 'nanoid'

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? value as Record<string, any> : null
}

const LATIN_LETTER = /\p{Script=Latin}/u
const NON_LATIN_LETTER = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

/**
 * 网易云给歌手的另一种写法（`tns` 音译 / `alias` 旧名）：原名是中文时取拉丁写法，
 * 原名是拉丁字母时取中文写法。没有任何一位歌手换了写法时返回空串。
 */
function alternateArtistName(rawArtists: unknown[]): string {
  let renamed = false
  const names = rawArtists
    .map((artist) => {
      const record = asRecord(artist)
      const name = String(record?.name ?? '').trim()
      if (!name) return ''
      const wantsLatin = NON_LATIN_LETTER.test(name)
      const other = [record?.tns, record?.alias]
        .flatMap((list) => (Array.isArray(list) ? list : []))
        .map((value) => String(value ?? '').trim())
        .find((value) => value && value !== name && (wantsLatin
          ? LATIN_LETTER.test(value) && !NON_LATIN_LETTER.test(value)
          : NON_LATIN_LETTER.test(value)))
      if (!other) return name
      renamed = true
      return other
    })
    .filter(Boolean)
  return renamed ? names.join(', ') : ''
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
  const credited = rawArtists
    .map((artist: unknown) => ({
      name: String(asRecord(artist)?.name ?? '').trim(),
      id: String(asRecord(artist)?.id ?? '').trim(),
    }))
    .filter((artist: { name: string }) => artist.name)
  const artists: string[] = credited.map((artist: { name: string }) => artist.name)
  const artistIds = credited.every((artist: { id: string }) => /^[1-9]\d{0,19}$/.test(artist.id))
    ? credited.map((artist: { id: string }) => artist.id)
    : undefined
  const sourceId = String(data.id ?? root.resourceId ?? '').trim()
  const rawDuration = Number(data.dt ?? data.duration ?? data.hMusic?.playTime ?? 0)
  const duration = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.round(rawDuration > 1000 ? rawDuration / 1000 : rawDuration)
    : 0
  const cover = String(album.picUrl ?? album.blurPicUrl ?? data.picUrl ?? '').trim()
  const title = String(data.name ?? root.name ?? 'Unknown')
  const aliasTitle = (Array.isArray(data.alia) ? data.alia : [])
    .map((value: unknown) => String(value ?? '').trim())
    .find((value: string) => value && value !== title) ?? ''
  const aliasArtist = alternateArtistName(rawArtists)

  return {
    id: nanoid(),
    title,
    artist: artists.length > 0 ? artists : ['Unknown'],
    ...(artistIds && artistIds.length > 0 ? { artistIds } : {}),
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
    ...(aliasTitle || aliasArtist
      ? { lyricAliases: { ...(aliasTitle ? { title: aliasTitle } : {}), ...(aliasArtist ? { artist: aliasArtist } : {}) } }
      : {}),
  }
}
