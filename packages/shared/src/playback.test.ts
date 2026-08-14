import { describe, expect, it } from 'vitest'
import { clampPlaybackPosition, getPlaybackRevision, isStalePlaybackAction, nextPlaybackRevision } from './playback'

describe('playback revisions', () => {
  it('normalizes legacy and invalid revisions', () => {
    expect(getPlaybackRevision({})).toBe(0)
    expect(getPlaybackRevision({ revision: -1 })).toBe(0)
    expect(nextPlaybackRevision({ revision: 4 })).toBe(5)
  })

  it('rejects only an explicitly older action', () => {
    expect(isStalePlaybackAction({ revision: 3 }, { revision: 4 })).toBe(true)
    expect(isStalePlaybackAction({ revision: 4 }, { revision: 4 })).toBe(false)
    expect(isStalePlaybackAction({}, { revision: 4 })).toBe(false)
  })

  it('clamps a scheduled position to the playable media range', () => {
    expect(clampPlaybackPosition(121.5, 120)).toBe(120)
    expect(clampPlaybackPosition(-1, 120)).toBe(0)
    expect(clampPlaybackPosition(121.5, 0)).toBe(121.5)
  })
})
