import { beforeEach, describe, expect, it } from 'vitest'
import {
  PARTICLE_POINTER_SPIN_X,
  PARTICLE_POINTER_SPIN_Y,
  PARTICLE_SPIN_MAX,
  applyParticleSpinDrag,
  clampParticleSpinVelocity,
  gestureRotationState,
  rebaseParticleRotationAxis,
  rebaseParticleRotationIfNeeded,
  resetGestureRotation,
  tickGestureRotation,
} from './gestureRotationState'

/**
 * 回归保护：这组测试钉住上游 `10-shell/00-gesture-control.js` 的**拖拽语义**。
 *
 * 本项目上一轮把拖拽接到了相机（`userTheta/userPhi` + 松手回正），
 * 违反了上游 `scripts/quick-check.js:3322` 的断言：
 *
 *   !/function applyOrbitPointerDrag/          // 必须"不存在"
 *   !/applyParticleSpinDrag\(dx,\s*dy,\s*spinDt\)/  // 必须是这个
 *   gestureRotation.x += rx                    // 必须存在
 *
 * 也就是说：拖拽转的是**物体**，相机不动。这组测试把那层契约钉死。
 */
describe('手势旋转层（拖拽转物体，不转相机）', () => {
  beforeEach(() => {
    gestureRotationState.x = 0
    gestureRotationState.y = 0
    gestureRotationState.spinVx = 0
    gestureRotationState.spinVy = 0
  })

  it('常量取自上游（X=0.0032 / Y=0.0034 / max=6.2）', () => {
    // 上游把 X/Y 写成了不同的值，且 X 是 0.0032（不是 0.0034）
    expect(PARTICLE_POINTER_SPIN_X).toBe(0.0032)
    expect(PARTICLE_POINTER_SPIN_Y).toBe(0.0034)
    expect(PARTICLE_SPIN_MAX).toBe(6.2)
  })

  it('拖拽增量交叉驱动：dy→x，dx→y（上游就是交叉的）', () => {
    applyParticleSpinDrag(0, 100, 1 / 60)
    expect(gestureRotationState.x).toBeCloseTo(100 * PARTICLE_POINTER_SPIN_X, 6)
    expect(gestureRotationState.y).toBeCloseTo(0, 6)

    resetGestureRotation()
    applyParticleSpinDrag(100, 0, 1 / 60)
    expect(gestureRotationState.x).toBeCloseTo(0, 6)
    expect(gestureRotationState.y).toBeCloseTo(100 * PARTICLE_POINTER_SPIN_Y, 6)
  })

  it('拖拽会按 rx/dt*0.46 生成角速度，用于松手后的惯性', () => {
    applyParticleSpinDrag(0, 60, 0.1)
    // rx = 60*0.0032 = 0.192; v = 0.192/0.1*0.46 = 0.8832
    expect(gestureRotationState.spinVx).toBeCloseTo((60 * PARTICLE_POINTER_SPIN_X * 0.46) / 0.1, 6)
  })

  it('dt<=0 时不写角速度（避免除零）', () => {
    applyParticleSpinDrag(50, 50, 0)
    expect(gestureRotationState.spinVx).toBe(0)
    expect(gestureRotationState.spinVy).toBe(0)
    // 但旋转角仍然累加
    expect(gestureRotationState.x).toBeCloseTo(50 * PARTICLE_POINTER_SPIN_X, 6)
  })

  it('角速度被夹在 ±PARTICLE_SPIN_MAX', () => {
    expect(clampParticleSpinVelocity(999)).toBe(PARTICLE_SPIN_MAX)
    expect(clampParticleSpinVelocity(-999)).toBe(-PARTICLE_SPIN_MAX)
    expect(clampParticleSpinVelocity(NaN)).toBe(0)
    expect(clampParticleSpinVelocity(Infinity)).toBe(0)
  })

  it('松手后靠惯性继续滑行并逐渐衰减到 0', () => {
    applyParticleSpinDrag(0, 120, 0.1)
    const v0 = gestureRotationState.spinVx
    expect(Math.abs(v0)).toBeGreaterThan(0)

    tickGestureRotation(1 / 60)
    const xAfterFirst = gestureRotationState.x
    expect(xAfterFirst).toBeGreaterThan(0) // 仍在推进
    expect(Math.abs(gestureRotationState.spinVx)).toBeLessThan(Math.abs(v0)) // 在衰减

    // 持续推进足够多帧后应当停下
    for (let i = 0; i < 600; i++) tickGestureRotation(1 / 60)
    expect(gestureRotationState.spinVx).toBe(0)
    expect(gestureRotationState.spinVy).toBe(0)
  })

  it('衰减与帧率无关：一大步 ≈ 若干小步的总和（pow(damping, dt*60)）', () => {
    gestureRotationState.spinVx = 4
    tickGestureRotation(1 / 30)
    const bigStep = gestureRotationState.spinVx

    gestureRotationState.spinVx = 4
    tickGestureRotation(1 / 60)
    tickGestureRotation(1 / 60)
    const twoSmallSteps = gestureRotationState.spinVx

    expect(bigStep).toBeCloseTo(twoSmallSteps, 6)
  })

  it('拖拽不会自动回正：旋转角保留，直到显式 reset', () => {
    applyParticleSpinDrag(0, 100, 1 / 60)
    for (let i = 0; i < 300; i++) tickGestureRotation(1 / 60)
    // 惯性停了，但角度**没有归零**（上游只在 |rot|>10π 时 rebase）
    expect(Math.abs(gestureRotationState.x)).toBeGreaterThan(0)

    resetGestureRotation()
    expect(gestureRotationState.x).toBe(0)
    expect(gestureRotationState.y).toBe(0)
  })

  it('rebase 只在超过 10π 时把累计角折回等价区间', () => {
    gestureRotationState.y = Math.PI * 4 // 未超阈值
    rebaseParticleRotationAxis('y')
    expect(gestureRotationState.y).toBeCloseTo(Math.PI * 4, 6)

    gestureRotationState.y = Math.PI * 12 // 超阈值，折回
    rebaseParticleRotationAxis('y')
    expect(Math.abs(gestureRotationState.y)).toBeLessThan(Math.PI * 10)
    // 折回量是 2π 的整数倍，因此朝向等价
    expect(Math.cos(gestureRotationState.y)).toBeCloseTo(Math.cos(0), 5)
  })

  it('rebase 会把同一偏移量减到所有消费层，避免物体跳变', () => {
    const a = { rotation: { x: Math.PI * 12, y: 0 } }
    const b = { rotation: { x: Math.PI * 12, y: 0 } }
    gestureRotationState.x = Math.PI * 12
    rebaseParticleRotationAxis('x', [a, b])
    // 三层减去的是同一个偏移，相对关系保持不变
    expect(a.rotation.x - gestureRotationState.x).toBeCloseTo(0, 6)
    expect(b.rotation.x - a.rotation.x).toBeCloseTo(0, 6)
  })

  it('两个轴都会被 rebase', () => {
    gestureRotationState.x = Math.PI * 12
    gestureRotationState.y = -Math.PI * 12
    rebaseParticleRotationIfNeeded()
    expect(Math.abs(gestureRotationState.x)).toBeLessThan(Math.PI * 10)
    expect(Math.abs(gestureRotationState.y)).toBeLessThan(Math.PI * 10)
  })
})
