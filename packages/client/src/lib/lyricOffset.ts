import type { Track } from '@music-together/shared'

/**
 * Bilibili videos can contain a custom intro/outro, so their lyric adjustment
 * must be scoped to the video instead of changing the matched song globally.
 */
export function getLyricOffsetKey(track: Track | null): string | null {
  if (!track?.lyricId) return null

  const lyricSource = track.metadataSource ?? track.source
  if (track.source === 'bilibili') {
    return `bilibili:${track.urlId}:${lyricSource}:${track.lyricId}`
  }
  return `${lyricSource}:${track.lyricId}`
}
