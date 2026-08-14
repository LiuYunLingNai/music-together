import { describe, expect, it } from 'vitest'
import type { Track } from '@music-together/shared'
import { getSuccessorAfterRemovalFromQueue } from './queueNavigation'

const track = (id: string): Track => ({
  id,
  title: id,
  artist: [],
  album: '',
  duration: 1,
  cover: '',
  source: 'netease',
  sourceId: id,
  urlId: id,
})

describe('getSuccessorAfterRemovalFromQueue', () => {
  const queue = [track('a'), track('b'), track('c')]

  it('keeps the next logical entry after removing the current track', () => {
    expect(getSuccessorAfterRemovalFromQueue(queue, 'b', 'sequential')?.id).toBe('c')
  })

  it('stops at the sequential tail and wraps in loop mode', () => {
    expect(getSuccessorAfterRemovalFromQueue(queue, 'c', 'sequential')).toBeNull()
    expect(getSuccessorAfterRemovalFromQueue(queue, 'c', 'loop-all')?.id).toBe('a')
  })

  it('selects from remaining tracks in shuffle mode', () => {
    expect(getSuccessorAfterRemovalFromQueue(queue, 'b', 'shuffle', () => 0.99)?.id).toBe('c')
  })
})
