import { beforeEach, describe, expect, it } from 'vitest'
import { storage } from './storage'

describe('preference storage defaults', () => {
  beforeEach(() => localStorage.clear())

  it('uses readable UI and audible volume defaults when values are unset', () => {
    expect(storage.getUiScale()).toBe(1.15)
    expect(storage.getVolume()).toBe(0.78)
    expect(storage.getPlaybackTempoSyncEnabled()).toBe(false)
    expect(storage.getPlaybackHardSeekSyncEnabled()).toBe(false)
  })

  it('clamps a persisted UI scale to the supported range', () => {
    localStorage.setItem('music-together-desktop:ui-scale', '2')
    expect(storage.getUiScale()).toBe(1.4)
  })
})
