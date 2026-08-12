import { describe, expect, it } from 'vitest'
import { getHardSeekThresholdMs, getScheduledPlaybackPosition, getSyncExpectedPosition } from './playbackSync'

describe('playback sync helpers', () => {
  it('compensates playback position when a scheduled start is late', () => {
    expect(getScheduledPlaybackPosition(12, 10_000, 10_250)).toBe(12.25)
  })

  it('does not move playback backwards before the scheduled time', () => {
    expect(getScheduledPlaybackPosition(12, 10_000, 9_800)).toBe(12)
  })

  it('uses one-way latency rather than full RTT for the hard-seek threshold', () => {
    expect(getHardSeekThresholdMs(500, 1_000, 100)).toBe(600)
    expect(getHardSeekThresholdMs(500, 40, 100)).toBe(500)
  })

  it('compensates a playing sync response for receive delay', () => {
    expect(getSyncExpectedPosition(20, true, 10_000, 10_250, 5)).toBe(20.25)
  })

  it('does not advance paused sync responses or accept negative delay', () => {
    expect(getSyncExpectedPosition(20, false, 10_000, 10_250, 5)).toBe(20)
    expect(getSyncExpectedPosition(20, true, 10_000, 9_750, 5)).toBe(20)
  })
})
