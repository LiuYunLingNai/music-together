import { describe, expect, it } from 'vitest'
import { resolveConductorSampleTimestamp } from './conductorSample.js'

describe('resolveConductorSampleTimestamp', () => {
  it('keeps the NTP timestamp sampled with the conductor media position', () => {
    expect(resolveConductorSampleTimestamp(9_750, 10_000)).toBe(9_750)
  })

  it('falls back to receive time for absent or implausible timestamps', () => {
    expect(resolveConductorSampleTimestamp(undefined, 10_000)).toBe(10_000)
    expect(resolveConductorSampleTimestamp(25_000, 10_000)).toBe(10_000)
  })

  it('keeps a calibrated sample within the skew window', () => {
    expect(resolveConductorSampleTimestamp(9_750, 10_000)).toBe(9_750)
  })

  it('clamps a future sample to the server receive time', () => {
    expect(resolveConductorSampleTimestamp(10_250, 10_000)).toBe(10_000)
  })

  it('falls back to receive time for a sample beyond the skew window', () => {
    expect(resolveConductorSampleTimestamp(13_500, 10_000)).toBe(10_000)
  })
})
