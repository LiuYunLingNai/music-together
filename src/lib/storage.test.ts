import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_VISUAL_SETTINGS, normalizePlayerVisualSettings, storage } from './storage'

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

  it('normalizes untrusted player visual preferences', () => {
    const settings = normalizePlayerVisualSettings({ layout: 'invalid' as 'split', backgroundDim: 999, coverScale: -2, customFontFamily: ' A '.repeat(100) })
    expect(settings.layout).toBe('split')
    expect(settings.backgroundDim).toBe(90)
    expect(settings.coverScale).toBe(0.7)
    expect(settings.customFontFamily.length).toBeLessThanOrEqual(120)
    expect(normalizePlayerVisualSettings(null)).toEqual(DEFAULT_PLAYER_VISUAL_SETTINGS)
    expect(normalizePlayerVisualSettings('invalid')).toEqual(DEFAULT_PLAYER_VISUAL_SETTINGS)
  })
})
