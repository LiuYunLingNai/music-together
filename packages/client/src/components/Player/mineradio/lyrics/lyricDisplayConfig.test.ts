import { describe, expect, it } from 'vitest'
import {
  getContextStyle,
  getMotionProfile,
  LYRIC_DISPLAY_MODES,
  LYRIC_MOTION_STYLES,
  LYRIC_TRANSLATION_MODES,
  lyricLineCountForMode,
  lyricSlotOffsets,
  retractTranslationMode,
  translationStackFraction,
} from './lyricDisplayConfig'

describe('lyricLineCountForMode', () => {
  it('固定模式返回约定的行数', () => {
    expect(lyricLineCountForMode('single')).toBe(1)
    expect(lyricLineCountForMode('dual')).toBe(2)
    expect(lyricLineCountForMode('triple')).toBe(3)
    expect(lyricLineCountForMode('cinema')).toBe(5)
  })

  it('custom 使用给定行数并夹在 1..10', () => {
    expect(lyricLineCountForMode('custom', 7)).toBe(7)
    expect(lyricLineCountForMode('custom', 0)).toBe(1)
    expect(lyricLineCountForMode('custom', 99)).toBe(10)
    expect(lyricLineCountForMode('custom', 4.6)).toBe(5)
  })

  it('所有声明的模式都能得到正数行数', () => {
    for (const mode of LYRIC_DISPLAY_MODES) {
      expect(lyricLineCountForMode(mode, 5)).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('lyricSlotOffsets', () => {
  it('single 只有当前行', () => {
    expect(lyricSlotOffsets('single')).toEqual([0])
  })

  it('dual 为当前行与下一行（与上游一致，非对称）', () => {
    expect(lyricSlotOffsets('dual')).toEqual([0, 1])
  })

  it('triple 以当前行为中心对称', () => {
    expect(lyricSlotOffsets('triple')).toEqual([-1, 0, 1])
  })

  it('cinema 为 -2..2', () => {
    expect(lyricSlotOffsets('cinema')).toEqual([-2, -1, 0, 1, 2])
  })

  it('custom 行数为偶数时依然包含 0 且连续', () => {
    const offsets = lyricSlotOffsets('custom', 4)
    expect(offsets).toHaveLength(4)
    expect(offsets).toContain(0)
    // 连续递增
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBe(offsets[i - 1] + 1)
    }
  })

  it('每个模式都包含偏移 0（当前行必须在栈内）', () => {
    for (const mode of LYRIC_DISPLAY_MODES) {
      expect(lyricSlotOffsets(mode, 6)).toContain(0)
    }
  })
})

describe('getMotionProfile', () => {
  it('每个风格都能取到完整参数', () => {
    for (const style of LYRIC_MOTION_STYLES) {
      const p = getMotionProfile(style)
      expect(p.floatAmp).toBeGreaterThan(0)
      expect(p.glitchSlice).toBeGreaterThanOrEqual(0)
    }
  })

  it('只有故障风格启用 glitch', () => {
    expect(getMotionProfile('glitch').glitch).toBeGreaterThan(0)
    expect(getMotionProfile('float').glitch).toBe(0)
    expect(getMotionProfile('smooth').glitch).toBe(0)
  })

  it('流光风格启用 sweep 与 shimmer', () => {
    const shine = getMotionProfile('shine')
    expect(shine.sweep).toBeGreaterThan(0)
    expect(shine.shimmer).toBeGreaterThan(0)
  })

  it('未知风格回退到 float', () => {
    // 运行期可能读到旧的持久化值
    expect(getMotionProfile('nope' as never)).toEqual(getMotionProfile('float'))
  })
})

describe('getContextStyle', () => {
  it('cinema 的层次比默认更分明', () => {
    const cinema = getContextStyle('cinema')
    expect(cinema.nearScale).toBeGreaterThan(cinema.farScale)
    expect(cinema.nearAlpha).toBeGreaterThan(cinema.farAlpha)
  })

  it('透明度被夹在合理范围', () => {
    const tooLow = getContextStyle('cinema', -5)
    const tooHigh = getContextStyle('cinema', 99)
    expect(tooLow.nearAlpha).toBeGreaterThan(0)
    expect(tooHigh.nearAlpha).toBeLessThanOrEqual(1)
  })

  it('所有显示模式都返回有效的缩放', () => {
    for (const mode of LYRIC_DISPLAY_MODES) {
      const style = getContextStyle(mode)
      expect(style.nearScale).toBeGreaterThan(0)
      expect(style.farScale).toBeGreaterThan(0)
    }
  })
})

describe('常量集合完整性', () => {
  it('声明了 6 种运动风格、5 种显示模式、4 种译词模式', () => {
    expect(LYRIC_MOTION_STYLES).toHaveLength(6)
    expect(LYRIC_DISPLAY_MODES).toHaveLength(5)
    expect(LYRIC_TRANSLATION_MODES).toHaveLength(4)
  })
})

/**
 * 译词「自适应缩回」（第二十五轮新增设计 —— AMLL 0.5.2 **没有**此功能，
 * 详见 `lyricDisplayConfig.ts` 的推导说明）。
 *
 * 钉住的是**行为性质**，不是魔法数值：
 *   1. 永不升档（用户选了 off 就保持 off）
 *   2. 行数越多档位越窄（单调性）
 *   3. 收缩后堆叠比例确实落到阈值以内（或已到底档）
 */
describe('译词自适应缩回', () => {
  it('用户选 off 时保持 off（不升档）', () => {
    for (const n of [1, 3, 5, 10]) {
      expect(retractTranslationMode('off', n)).toBe('off')
    }
  })

  it('行数少时保持用户所选档位（含出厂默认 cinema = 5 行）', () => {
    for (const n of [1, 2, 3, 5]) {
      expect(retractTranslationMode('multi', n)).toBe('multi')
    }
  })

  it('行数过多时向下收缩到更窄的档位', () => {
    const at10 = retractTranslationMode('multi', 10)
    expect(at10).not.toBe('multi')
    // 收缩方向必须沿梯级向下（multi → dual → current → off）
    expect(['dual', 'current', 'off']).toContain(at10)
  })

  it('永不升档：窄档位不会因为行数少而被放宽', () => {
    for (const n of [1, 5, 10]) {
      expect(retractTranslationMode('current', n)).toBe('current')
      expect(retractTranslationMode('off', n)).toBe('off')
    }
  })

  it('单调性：行数增加时档位不会变宽', () => {
    const rank = { off: 0, current: 1, dual: 2, multi: 3 } as const
    for (const requested of ['multi', 'dual', 'current'] as const) {
      let prev = rank[retractTranslationMode(requested, 1)]
      for (let n = 2; n <= 40; n++) {
        const cur = rank[retractTranslationMode(requested, n)]
        expect(cur).toBeLessThanOrEqual(prev)
        prev = cur
      }
    }
  })

  it('收缩后堆叠比例确实下降（收缩有意义）', () => {
    const before = translationStackFraction(10, 'multi')
    const after = translationStackFraction(10, retractTranslationMode('multi', 10))
    expect(after).toBeLessThan(before)
  })

  it('收缩结果要么落在阈值内，要么已到最窄档', () => {
    for (let n = 1; n <= 40; n++) {
      const mode = retractTranslationMode('multi', n)
      if (mode !== 'off') {
        expect(translationStackFraction(n, mode)).toBeLessThanOrEqual(0.72)
      }
    }
  })

  it('堆叠比例随行数线性增长（几何推导的前提）', () => {
    const a = translationStackFraction(4, 'multi')
    const b = translationStackFraction(8, 'multi')
    expect(b).toBeCloseTo(a * 2, 6)
  })
})
