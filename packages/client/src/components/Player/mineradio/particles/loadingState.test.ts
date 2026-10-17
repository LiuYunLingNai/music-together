import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOADING_FADE_IN_MS,
  LOADING_FADE_OUT_MS,
  LOADING_MIN_HOLD_MS,
  LOADING_PEAK,
  getLoadingState,
  hideLoading,
  resetLoadingState,
  showLoading,
  stepLoading,
  tweenLoading,
  visualEase,
} from './loadingState'

/**
 * 回归：加载态雾环（上游 `uLoading`，`02-visual/15-ripples-cover-depth.js:375-458`）。
 *
 * ============================ 曾经整个断掉的一条链 ============================
 *
 * 着色器侧的雾状微尘流（`shaders/particleVertex.ts:515-547`，上游
 * `00-pointer-cover-particles.js:929-973`）是**逐行对齐**的：粒子按
 * `mix(pos, mistPos, uLoading)` 聚成一层缓慢漂浮的雾尘。但
 * `uniforms.uLoading.value` 此前**没有任何写入方** —— 恒为 0，
 * 于是 `if (uLoading > 0.001)` 永不成立，整段是死代码。
 *
 * 这里用数值复算钉住上游那四个函数的算术，而不是钉源码文本。
 *
 * ★ 用例共用 `loadingState.ts` 的**模块级单例**，因此每个用例前后都要
 *   `resetLoadingState()`；fake timers 也必须成对使用/还原。
 *
 * ★ `getLoadingState()` 返回的是**单例本身**（可变引用）；
 *   `createLoadingState()` 只是出厂值模板。断言必须读前者 ——
 *   读模板永远得到全 0 的初值。
 */

afterEach(() => {
  vi.useRealTimers()
  resetLoadingState()
})

describe('visualEase（上游 visualEase）', () => {
  it('就是 smoothstep', () => {
    expect(visualEase(0)).toBe(0)
    expect(visualEase(1)).toBe(1)
    expect(visualEase(0.5)).toBeCloseTo(0.5, 12)
    // 四分位 0.15625（线性会给 0.25）—— 两头缓、中间陡
    expect(visualEase(0.25)).toBeCloseTo(0.15625, 12)
    expect(visualEase(0.75)).toBeCloseTo(0.84375, 12)
  })

  it('夹取越界输入', () => {
    expect(visualEase(-3)).toBe(0)
    expect(visualEase(9)).toBe(1)
  })
})

describe('showLoading', () => {
  it('首次显示走 118ms 慢档，目标夹到 0.56', () => {
    resetLoadingState()
    showLoading()
    const s = getLoadingState()
    expect(s.value).toBe(0)
    // 首次（value=0，不大于 0.04）→ 慢档
    expect(s.durationMs).toBe(LOADING_FADE_IN_MS.slow)
    expect(s.target).toBe(LOADING_PEAK)
    expect(s.active).toBe(true)
    expect(s.shownAt).toBeGreaterThan(0)
  })

  it('已在显示中（>0.04）时走 86ms 快档', () => {
    resetLoadingState()
    showLoading()
    stepLoading(performance.now() + 10_000) // 直接把补间跑完 → value = 0.56
    showLoading()
    const s = getLoadingState()
    expect(s.value).toBeCloseTo(LOADING_PEAK, 12)
    expect(s.durationMs).toBe(LOADING_FADE_IN_MS.fast)
  })

  it('目标取 max(current, 0.56) —— 不会从更高的值掉下来', () => {
    resetLoadingState()
    tweenLoading(0.9, 1)
    stepLoading(performance.now() + 10_000)
    expect(getLoadingState().value).toBeCloseTo(0.9, 12)
    showLoading()
    expect(getLoadingState().target).toBeCloseTo(0.9, 12)
  })

  it('重复调用只保留最后一次 shownAt（最短展示时长从最后一次起算）', () => {
    resetLoadingState()
    showLoading()
    const first = getLoadingState().shownAt
    showLoading()
    expect(getLoadingState().shownAt).toBeGreaterThanOrEqual(first)
  })
})

