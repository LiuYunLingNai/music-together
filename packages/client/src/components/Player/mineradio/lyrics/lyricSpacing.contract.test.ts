import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 结构性回归：歌词各行**不得重叠**，且译词必须与**它的**主歌词成组。
 *
 * ============================ 真实事故 ============================
 *
 * 第二十五轮把 AMLL 的 `gap: 0.3em` 直接当成"主歌词中心 → 译词中心"的
 * 距离使用 —— 这是**量纲错误**：AMLL 的 `gap` 是 flex 容器里两个
 * `line-height` 盒子之间的**空白**，而本项目需要的是**中心距**。
 * 结果译词与主歌词实际叠进去近半个字高（字形边缘间距 −0.46em），
 * 用户反馈"译词间距现在变得小的和主歌词之间产生重叠了"。
 *
 * 第二十六轮改为"把上游总间距 2.1214 槽位**均分**到译词两侧"：
 * 上方 = 下方 = 1.0607 槽位 → 字形边缘间距各 +0.297em，完全对称。
 *
 * 本测试从**源码常量**重新推导几何，断言：
 *   1. 主歌词 → 译词 不重叠
 *   2. 译词 → 下一句主歌词 不重叠
 *   3. 译词离**自己的**主歌词不比离**下一句**更远（成组方向正确）
 *   4. 总跨度保持上游出厂值（改动不影响整体节奏）
 */
const LYRIC_STAGE = readFileSync(join(__dirname, 'LyricStage.tsx'), 'utf8')

/** 从源码里取一个 `const NAME = <number>` 形式的常量。 */
function numericConstant(source: string, name: string): number {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`)
  const m = source.match(re)
  expect(m, `常量 ${name} 未找到`).toBeTruthy()
  return Number(m![1])
}

/** 从源码里取 `const NAME = <expr>` 并求值（仅允许数字与四则运算）。 */
function expressionConstant(source: string, name: string): number {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*([0-9./*+\\-\\s()]+)\\n`)
  const m = source.match(re)
  expect(m, `常量 ${name} 未找到`).toBeTruthy()
  const expr = m![1].trim()
  expect(expr, `${name} 的表达式含非算术内容，无法安全求值`).toMatch(/^[0-9./*+\-\s()]+$/)
  return Number(new Function(`return (${expr})`)())
}

const WORLD_W = numericConstant(LYRIC_STAGE, 'WORLD_W')
const STEP = numericConstant(LYRIC_STAGE, 'LYRIC_LINE_STEP_WORLD')
const TRANS_FONT_SCALE = numericConstant(LYRIC_STAGE, 'TRANS_FONT_SCALE')
const SLOT_PLAIN = numericConstant(LYRIC_STAGE, 'SLOT_PLAIN')
const SLOT_WITH_TRANS = numericConstant(LYRIC_STAGE, 'SLOT_WITH_TRANS')
const TRANS_GAP = expressionConstant(LYRIC_STAGE, 'TRANS_GAP')

/** 栅格常量（与 rasterizeLyricMask 同源）。 */
const LYRIC_FONT_SIZE = 128
const LYRIC_MASK_BASE_WIDTH = 2048
const WORLD_PER_PX = WORLD_W / LYRIC_MASK_BASE_WIDTH
const MAIN_GLYPH = LYRIC_FONT_SIZE * WORLD_PER_PX
const TRANS_GLYPH = MAIN_GLYPH * TRANS_FONT_SCALE

/** 两行不重叠所需的最小中心距。 */
const touch = (a: number, b: number) => (a + b) / 2

describe('歌词元素间距：不重叠 + 成组正确', () => {
  it('主歌词 → 它的译词 不重叠', () => {
    const center = TRANS_GAP * STEP
    expect(center).toBeGreaterThan(touch(MAIN_GLYPH, TRANS_GLYPH))
  })

  it('译词 → 下一句主歌词 不重叠', () => {
    const center = (SLOT_WITH_TRANS - TRANS_GAP) * STEP
    expect(center).toBeGreaterThan(touch(TRANS_GLYPH, MAIN_GLYPH))
  })

  it('译词与上方、下方的间距相等（均分，观感对称）', () => {
    const above = TRANS_GAP * STEP - touch(MAIN_GLYPH, TRANS_GLYPH)
    const below = (SLOT_WITH_TRANS - TRANS_GAP) * STEP - touch(TRANS_GLYPH, MAIN_GLYPH)
    expect(above).toBeCloseTo(below, 6)
  })

  it('译词不被误判成属于下一句（离自己的主歌词不比离下一句更远）', () => {
    const above = TRANS_GAP * STEP - touch(MAIN_GLYPH, TRANS_GLYPH)
    const below = (SLOT_WITH_TRANS - TRANS_GAP) * STEP - touch(TRANS_GLYPH, MAIN_GLYPH)
    // 上方间距不得显著大于下方（否则眼睛把译词归到下一句）
    expect(above).toBeLessThanOrEqual(below + 1e-9)
  })

  it('总跨度保持上游出厂值（间距分配不影响整体节奏）', () => {
    expect(SLOT_WITH_TRANS).toBeCloseTo(2.1214, 6)
  })

  it('连续主歌词（无译词）之间的间距保持上游值', () => {
    expect(SLOT_PLAIN).toBeCloseTo(1, 6)
  })
})
