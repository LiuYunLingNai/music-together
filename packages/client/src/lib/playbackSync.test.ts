import { describe, expect, it } from 'vitest'
import {
  getHardSeekThresholdMs,
  getScheduledPlaybackPosition,
  getSyncExpectedPosition,
  getSyncRequestIntervalMs,
  isDriftSettled,
} from './playbackSync'

describe('playback sync helpers', () => {
  it('compensates a late scheduled action without moving backwards', () => {
    expect(getScheduledPlaybackPosition(12, 10_000, 10_250)).toBe(12.25)
    expect(getScheduledPlaybackPosition(12, 10_000, 9_800)).toBe(12)
  })

  it('uses bounded one-way latency uncertainty for hard seeks', () => {
    expect(getHardSeekThresholdMs(500, 1_000, 100)).toBe(600)
    expect(getHardSeekThresholdMs(500, 40, 100)).toBe(500)
  })

  it('advances playing samples by receive delay but leaves paused samples fixed', () => {
    expect(getSyncExpectedPosition(20, true, 10_000, 10_250, 5)).toBe(20.25)
    expect(getSyncExpectedPosition(20, false, 10_000, 10_250, 5)).toBe(20)
    expect(getSyncExpectedPosition(20, true, 10_000, 9_750, 5)).toBe(20)
  })

  it('slows polling only after playback has remained settled', () => {
    expect(isDriftSettled(0.004, 5)).toBe(true)
    expect(getSyncRequestIntervalMs(true, 3, 2_000, 5_000, 3)).toBe(5_000)
    expect(getSyncRequestIntervalMs(true, 2, 2_000, 5_000, 3)).toBe(2_000)
    expect(getSyncRequestIntervalMs(false, 5, 2_000, 5_000, 3)).toBe(2_000)
  })
})