describe('hideLoading', () => {
  it('最短展示 72ms（上游 max(0, 72 - elapsed)）', () => {
    vi.useFakeTimers()
    resetLoadingState()
    vi.advanceTimersByTime(1000) // 把时钟推离 0
    showLoading()
    const shownAt = getLoadingState().shownAt
    expect(shownAt).toBeGreaterThan(0)
    // 立刻 hide：elapsed ≈ 0 → wait = 72ms，此刻**还没**开始退场。
    // 注意此刻 value 仍是 0（补间一步都没走），因此到期后命中的是
    // "已归零" 分支（current ≤ 0.015）—— 那正是上游 :436 的短路。
    hideLoading()
    expect(getLoadingState().target).toBe(LOADING_PEAK)
    expect(vi.getTimerCount()).toBe(1)
    // 72ms 前一步：仍在等待
    vi.advanceTimersByTime(LOADING_MIN_HOLD_MS - 1)
    expect(getLoadingState().target).toBe(LOADING_PEAK)
    // 跨过 72ms：到期。value 仍为 0 ⇒ 硬置 0 而不另起补间
    vi.advanceTimersByTime(2)
    expect(getLoadingState().value).toBe(0)
    expect(getLoadingState().target).toBeNull()
    expect(getLoadingState().active).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shownAt = 0 视为"从未显示"，elapsed 退化为 999（上游 :428）', () => {
    vi.useFakeTimers()
    resetLoadingState()
    showLoading() // 此刻 performance.now() === 0 ⇒ shownAt === 0
    expect(getLoadingState().shownAt).toBe(0)
    hideLoading()
    // elapsed = 999 > 72 ⇒ wait = 0。注意 setTimeout(…, 0) 仍是**异步**的：
    // 此刻补间尚未装配，要等一个宏任务。
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(0)
    expect(getLoadingState().target).toBeNull()
    expect(getLoadingState().value).toBe(0)
  })

  it('已展示超过 72ms 时立即开始退场', () => {
    vi.useFakeTimers()
    resetLoadingState()
    vi.advanceTimersByTime(1000)
    showLoading()
    // 把 shownAt 推到 500ms 前（fake timers 不推进 performance.now，
    // 因此手动改写这个时刻来模拟"已经展示很久了"）
    getLoadingState().shownAt = performance.now() - 500
    stepLoading(performance.now() + 10_000) // 直接把淡入跑完 → value = 0.56
    expect(getLoadingState().value).toBeCloseTo(LOADING_PEAK, 12)
    hideLoading()
    // elapsed = 500 > 72 → wait = 0，一个宏任务后即退场
    vi.advanceTimersByTime(0)
    expect(getLoadingState().target).toBe(0)
    // value 0.56 > 0.38 → 慢档 126ms
    expect(getLoadingState().durationMs).toBe(LOADING_FADE_OUT_MS.long)
  })

  it('退场时长按 0.38 分档：>0.38 走 126ms，否则 96ms', () => {
    vi.useFakeTimers()
    resetLoadingState()
    showLoading()
    // 只推进到一半（0.28 < 0.38）：起点 0、目标 0.56，t=0.5 时
    // eased = smoothstep(0.5) = 0.5 ⇒ value = 0.28
    const startedAt = getLoadingState().startedAt
    stepLoading(startedAt + LOADING_FADE_IN_MS.slow * 0.5)
    expect(getLoadingState().value).toBeCloseTo(0.28, 12)
    // shownAt 是 0（fake timers 起点）⇒ elapsed 999 ⇒ wait 0
    hideLoading()
    vi.advanceTimersByTime(0)
    // value 0.28 ≤ 0.38 → 快档 96ms
    expect(getLoadingState().durationMs).toBe(LOADING_FADE_OUT_MS.short)
  })

  it('值已归零（≤0.015）时硬置 0 而不另起补间', () => {
    vi.useFakeTimers()
    resetLoadingState()
    showLoading()
    // 手动把值压到门槛以下（模拟"补间到 0 的途中又调了一次"）
    tweenLoading(0, 1)
    stepLoading(performance.now() + 10_000)
    expect(getLoadingState().value).toBe(0)
    hideLoading()
    vi.advanceTimersByTime(LOADING_MIN_HOLD_MS)
    expect(getLoadingState().value).toBe(0)
    expect(getLoadingState().target).toBeNull()
    expect(getLoadingState().active).toBe(false)
  })

  it('showLoading 能取消 pending 的 hideLoading（连续两次加载）', () => {
    vi.useFakeTimers()
    resetLoadingState()
    showLoading()
    hideLoading() // 排了一个 72ms 后的退场
    showLoading() // 又一次加载 → 退场必须被取消
    vi.advanceTimersByTime(500)
    // 仍然处于"已请求显示"状态，目标仍是峰值而不是 0
    expect(getLoadingState().active).toBe(true)
    expect(getLoadingState().target).toBe(LOADING_PEAK)
    // 且没有残留 timer
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('stepLoading', () => {
  it('无补间时保持原值', () => {
    resetLoadingState()
    expect(stepLoading(performance.now())).toBe(0)
  })

  it('按 smoothstep 从 from 走到 target', () => {
    resetLoadingState()
    tweenLoading(1, 100)
    const start = getLoadingState().startedAt
    const mid = stepLoading(start + 50)
    expect(mid).toBeCloseTo(visualEase(0.5), 12)
    // ★ 结束点必须**越过**时长，不能正好踩在 `start + duration` 上：
    //   `startedAt` 是 `performance.now()` 的分数值，
    //   `(start + 100) - start` 在二进制浮点下不恒等于 100
    //   （实测 99.99999999999977），于是 `t < 1` 成立、补间被判为"未完成"，
    //   `target` 不清零 —— 断言 `toBeNull()` 间歇性失败。
    //   上游由真实 rAF 时间戳驱动，天然越界；这里手工补 1ms 复现同一情形。
    const end = stepLoading(start + 101)
    expect(end).toBe(1)
    // 补间结束后 target 清空（上游 `loadingTween = null`）
    expect(getLoadingState().target).toBeNull()
  })

  it('新补间取消旧补间（不等旧补间走完）', () => {
    resetLoadingState()
    tweenLoading(1, 100)
    const start = getLoadingState().startedAt
    stepLoading(start + 90)
    const partial = getLoadingState().value
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
    // 中途改目标 —— 起点必须是**当前值**而不是最初的 0
    tweenLoading(0, 50)
    const s2 = getLoadingState()
    expect(s2.from).toBeCloseTo(partial, 12)
    // ★ 同样越过时长 1ms，理由见上一个用例（浮点下 `+50` 不保证正好 50ms）
    expect(stepLoading(s2.startedAt + 51)).toBe(0)
  })

  it('durationMs 下限为 1ms（上游 Math.max(1, durationMs || 1)）', () => {
    resetLoadingState()
    tweenLoading(1, 0)
    expect(getLoadingState().durationMs).toBe(1)
  })
})

describe('resetLoadingState', () => {
  it('清掉补间、计时器与 shownAt', () => {
    vi.useFakeTimers()
    resetLoadingState()
    showLoading()
    hideLoading() // 排一个 pending 退场
    expect(vi.getTimerCount()).toBe(1)
    resetLoadingState()
    const s = getLoadingState()
    expect(s.value).toBe(0)
    expect(s.target).toBeNull()
    expect(s.active).toBe(false)
    expect(s.shownAt).toBe(0)
    expect(s.hideTimer).toBeNull()
    // 复位后 pending 的退场不得再触发
    vi.advanceTimersByTime(1000)
    expect(getLoadingState().target).toBeNull()
  })
})

describe('常量与上游逐一对齐', () => {
  it('峰值与四档时长', () => {
    expect(LOADING_PEAK).toBe(0.56)
    expect(LOADING_FADE_IN_MS).toEqual({ fast: 86, slow: 118 })
    expect(LOADING_FADE_OUT_MS).toEqual({ long: 126, short: 96 })
    expect(LOADING_MIN_HOLD_MS).toBe(72)
  })
})
