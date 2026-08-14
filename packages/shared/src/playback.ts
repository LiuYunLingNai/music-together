import type { PlayState } from './types.js'

export function getPlaybackRevision(playState: Pick<PlayState, 'revision'>): number {
  const revision = playState.revision
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
}

export function nextPlaybackRevision(playState: Pick<PlayState, 'revision'>): number {
  return getPlaybackRevision(playState) + 1
}

/** Keep a scheduled playback position inside the playable media range. */
export function clampPlaybackPosition(position: number, duration: number): number {
  const nonNegativePosition = Math.max(0, position)
  return duration > 0 ? Math.min(duration, nonNegativePosition) : nonNegativePosition
}

/** Missing revisions come from an older compatible peer and are never rejected. */
export function isStalePlaybackAction(
  incoming: Pick<PlayState, 'revision'>,
  current: Pick<PlayState, 'revision'>,
): boolean {
  return incoming.revision !== undefined && getPlaybackRevision(incoming) < getPlaybackRevision(current)
}
