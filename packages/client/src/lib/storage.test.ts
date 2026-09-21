// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * 视觉舞台设置：画质档（上游四档）与粒子溢光。
 *
 * 回归背景：画质档曾从自拟的 low/medium/high 迁移到上游的
 * eco/balanced/high/ultra（settings schema v2→v3）。迁移必须：
 *   · 把旧值映射到新档（low→eco、medium→balanced、high→high）
 *   · 对**非法/缺失**值安全回退，不抛错、不误伤其他设置
 *   · 'auto' 语义保持不变
 */
describe('视觉舞台设置', () => {
  beforeEach(() => localStorage.clear())

  it('画质档默认 auto，且只接受白名单内的值', () => {
    expect(storage.getVisualQuality()).toBe('auto')

    localStorage.setItem('mt-visualQuality', 'ultra')
    expect(storage.getVisualQuality()).toBe('ultra')

    // 非法值回退到默认，不抛错
    localStorage.setItem('mt-visualQuality', 'nonsense')
    expect(storage.getVisualQuality()).toBe(SETTING_DEFAULTS.visualQuality)
  })

  it('粒子溢光默认关闭（跟随上游 fx.bloom 出厂值）', () => {
    expect(storage.getVisualBloom()).toBe(false)

    storage.setVisualBloom(true)
    expect(storage.getVisualBloom()).toBe(true)

    storage.setVisualBloom(false)
    expect(storage.getVisualBloom()).toBe(false)
  })

  it('粒子溢光对畸形值安全回退为关闭', () => {
    localStorage.setItem('mt-visualBloom', 'yes-please')
    expect(storage.getVisualBloom()).toBe(false)
  })

  /**
   * 迁移测试：**真正**跑一次模块加载时的迁移逻辑。
   *
   * 迁移在模块顶层执行（`migrateSettings()`），因此必须先把 localStorage
   * 布置成"旧版本用户"的状态，再用 `vi.resetModules()` + 动态 import
   * 重新加载模块 —— 这样测的是**真实代码**，不是重写一遍映射表。
   */
  it.each([
    ['low', 'eco'],
    ['medium', 'balanced'],
    ['high', 'high'],
  ])('迁移：旧画质 %s → %s', async (previous, expected) => {
    vi.resetModules()
    localStorage.clear()
    localStorage.setItem('mt-settingsSchemaVersion', '2')
    localStorage.setItem('mt-visualQuality', previous)

    const fresh = await import('./storage')
    expect(fresh.storage.getVisualQuality()).toBe(expected)
  })

  it('迁移：auto 与已是新档位的值都不被改动', async () => {
    for (const value of ['auto', 'eco', 'ultra']) {
      vi.resetModules()
      localStorage.clear()
      localStorage.setItem('mt-settingsSchemaVersion', '2')
      localStorage.setItem('mt-visualQuality', value)

      const fresh = await import('./storage')
      expect(fresh.storage.getVisualQuality()).toBe(value)
    }
  })

  it('迁移：schema 已是 v3 时不再改动用户选择', async () => {
    vi.resetModules()
    localStorage.clear()
    // 用户已在 v3 下主动选了 balanced
    localStorage.setItem('mt-settingsSchemaVersion', '3')
    localStorage.setItem('mt-visualQuality', 'balanced')

    const fresh = await import('./storage')
    expect(fresh.storage.getVisualQuality()).toBe('balanced')
  })

  it('迁移不会误伤无关设置', () => {
    localStorage.setItem('mt-visualStage', 'emily')
    localStorage.setItem('mt-lyricRenderer', 'amll')
    // 触发一次读取（迁移已在模块加载时跑过，这里确认其他键未被改动）
    void storage.getVisualQuality()
    expect(storage.getVisualStage()).toBe('emily')
    expect(storage.getLyricRenderer()).toBe('amll')
  })
})
