import type { PlayMode, Track } from '@music-together/shared'

export function getSuccessorAfterRemovalFromQueue(
  queue: readonly Track[],
  trackId: string,
  playMode: PlayMode,
  random = Math.random,
): Track | null {
  const removedIndex = queue.findIndex((track) => track.id === trackId)
  if (removedIndex < 0) return null
  const remaining = queue.filter((track) => track.id !== trackId)
  if (remaining.length === 0) return null

  if (playMode === 'shuffle') {
    return remaining[Math.floor(random() * remaining.length)] ?? remaining[0]
  }
  if (removedIndex < remaining.length) return remaining[removedIndex]
  return playMode === 'sequential' ? null : remaining[0]
}
