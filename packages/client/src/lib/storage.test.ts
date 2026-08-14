// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { SETTING_DEFAULTS, storage } from './storage'

describe('AMLL settings storage', () => {
  beforeEach(() => localStorage.clear())

  it('uses the fork AMLL defaults', () => {
    expect(storage.getLyricAlignPosition()).toBe(0.4)
    expect(storage.getLyricHidePassedLines()).toBe(false)
    expect(storage.getLyricShowBottomLine()).toBe(true)
    expect(storage.getLyricMaskObsceneWordsMode()).toBe('')
  })

  it('validates enum and numeric settings loaded from storage', () => {
    localStorage.setItem('mt-lyricMaskObsceneWordsMode', 'invalid')
    localStorage.setItem('mt-lyricWordFadeWidth', '100')

    expect(storage.getLyricMaskObsceneWordsMode()).toBe(SETTING_DEFAULTS.lyricMaskObsceneWordsMode)
    expect(storage.getLyricWordFadeWidth()).toBe(2)
  })

  it('persists masking and interaction choices safely', () => {
    storage.setLyricHidePassedLines(true)
    storage.setLyricShowBottomLine(false)
    storage.setLyricMaskObsceneWordsMode('partial-mask')
    storage.setLyricMaskObsceneWordChar('#more')

    expect(storage.getLyricHidePassedLines()).toBe(true)
    expect(storage.getLyricShowBottomLine()).toBe(false)
    expect(storage.getLyricMaskObsceneWordsMode()).toBe('partial-mask')
    expect(storage.getLyricMaskObsceneWordChar()).toBe('#')
  })
})
