import { describe, expect, it } from 'vitest'
import { playbackSyncAdjustment } from './playback-sync'

describe('playback sync correction', () => {
  it('keeps tempo changes inside the one-percent correction window', () => {
    expect(playbackSyncAdjustment(0.2, true, false)).toEqual({ playbackRate: 0.99, shouldSeek: false })
    expect(playbackSyncAdjustment(-0.2, true, false)).toEqual({ playbackRate: 1.01, shouldSeek: false })
  })

  it('uses hard seek for large drift only when a correction mode is enabled', () => {
    expect(playbackSyncAdjustment(1, true, false)).toEqual({ playbackRate: 1, shouldSeek: true })
    expect(playbackSyncAdjustment(1, false, true)).toEqual({ playbackRate: 1, shouldSeek: true })
    expect(playbackSyncAdjustment(1, false, false)).toEqual({ playbackRate: 1, shouldSeek: false })
  })

  it('returns native speed inside the dead zone', () => {
    expect(playbackSyncAdjustment(0.02, true, true)).toEqual({ playbackRate: 1, shouldSeek: false })
  })
})
