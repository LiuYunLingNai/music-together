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
 * ★ 本轮（忠实移植）改为**直接照搬上游**，均分方案废止：
 *
 *   上游 `12-lyrics-row-layers.js:63/77` 的译词行 Y：
 *     y = −parentDelta × lineStepWorld − sign × visualGap × translationLineStepWorld
 *   即"主行→译词"与"译词→下一主行"用**两个不同的步长**：
 *     · 主行步长   `lyricTrackLineStepWorld`      = 0.38125 × spread × 1.06
 *     · 译词步长   `lyricTranslationLineStepWorld` = 0.38125 × 1.04
 *   叠加 `visualGap = 1.2104`（上游 `lyricTranslationVisualGapValue()`）后：
 *     主行 → 译词     = 1.2104 × 0.3965 = 0.4800 world
 *     译词 → 下一主行 = 2.1214 × 0.5283 − 0.4800 = 0.6410 world
 *   上游的分布**本来就是不对称的**（译词离自己的主歌词更远、离下一句更近），
 *   这是上游的观感，不再代偿。
 *
 * 本测试从**源码常量**重新推导几何，断言：
 *   1. 主歌词 → 译词 不重叠
 *   2. 译词 → 下一句主歌词 不重叠
 *   3. 两个间距都为正（不重叠的充分条件，且方向与上游一致）
 *   4. 总跨度保持上游出厂值（改动不影响整体节奏）
 */
const LYRIC_STAGE = readFileSync(join(__dirname, 'LyricStage.tsx'), 'utf8')

/**
 * 从源码里取一个 `const NAME = <number>` 形式的常量。
 *
 * `Math.min/max` 包住的夹取式常量（上游 `clampRange` 的等价写法）也能解析：
 * 去掉外层调用后只留数字与四则运算，交 `expressionConstant` 求值。
 */
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

/**
 * 取上游 `clampRange(lo, hi, expr)` 的等价夹取常量。
 *
 * 源码写成嵌套的 `Math.min(hi, Math.max(lo, expr))`（可能跨多行），
 * 因此用**括号配对**抓出最外层的参数块，再取最内层 `Math.max` 的第三个参数
 * —— 那就是被夹取的表达式本身。`LYRIC_CONTEXT_SPREAD` 等中间量也一并用
 * 源码里的实际值代入，避免测试与常量漂移。
 */
function clampedConstant(source: string, name: string): number {
  const start = source.indexOf(`const ${name} = Math.min(`)
  expect(start, `夹取常量 ${name} 未找到`).toBeGreaterThanOrEqual(0)
  // 从第一个 `(` 开始按深度找配对的 `)`
  const open = source.indexOf('(', start)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  expect(end, `${name} 的括号未配对`).toBeGreaterThan(open)
  const args = splitTopLevelArgs(source.slice(open + 1, end))
  expect(args.length, `${name} 应有 2 个参数（hi, Math.max(...)）`).toBe(2)
  const inner = args[1].trim()
  expect(inner, `${name} 内层应为 Math.max`).toMatch(/^Math\.max\(/)
  const innerArgs = splitTopLevelArgs(inner.slice(inner.indexOf('(') + 1, inner.lastIndexOf(')')))
  // 参数形如 `lo, expr,` —— 尾逗号会被 splitTopLevelArgs 丢掉，因此是 2 个；
  // 夹在中间的 spread 乘子（如 `* 1.06`）属于 expr 自身，不构成第三个参数。
  expect(innerArgs.length, `${name} 内层参数个数异常`).toBeGreaterThanOrEqual(2)
  const expr = innerArgs[innerArgs.length - 1]
    .trim()
    .replace(/,$/, '')
    // 中间量（`LYRIC_LINE_STEP_BASE_WORLD` / `LYRIC_CONTEXT_SPREAD`）用源码里的
    // 实际值代入，避免测试与常量各自漂移。
    .replace(/LYRIC_LINE_STEP_BASE_WORLD/g, String(numericConstant(source, 'LYRIC_LINE_STEP_BASE_WORLD')))
    .replace(/LYRIC_CONTEXT_SPREAD/g, String(numericConstant(source, 'LYRIC_CONTEXT_SPREAD')))
  // 允许 `Math.min/max` —— 被夹取的表达式内部还嵌着一层内层夹取
  // （如 `Math.min(1.45, Math.max(0.86, …))`，对应上游的 spread 夹区）。
  expect(expr, `${name} 的表达式含非算术内容，无法安全求值`).toMatch(
    /^(?:[0-9.]+|Math\.(?:min|max)|[\s(),*/+-])+$/,
  )
  return Number(new Function(`return (${expr})`)())
}

/** 按顶层逗号切分（忽略括号内的逗号）。 */
function splitTopLevelArgs(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur)
  return out
}

const WORLD_W = numericConstant(LYRIC_STAGE, 'WORLD_W')
const STEP = clampedConstant(LYRIC_STAGE, 'LYRIC_LINE_STEP_WORLD')
const TRANS_STEP = clampedConstant(LYRIC_STAGE, 'LYRIC_TRANSLATION_STEP_WORLD')
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
    // 上游口径：这一段走**译词独立步长**
    const center = TRANS_GAP * TRANS_STEP
    expect(center).toBeGreaterThan(touch(MAIN_GLYPH, TRANS_GLYPH))
  })

  it('译词 → 下一句主歌词 不重叠', () => {
    // 译词槽位到下一主行槽位的总跨度为 SLOT_WITH_TRANS，减去译词段
    const center = (SLOT_WITH_TRANS - TRANS_GAP) * STEP
    expect(center).toBeGreaterThan(touch(TRANS_GLYPH, MAIN_GLYPH))
  })

  it('译词两侧间距都与上游同向（世界距离近似等分，略偏自己的主歌词）', () => {
    const above = TRANS_GAP * TRANS_STEP - touch(MAIN_GLYPH, TRANS_GLYPH)
    const below = (SLOT_WITH_TRANS - TRANS_GAP) * STEP - touch(TRANS_GLYPH, MAIN_GLYPH)
    // 两侧都为正 → 都不重叠
    expect(above).toBeGreaterThan(0)
    expect(below).toBeGreaterThan(0)
    // 换算到**世界距离**后，上游的分布几乎就是均分的（比值 ≈0.993）：
    // 槽位上"译词离自己的主歌词更远"的印象，被译词独立步长
    // （0.3965 < 0.5283）抵消掉了。故断言"近似相等"而非某个方向。
    expect(Math.abs(above - below) / below).toBeLessThan(0.05)
  })

  it('总跨度保持上游出厂值（间距分配不影响整体节奏）', () => {
    expect(SLOT_WITH_TRANS).toBeCloseTo(2.1214, 6)
  })

  it('连续主歌词（无译词）之间的间距保持上游值', () => {
    // 上游 `lyricLineSlotStepValue` 的非译词分支：
    //   clamp(1.04 + (1.96 − 1) × 0.10, 0.96, 1.24) = 1.136
    expect(SLOT_PLAIN).toBeCloseTo(1.136, 6)
  })
})
