import { describe, expect, it } from 'vitest'
import {
  COVER_DEPTH_TWEEN_MS,
  DEPTH_SETTLED_EPSILON,
  beginCoverDepthTween,
  createCoverDepthTween,
  stepCoverDepth,
} from './coverDepthTween'
import { visualEase } from './loadingState'

/**
 * 回归：封面深度补间（上游 `setCoverDepthState`，
 * `02-visual/15-ripples-cover-depth.js:486-514`）。
 *
 * ============================ 曾经的偏差 ============================
 *
 * 本项目此前：
 *   · `uHasDepth` 写成 `edgeTexture ? 1 : 0` —— **瞬变**
 *   · `uAiBoost` 用固定速率 `dt * 4` 缓动 —— 时长随帧率漂移
 *
 * 上游是两者**成对**、同一条 rAF、同一个 visualEase 系数，时长显式
 * （120 / 180 / 260 / 360ms，`:306`/`:588`/`:591`/`:629`）。
 *
 * 视觉后果：`uHasDepth` 在着色器里改变构图
 *   depthZ = (depthVal-0.5) * uAiBoost * uDepth * 1.40 * uHasDepth
 *   if (uHasDepth > 0.5 && uPreset < 0.5) bgMul = mix(1, 0.55, …)
 * 瞬变 ⇒ 切歌时封面从"平面"突然"有纵深"，背景同时暗一下。
 */

describe('beginCoverDepthTween', () => {
  it('durationMs ≤ 1 时返回 false（调用方必须硬落位）', () => {
    const s = createCoverDepthTween()
    const armed = beginCoverDepthTween(s, { depth: 0, ai: 0 }, { depth: 1, ai: 0.55 }, 1)
    expect(armed).toBe(false)
    expect(s.target).toBeNull()
  })

  it('两个值都已到位（<0.001）时也走硬落位', () => {
    const s = createCoverDepthTween()
    const armed = beginCoverDepthTween(
      s,
      { depth: 1 - DEPTH_SETTLED_EPSILON * 0.5, ai: 0.55 },
      { depth: 1, ai: 0.55 },
      180,
    )
    expect(armed).toBe(false)
  })

  it('正常路径装配补间，起点取**当前值**', () => {
    const s = createCoverDepthTween()
    const armed = beginCoverDepthTween(s, { depth: 0, ai: 0 }, { depth: 1, ai: 0.55 }, 180)
    expect(armed).toBe(true)
    expect(s.target).toEqual({ depth: 1, ai: 0.55 })
    expect(s.fromDepth).toBe(0)
    expect(s.fromAi).toBe(0)
    expect(s.durationMs).toBe(180)
    expect(s.startedAt).toBeGreaterThan(0)
  })

  it('从半路开始时起点是半路值（切歌打断上一次补间）', () => {
    const s = createCoverDepthTween()
    beginCoverDepthTween(s, { depth: 0, ai: 0 }, { depth: 1, ai: 0.55 }, 180)
    // 手动把当前值推到半路，再起一次补间
    const armed = beginCoverDepthTween(s, { depth: 0.4, ai: 0.3 }, { depth: 0, ai: 0 }, 96)
    expect(armed).toBe(true)
    expect(s.fromDepth).toBeCloseTo(0.4, 12)
    expect(s.fromAi).toBeCloseTo(0.3, 12)
    expect(s.target).toEqual({ depth: 0, ai: 0 })
  })

  it('目标与时长都被夹取（clamp01 / max(1, …)）', () => {
    const s = createCoverDepthTween()
    beginCoverDepthTween(s, { depth: 0, ai: 0 }, { depth: 5, ai: -3 }, 0)
    // durationMs = 0 → max(1, 0) = 1 → 命中硬落位，target 不装配
    expect(s.target).toBeNull()

    const s2 = createCoverDepthTween()
    beginCoverDepthTween(s2, { depth: 0, ai: 0 }, { depth: 5, ai: -3 }, 180)
    expect(s2.target).toEqual({ depth: 1, ai: 0 })
  })
})

