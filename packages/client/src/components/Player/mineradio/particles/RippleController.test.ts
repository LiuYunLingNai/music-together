import { describe, expect, it } from 'vitest'
import { BASS_THRESHOLD, RIPPLE_COOLDOWN, RIPPLE_LIFETIME, RIPPLE_MAX, RippleController } from './RippleController'

/** 以固定步长推进控制器（恒定 bass 电平），返回每帧的活跃数。 */
function step(controller: RippleController, seconds: number, bass: number, stepSeconds = 1 / 60) {
  const counts: number[] = []
  for (let t = 0; t < seconds; t += stepSeconds) {
    counts.push(controller.update(stepSeconds, bass))
  }
  return counts
}

describe('RippleController（上游 15-ripples-cover-depth.js 语义）', () => {
  it('常量与上游一致：12 槽 / 0.30 阈值 / 0.32s 冷却 / 2.0s 寿命', () => {
    expect(RIPPLE_MAX).toBe(12)
    expect(BASS_THRESHOLD).toBe(0.3)
    expect(RIPPLE_COOLDOWN).toBe(0.32)
    expect(RIPPLE_LIFETIME).toBe(2.0)
  })

  it('初始没有活跃涟漪', () => {
    const controller = new RippleController()
    expect(controller.update(1 / 60, 0)).toBe(0)
  })

  it('bass 超阈值触发一次 2~3 道的涟漪爆发', () => {
    const controller = new RippleController()
    const active = controller.update(1 / 60, 0.6)
    expect(active).toBeGreaterThanOrEqual(2)
    expect(active).toBeLessThanOrEqual(3)
  })

  it('持续高电平只在回落沿触发 —— 一拍不会连发多轮', () => {
    const controller = new RippleController()
    // 持续 0.32s 的高电平：第一帧触发后 bassRising=true，随后不再触发
    const counts = step(controller, RIPPLE_COOLDOWN, 0.6)
    expect(counts[0]).toBeGreaterThanOrEqual(2)
    expect(counts[counts.length - 1]).toBe(counts[0]) // 无新增
  })

  it('回落到阈值 75% 以下后重新武装，冷却后再触发', () => {
    const controller = new RippleController()
    controller.update(1 / 60, 0.6) // 第一轮
    step(controller, RIPPLE_COOLDOWN + 0.05, 0.1) // 回落（重新武装）
    const before = controller.update(1 / 60, 0.6)
    expect(before).toBeGreaterThanOrEqual(2) // 第二轮触发
  })

  it('bass 低于阈值永不触发', () => {
    const controller = new RippleController()
    const counts = step(controller, 1.0, 0.2)
    expect(counts.every((c) => c === 0)).toBe(true)
  })

  it('涟漪在生命周期结束后消失', () => {
    const controller = new RippleController()
    controller.update(1 / 60, 0.6)
    const counts = step(controller, RIPPLE_LIFETIME + 0.2, 0)
    expect(counts[counts.length - 1]).toBe(0)
  })

  it('冷却时间内不会重复触发', () => {
    const controller = new RippleController()
    const first = controller.update(1 / 60, 0.6)
    // 回落重新武装后，冷却期内持续超阈值：旧涟漪仍在寿命内（2s），
    // 活跃数应保持不变 —— 即没有新增
    step(controller, 0.05, 0.1)
    const counts = step(controller, RIPPLE_COOLDOWN * 0.8, 0.6)
    expect(counts.every((c) => c === first)).toBe(true)
  })

  it('活跃数不会超过上限', () => {
    const controller = new RippleController()
    let maxActive = 0
    // 交替高/低电平制造多次触发
    for (let t = 0; t < RIPPLE_LIFETIME * 3; t += RIPPLE_COOLDOWN) {
      maxActive = Math.max(maxActive, controller.update(RIPPLE_COOLDOWN, 0.6))
      maxActive = Math.max(maxActive, controller.update(0.02, 0.1))
    }
    expect(maxActive).toBeLessThanOrEqual(RIPPLE_MAX)
  })

  it('环形复用不会越界', () => {
    const controller = new RippleController()
    for (let i = 0; i < RIPPLE_MAX * 5; i++) {
      controller.trigger()
    }
    expect(controller.ripples).toHaveLength(RIPPLE_MAX)
    // 4 分量 (x, y, age, str) —— str 走 w 通道（上游 DataTexture RGBA 语义）
    expect(controller.data).toHaveLength(RIPPLE_MAX * 4)
  })

  it('uniform 数组前 N 个槽是活跃涟漪（压缩写入），N 之后为 0', () => {
    const controller = new RippleController()
    const active = controller.update(1 / 60, 0.6)
    const value = controller.toUniformValue()
    expect(value).toHaveLength(RIPPLE_MAX)
    // 前 active 个是刚触发的，age 接近 0
    for (let i = 0; i < active; i++) {
      expect(value[i].z).toBeLessThan(0.1)
    }
    // 其余槽清零（由 uRippleCount 截断）
    for (let i = active; i < RIPPLE_MAX; i++) {
      expect(value[i].z).toBe(0)
    }
  })

  it('触发位置落在 3×3 区域网格附近（上游 regions 语义）', () => {
    const controller = new RippleController()
    controller.update(1 / 60, 0.6)
    const span = 4.8 * 0.72
    for (const r of controller.ripples) {
      if (r.str <= 0.005) continue
      // 区域网格 ±0.7 抖动，最远不超过 span/2 + 0.7
      expect(Math.abs(r.x)).toBeLessThanOrEqual(span / 2 + 0.7 + 1e-6)
      expect(Math.abs(r.y)).toBeLessThanOrEqual(span / 2 + 0.7 + 1e-6)
    }
  })

  it('age 单调递增直到结束', () => {
    const controller = new RippleController()
    controller.trigger(0.5, 0.5, 1)
    let prev = -1
    for (let i = 0; i < 30; i++) {
      controller.update(1 / 60, 0)
      const age = controller.ripples[0].age
      expect(age).toBeGreaterThanOrEqual(prev)
      prev = age
    }
  })

  it('reset 清空全部涟漪', () => {
    const controller = new RippleController()
    controller.update(1 / 60, 0.6)
    controller.reset()
    expect(controller.update(1 / 60, 0)).toBe(0)
  })

  it('自定义中心点被保留（预设切换入口）', () => {
    const controller = new RippleController()
    controller.trigger(0.25, 0.75, 1)
    expect(controller.ripples[0].x).toBeCloseTo(0.25, 5)
    expect(controller.ripples[0].y).toBeCloseTo(0.75, 5)
    expect(controller.ripples[0].str).toBe(1)
  })
})
