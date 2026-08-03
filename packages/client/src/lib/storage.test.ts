// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { SETTING_DEFAULTS, storage } from './storage'

describe('AMLL settings storage', () => {
  beforeEach(() => localStorage.clear())

  it('uses the advanced AMLL defaults', () => {
    expect(storage.getLyricAlignPosition()).toBe(0.5)
    expect(storage.getLyricHidePassedLines()).toBe(false)
    expect(storage.getLyricShowBottomLine()).toBe(true)
    expect(storage.getLyricMaskObsceneWordsMode()).toBe('')
    expect(storage.getBgRenderer()).toBe('pixi')
    expect(storage.getBgStaticMode()).toBe(false)
    expect(storage.getBgReactToLowFreq()).toBe(false)
  })

  it('validates enum and numeric settings loaded from localStorage', () => {
    localStorage.setItem('mt-bgRenderer', 'invalid')
    localStorage.setItem('mt-lyricMaskObsceneWordsMode', 'invalid')
    localStorage.setItem('mt-lyricWordFadeWidth', '100')

    expect(storage.getBgRenderer()).toBe(SETTING_DEFAULTS.bgRenderer)
    expect(storage.getLyricMaskObsceneWordsMode()).toBe(SETTING_DEFAULTS.lyricMaskObsceneWordsMode)
    expect(storage.getLyricWordFadeWidth()).toBe(2)
  })

  it('persists switches, renderer and mask character', () => {
    storage.setLyricHidePassedLines(true)
    storage.setLyricMaskObsceneWordsMode('partial-mask')
    storage.setLyricMaskObsceneWordChar('#more')
    storage.setBgRenderer('mesh')
    storage.setBgStaticMode(true)
    storage.setBgReactToLowFreq(true)

    expect(storage.getLyricHidePassedLines()).toBe(true)
    expect(storage.getLyricMaskObsceneWordsMode()).toBe('partial-mask')
    expect(storage.getLyricMaskObsceneWordChar()).toBe('#')
    expect(storage.getBgRenderer()).toBe('mesh')
    expect(storage.getBgStaticMode()).toBe(true)
    expect(storage.getBgReactToLowFreq()).toBe(true)
  })
})
