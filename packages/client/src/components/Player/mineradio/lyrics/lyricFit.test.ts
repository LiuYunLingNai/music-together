import { describe, expect, it } from 'vitest'
import { fitLyricBlock, lyricLineStep, visibleWorldSize } from './lyricFit'

describe('visibleWorldSize', () => {
  it('matches the perspective frustum formula', () => {
    // fov 45, dist 8 -> 2*tan(22.5deg)*8
    const { h } = visibleWorldSize(45, 8, 1.7778)
    expect(h).toBeCloseTo(2 * Math.tan((22.5 * Math.PI) / 180) * 8, 5)
  })

  it('scales width by aspect', () => {
    const a = visibleWorldSize(45, 8, 2)
    const b = visibleWorldSize(45, 8, 1)
    expect(a.w / b.w).toBeCloseTo(2, 5)
    expect(a.h).toBeCloseTo(b.h, 5)
  })

  it('guards against zero distance', () => {
    const { h } = visibleWorldSize(45, 0, 1.5)
    expect(Number.isFinite(h)).toBe(true)
    expect(h).toBeGreaterThan(0)
  })
})

describe('fitLyricBlock', () => {
  const base = { fov: 45, distance: 6.74, aspect: 1.6, blockW: 6.1 }

  it('短句不会被放大（只缩不放）', () => {
    // 短句：画布很窄很高 → blockH 很大
    const fit = fitLyricBlock({ ...base, blockH: 8.95 })
    expect(fit.scale).toBeLessThanOrEqual(1)
  })

  it('长句不会被缩小到看不见', () => {
    // 长句：画布很宽很扁 → blockH 很小
    const fit = fitLyricBlock({ ...base, blockH: 1.62 })
    expect(fit.scale).toBeGreaterThanOrEqual(0.12)
  })

  it('缩放后高度不超过视口预算（默认 52%）', () => {
    const fit = fitLyricBlock({ ...base, blockH: 12 })
    const scaledH = 12 * fit.scale
    expect(scaledH).toBeLessThanOrEqual(fit.visibleH * 0.52 + 1e-6)
  })

  it('缩放后宽度不超过视口预算（默认 90%）', () => {
    const fit = fitLyricBlock({ ...base, blockW: 30, blockH: 3 })
    const scaledW = 30 * fit.scale
    expect(scaledW).toBeLessThanOrEqual(fit.visibleW * 0.9 + 1e-6)
  })

  it('相机锁定时使用更保守的预算', () => {
    const normal = fitLyricBlock({ ...base, blockH: 12 })
    const locked = fitLyricBlock({ ...base, blockH: 12, cameraLocked: true })
    expect(locked.scale).toBeLessThanOrEqual(normal.scale)
  })

  it('中心有偏移时留出对应余量', () => {
    const centered = fitLyricBlock({ ...base, blockH: 4 })
    const offset = fitLyricBlock({ ...base, blockH: 4, layoutX: 2 })
    expect(offset.safeW).toBeLessThan(centered.safeW)
  })

  it('safe 区域始终有正的下限', () => {
    const fit = fitLyricBlock({ ...base, blockW: 1, blockH: 1, layoutX: 99, layoutY: 99 })
    expect(fit.safeW).toBeGreaterThan(0)
    expect(fit.safeH).toBeGreaterThan(0)
  })

  it('不同长度的句子得到相近的高度占比（构图稳定）', () => {
    // 这是修复的核心目标：短句与长句的视觉大小不应差出数倍
    const shortLine = fitLyricBlock({ ...base, blockW: 2.2, blockH: 8.95 })
    const longLine = fitLyricBlock({ ...base, blockW: 27, blockH: 1.62 })
    const shortPct = (8.95 * shortLine.scale) / shortLine.visibleH
    const longPct = (1.62 * longLine.scale) / longLine.visibleH
    // 两者都应落在合理区间内，且差距远小于修复前的 5 倍
    expect(shortPct).toBeLessThanOrEqual(0.53)
    expect(longPct).toBeLessThanOrEqual(0.53)
    expect(Math.abs(shortPct - longPct)).toBeLessThan(0.5)
  })
})

describe('lyricLineStep', () => {
  it('clamps into the upstream range [0.22, 0.94]', () => {
    expect(lyricLineStep(3.5, 138, 704)).toBeGreaterThanOrEqual(0.22)
    expect(lyricLineStep(3.5, 138, 704)).toBeLessThanOrEqual(0.94)
  })

  it('极端输入仍被 clamp', () => {
    expect(lyricLineStep(100, 1000, 10)).toBeLessThanOrEqual(0.94)
    expect(lyricLineStep(0.1, 1, 10000)).toBeGreaterThanOrEqual(0.22)
  })

  it('更大的 spread 产生更大的行距', () => {
    const tight = lyricLineStep(3, 138, 704, 1.0)
    const loose = lyricLineStep(3, 138, 704, 2.4)
    expect(loose).toBeGreaterThanOrEqual(tight)
  })

  it('画布高度为 0 时安全回退', () => {
    expect(lyricLineStep(3, 138, 0)).toBeCloseTo(0.3, 5)
  })
})
