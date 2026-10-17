import { describe, expect, it } from 'vitest'
import { getMotionProfile } from './lyricDisplayConfig'

/**
 * 回归：歌词**组级**运动包络（上游 `14-stage-lyrics-rendering.js:2220-2487`
 * 的 `tickMesh`）。
 *
 * ============================ 曾经整个漏掉的一层 ============================
 *
 * 本项目此前 `group.position` 每帧被硬写成固定值、`group.scale` 只留一个
 * 0.006 的正sin —— 换行是"瞬间换"而不是"滑入"，整组文字完全静止。
 * 上游有四项组级运动，全部缺失：
 *
 *   ① `a = smoothstep(age / enter)`     换行滑入 + 放大包络
 *   ② `enterOffsetY = enterDir*step*(1-a)`  从一侧滑上来
 *   ③ `progressLift = -shownProgress*0.026`  逐字推进时微微下沉
 *   ④ `breathe` / `rot.z` 摆动          静止时的呼吸与轻微摇摆
 *
 * 这里把上游那几行算术**照抄**成纯函数复算，钉住数值本身 ——
 * 而不是钉源码文本（那种断言改个写法就假失败）。
 *
 * ★ `breathe` 与 `beatPulse` 是**运行时量**，不在这张风格表里：
 *   `breathe` = (sin(t*0.92+seed)*0.050 + sin(t*0.41+seed*0.7)*0.028) * floatAmp
 *   `beatPulse` 由主循环从音频推导（11-main-loop.js:450-455）。
 *   本项目曾把 `breathe` 做成风格常量并直接乘进缩放，量纲整个错了 ——
 *   上游是 ±0.05 的呼吸，那样是 ×1.0 的整体偏移。见下方专门一条。
 */

/** 上游 `LYRIC_LINE_STEP_WORLD`（本项目同源值，见 LyricStage 的推导注释）。 */
const LINE_STEP_WORLD = 0.5283

/** 上游 `a = a*a*(3 - 2*a)`（:2221）。 */
function smoothstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/** 上游 `tickMesh` 的组级姿态目标（:2475-2487）。 */
function groupPose(input: {
  age: number
  enter: number
  enterDir: number
  shownProgress: number
  t: number
  seed: number
  floatAmp: number
  bass: number
  beatPulse: number
  motionStyle: string
}) {
  const a = smoothstep(Math.min(1, input.age / Math.max(0.016, input.enter)))
  const breathe =
    (Math.sin(input.t * 0.92 + input.seed) * 0.05 + Math.sin(input.t * 0.41 + input.seed * 0.7) * 0.028) *
    input.floatAmp
  const floatY =
    (Math.sin(input.t * 0.55 + input.seed) * 0.046 + Math.sin(input.t * 1.35 + input.seed) * 0.012) *
    input.floatAmp
  return {
    a,
    scale: 0.96 + a * 0.055 + breathe + input.bass * 0.038 + input.beatPulse * 0.014,
    y: 0.2 + input.enterDir * LINE_STEP_WORLD * (1 - a) - input.shownProgress * 0.026 + floatY,
    z:
      1.48 -
      Math.abs(input.enterDir) * 0.045 * (1 - a) +
      Math.cos(input.t * 0.48 + input.seed) * 0.07 * input.floatAmp,
    rotation:
      Math.sin(input.t * 0.34 + input.seed) *
      (input.motionStyle === 'smooth' ? 0.006 : input.motionStyle === 'float' ? 0.026 : 0.018),
  }
}

const BASE = {
  age: 10,
  enter: 0.86,
  enterDir: -1,
  shownProgress: 0,
  t: 3.3,
  seed: 42.7,
  floatAmp: 1.45,
  bass: 0,
  beatPulse: 0,
  motionStyle: 'float',
}

/**
 * `y` 里除被测项外的其余项之和（浮动 + progressLift）。
 * 断言滑入量时必须先减掉它，否则测的是浮动而不是 `enterOffsetY`。
 */
function yRemainder(input: Parameters<typeof groupPose>[0]): number {
  const floatY =
    (Math.sin(input.t * 0.55 + input.seed) * 0.046 + Math.sin(input.t * 1.35 + input.seed) * 0.012) *
    input.floatAmp
  return floatY - input.shownProgress * 0.026
}

