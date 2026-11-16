import { ARTIST_SOURCES, UNKNOWN_ARTIST } from '@music-together/shared'
import type { MusicSource, Track } from '@music-together/shared'
import type { ArtistTarget } from '@/stores/artistPageStore'

export function hasArtistPages(source: MusicSource): boolean {
  return ARTIST_SOURCES.includes(source)
}

export function isRealArtistName(name: string): boolean {
  return name.trim() !== '' && name !== UNKNOWN_ARTIST
}

/** 曲目署名的歌手；只有 ID 与名字一一对齐时才带 ID，否则按名字查找。 */
export function trackArtists(track: Pick<Track, 'source' | 'artist' | 'artistIds'>): ArtistTarget[] {
  const ids = track.artistIds && track.artistIds.length === track.artist.length ? track.artistIds : undefined
  return track.artist.map((name, index) => ({
    source: track.source,
    name,
    ...(ids?.[index] ? { id: ids[index] } : {}),
  }))
}