describe('stepCoverDepth', () => {
  it('两个值共用同一个 eased 系数（上游 :505 的两行）', () => {
    const s = createCoverDepthTween()
    beginCoverDepthTween(s, { depth: 0, ai: 0 }, { depth: 1, ai: 0.55 }, 180)
    const at = s.startedAt + 90 // 半程
    const stepped = stepCoverDepth(s, at, { depth: 0, ai: 0 })
    const eased = visualEase(0.5)
    expect(stepped.depth).toBeCloseTo(eased, 12)
    expect(stepped.ai).toBeCloseTo(0.55 * eased, 12)
    expect(stepped.done).toBe(false)
  })

  it('走完后硬落位到目标并标记 done', () => {
    const s = createCoverDepthTween()
    beginCoverDepthTween(s, { depth: 0, ai: 0 }, { depth: 1, ai: 0.55 }, 180)
    // ★ 用 `startedAt + 180 + 1` 而不是恰好 `+180`：`raw = (now-start)/durationMs`
    //   是浮点，`180/180` 在部分时钟读数下算出 0.9999999999999999，
    //   于是 `raw < 1` 成立、走未完成支 ⇒ done 为 false。
    //   上游判据就是 `t < 1`（15-ripples-cover-depth.js:507），**照搬不改**；
    //   要测的是"越过终点后硬落位"，时钟就必须真的越过终点。
    const stepped = stepCoverDepth(s, s.startedAt + 181, { depth: 0.5, ai: 0.2 })
    expect(stepped.depth).toBe(1)
    expect(stepped.ai).toBe(0.55)
    expect(stepped.done).toBe(true)
  })

  it('无补间时原样返回（done=true，调用方清空）', () => {
    const s = createCoverDepthTween()
    const stepped = stepCoverDepth(s, performance.now(), { depth: 0.7, ai: 0.1 })
    expect(stepped).toEqual({ depth: 0.7, ai: 0.1, done: true })
  })

  it('单调递增（0 → 1）', () => {
    const s = createCoverDepthTween()
    beginCoverDepthTween(s, { depth: 0, ai: 0 }, { depth: 1, ai: 0.55 }, 180)
    let prevD = -1
    let prevA = -1
    for (let t = 0; t <= 180; t += 10) {
      const stepped = stepCoverDepth(s, s.startedAt + t, { depth: 0, ai: 0 })
      expect(stepped.depth).toBeGreaterThanOrEqual(prevD)
      expect(stepped.ai).toBeGreaterThanOrEqual(prevA)
      prevD = stepped.depth
      prevA = stepped.ai
    }
    expect(prevD).toBe(1)
    expect(prevA).toBe(0.55)
  })

  it('单调递减（1 → 0，无深度缓存那一档）', () => {
    const s = createCoverDepthTween()
    beginCoverDepthTween(s, { depth: 1, ai: 0.55 }, { depth: 0, ai: 0 }, 96)
    let prevD = 2
    for (let t = 0; t <= 96; t += 8) {
      const stepped = stepCoverDepth(s, s.startedAt + t, { depth: 1, ai: 0.55 })
      expect(stepped.depth).toBeLessThanOrEqual(prevD)
      prevD = stepped.depth
    }
    expect(prevD).toBe(0)
  })
})

describe('时长常量与上游四个调用点逐一对齐', () => {
  it('重算完成 180ms（本项目唯一使用的非零档）', () => {
    expect(COVER_DEPTH_TWEEN_MS.recomputed).toBe(180)
  })

  it('其余三档保留备查', () => {
    // :306 AI 深度后台增强
    expect(COVER_DEPTH_TWEEN_MS.aiEnhanced).toBe(360)
    // :588 命中深度缓存
    expect(COVER_DEPTH_TWEEN_MS.cached).toBe(120)
    // :591 无缓存 → 中性边缘（1ms 命中硬落位分支）
    expect(COVER_DEPTH_TWEEN_MS.neutral).toBe(1)
  })
})