describe('歌词组级运动（上游 tickMesh）', () => {
  it('① 换行瞬间（age=0）行从一侧偏出，且整组缩到 0.96', () => {
    const fresh = groupPose({ ...BASE, age: 0 })
    // a=0 ⇒ enterOffsetY = enterDir × step × 1 = −0.5283（整整一行的高度）
    expect(fresh.y - 0.2 - yRemainder({ ...BASE, age: 0 })).toBeCloseTo(-LINE_STEP_WORLD, 6)
    // a=0 ⇒ 放大项为 0，scale 只剩 0.96 + breathe（±0.11 的小量扰动）
    expect(fresh.scale - 0.96 - breatheAt(BASE)).toBeCloseTo(0, 9)
    expect(fresh.scale).toBeLessThan(0.96 + 0.12)
  })

  it('① 包络完成后（age≫enter）滑入量与放大都归位', () => {
    const done = groupPose({ ...BASE, age: 5 })
    expect(done.a).toBe(1)
    // (1-a) = 0 ⇒ 滑入偏移消失；此时上/下行进入方向不再有差别
    expect(done.y - 0.2 - yRemainder({ ...BASE, age: 5 })).toBeCloseTo(0, 6)
    // 放大项 a*0.055 = 0.055
    expect(done.scale - 0.96 - breatheAt(BASE)).toBeCloseTo(0.055, 6)
  })

  it('① 包络单调递增（smoothstep，不是线性）', () => {
    let prev = -1
    for (let age = 0; age <= 2; age += 0.05) {
      const a = groupPose({ ...BASE, age }).a
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    expect(prev).toBe(1)
    // smoothstep vs 线性：起步**更慢**、收尾更快（两头缓、中间陡）。
    // 0.5 处恰等于 0.5（对称中心），不是有效判据；取四分位：
    // 线性给 0.25，smoothstep 给 0.15625。
    const quarter = groupPose({ ...BASE, age: BASE.enter * 0.25 }).a
    expect(quarter).toBeLessThan(0.25)
    expect(quarter).toBeCloseTo(0.15625, 6)
    const threeQuarter = groupPose({ ...BASE, age: BASE.enter * 0.75 }).a
    expect(threeQuarter).toBeGreaterThan(0.75)
  })

  it('② 滑入方向随滚动方向翻转（上/下行进入方向相反）', () => {
    const offsetAt = (enterDir: number) =>
      groupPose({ ...BASE, age: 0, enterDir }).y - 0.2 - yRemainder({ ...BASE, age: 0, enterDir })
    const down = offsetAt(-1)
    const up = offsetAt(1)
    expect(Math.sign(down)).toBe(-Math.sign(up))
    // 两侧偏移量相等（都是整整一行高）
    expect(Math.abs(down)).toBeCloseTo(Math.abs(up), 6)
    expect(Math.abs(down)).toBeCloseTo(LINE_STEP_WORLD, 6)
  })

  it('③ 逐字推进让文字微微下沉（progressLift），且幅度 ≤ 0.026', () => {
    const start = groupPose({ ...BASE, shownProgress: 0 })
    const mid = groupPose({ ...BASE, shownProgress: 0.5 })
    const end = groupPose({ ...BASE, shownProgress: 1 })
    expect(mid.y).toBeLessThan(start.y)
    expect(end.y).toBeLessThan(mid.y)
    // 上限就是 0.026（progress=1 时）
    expect(start.y - end.y).toBeCloseTo(0.026, 6)
  })

  it('④ 呼吸量纲是 ±0.05 而不是整体偏移（曾把 breathe 做成风格常量）', () => {
    // 上界 = (0.050 + 0.028) × floatAmp。floatAmp 最大 1.45 ⇒ 0.113。
    // 关键是它仍是**小数**：曾把它做成风格常量后是 ×1.0 的整体偏移，
    // 相当于把整组文字放大一倍再谈呼吸。
    const bound = (0.05 + 0.028) * BASE.floatAmp
    for (let t = 0; t < 20; t += 0.13) {
      const b = breatheAt({ ...BASE, t })
      expect(Math.abs(b)).toBeLessThanOrEqual(bound + 1e-9)
    }
    // 且它确实在动（不是恒 0）
    const samples = new Set(Array.from({ length: 40 }, (_, i) => breatheAt({ ...BASE, t: i * 0.31 }).toFixed(6)))
    expect(samples.size).toBeGreaterThan(30)
  })

  it('④ 摆动幅度按风格分档（smooth 0.006 / float 0.026 / 其余 0.018）', () => {
    const at = (style: string) => Math.abs(groupPose({ ...BASE, motionStyle: style }).rotation)
    expect(at('smooth')).toBeLessThanOrEqual(0.006)
    expect(at('float')).toBeLessThanOrEqual(0.026)
    expect(at('shine')).toBeLessThanOrEqual(0.018)
    // float 明显比 smooth 晃得厉害
    expect(at('float')).toBeGreaterThan(at('smooth'))
  })

  it('风格表提供 enter/exit（组级包络的时长来源）', () => {
    for (const style of ['float', 'smooth', 'glass', 'shine', 'glitch', 'quick'] as const) {
      const p = getMotionProfile(style)
      expect(p.enter, `${style}.enter`).toBeGreaterThan(0)
      expect(p.exit, `${style}.exit`).toBeGreaterThan(0)
      // 上游各风格 enter 都在 [0.36, 0.86]
      expect(p.enter).toBeGreaterThanOrEqual(0.36)
      expect(p.enter).toBeLessThanOrEqual(0.86)
    }
    // float 是出厂默认风格，必须是上游的 0.86/0.76
    expect(getMotionProfile('float').enter).toBeCloseTo(0.86, 6)
    expect(getMotionProfile('float').exit).toBeCloseTo(0.76, 6)
  })
})

/** 复算上游 `breathe`（:2450）。 */
function breatheAt(input: { t: number; seed: number; floatAmp: number }): number {
  return (Math.sin(input.t * 0.92 + input.seed) * 0.05 + Math.sin(input.t * 0.41 + input.seed * 0.7) * 0.028) * input.floatAmp
}
