import { beforeEach, describe, expect, it } from 'vitest'
import {
  createAudioNormalizerState,
  pushScheduledBeatPulse,
  readScheduledBeatPulse,
  resetScheduledBeatPulse,
  stepAudioNormalize,
} from './audioNormalize'

/**
 * 离线拍点脉冲并入 `beatPulse` 的行为回归。
 *
 * 上游的合并点是 `11-main-loop.js:459-466`：
 *     if (scheduledBeatPulse > beatPulse) beatPulse = scheduledBeatPulse
 *     scheduledBeatPulse *= pow(0.32, audioStepDt)
 * 这段在移植时被放进了 normalizer（`beatPulse` 的持有者），**不是**
 * `beatCamera`。最容易犯的错是把它并进 `beatCam.punch` —— 那样
 * `bass`（beatPulse×0.18）、`audioEnergy`（×0.30）、`beat` 三个出口
 * 全都吃不到离线拍点，画面只会"镜头动了一下"而粒子毫无反应。
 */

const QUIET = {
  lowDrive: 0,
  snap: 0,
  tHigh: 0,
  vocal: 0,
  energy: 0,
  playing: true,
  dt: 1 / 60,
}

function once(over: Partial<typeof QUIET> = {}) {
  return stepAudioNormalize(createAudioNormalizerState(), { ...QUIET, ...over })
}

beforeEach(() => {
  resetScheduledBeatPulse()
})

describe('pushScheduledBeatPulse / readScheduledBeatPulse', () => {
  it('取最大值（上游 `scheduledBeatPulse = Math.max(…)`）', () => {
    pushScheduledBeatPulse(0.3)
    pushScheduledBeatPulse(0.5)
    pushScheduledBeatPulse(0.2)
    expect(readScheduledBeatPulse()).toBe(0.5)
  })

  it('reset 归零', () => {
    pushScheduledBeatPulse(0.7)
    resetScheduledBeatPulse()
    expect(readScheduledBeatPulse()).toBe(0)
  })
})

describe('并入 beatPulse', () => {
  it('离线脉冲抬升 beat，并传导到 bass / audioEnergy / beat 三个出口', () => {
    pushScheduledBeatPulse(0.6)
    const out = once()
    // 实时路径在安静输入下不触发，beatPulse 应取到离线值
    expect(out.beat).toBeGreaterThan(0.5)
    // bass = min(0.9, smoothBass*1.05 + beatPulse*0.18) * 0.85
    //      ⇒ 至少 beatPulse*0.18*0.85 = 0.6*0.153 = 0.0918
    expect(out.bass).toBeGreaterThan(0.6 * 0.18 * 0.85 - 1e-9)
    // audioEnergy = max(smoothEnergy, beatPulse*0.30)
    expect(out.energy).toBeGreaterThanOrEqual(0.6 * 0.3 - 1e-9)
  })

  it('并入用 `>`：相等的脉冲不覆盖实时值', () => {
    // 先让实时路径自己抬一个高脉冲，再并入同样的离线值 ⇒ 结果不下降
    const state = createAudioNormalizerState()
    const hot = stepAudioNormalize(state, {
      lowDrive: 0.9,
      snap: 0.5,
      tHigh: 0.4,
      vocal: 0.2,
      energy: 0.9,
      playing: true,
      dt: 1 / 60,
    })
    const before = hot.beat
    pushScheduledBeatPulse(before)
    const after = stepAudioNormalize(state, QUIET)
    expect(after.beat, '相等时不得被离线值压低').toBeGreaterThanOrEqual(before * 0.99)
  })

  it('并入当帧取原值，下一帧按 pow(0.32, dt) 衰减', () => {
    pushScheduledBeatPulse(1)
    const state = createAudioNormalizerState()
    // 第一帧：实时路径在安静输入下不触发 ⇒ beatPulse 由 0 被抬到 1。
    // 注意 `scheduledBeatPulse *= 0.32^dt` 在合并**之后**执行（上游同序），
    // 所以本帧返回的是**原值** 1，衰减体现在下一帧。
    const first = stepAudioNormalize(state, QUIET)
    expect(first.beat).toBe(1)
    expect(readScheduledBeatPulse()).toBeCloseTo(Math.pow(0.32, 1 / 60), 6)

    // 第二帧：实时仍安静 ⇒ beatPulse = max(1×0.36^dt, 离线残留 0.32^dt)。
    //   **实时那一轮衰减先跑**（`beatPulse *= 0.36^dt` 在前），
    //   于是 0.36^dt > 0.32^dt ⇒ 取实时衰减值。这正是上游的顺序：
    //   离线的 0.32 只作用于它自己的残留量，不会额外压低 beatPulse。
    const second = stepAudioNormalize(state, QUIET)
    expect(second.beat).toBeCloseTo(Math.pow(0.36, 1 / 60), 6)
  })

  it('离线的残留衰减率 0.32 快于实时的 0.36', () => {
    // 直接观测 `scheduledBeatPulse` 自己的衰减，不经过 beatPulse 的 max
    pushScheduledBeatPulse(1)
    stepAudioNormalize(createAudioNormalizerState(), QUIET)
    const residue = readScheduledBeatPulse()
    expect(residue).toBeCloseTo(Math.pow(0.32, 1 / 60), 6)
    expect(residue).toBeLessThan(Math.pow(0.36, 1 / 60))
  })
})

describe('暂停时冻结', () => {
  it('playing=false ⇒ 不并入也不衰减（上游 audioStepDt 恒 0）', () => {
    pushScheduledBeatPulse(0.5)
    const state = createAudioNormalizerState()
    stepAudioNormalize(state, { ...QUIET, playing: false })
    // 残留值必须留着，供恢复播放后第一帧合并
    expect(readScheduledBeatPulse()).toBe(0.5)
    // 且本帧 beatPulse 走的是 idle 的 pow(0.82, idle) 衰减，不吃离线值
    const out = stepAudioNormalize(state, { ...QUIET, playing: false })
    expect(out.beat).toBe(0)
  })

  it('恢复播放后第一帧才合并残留值', () => {
    pushScheduledBeatPulse(0.5)
    const state = createAudioNormalizerState()
    stepAudioNormalize(state, { ...QUIET, playing: false })
    const resumed = stepAudioNormalize(state, QUIET)
    expect(resumed.beat).toBeGreaterThan(0)
    expect(readScheduledBeatPulse()).toBeLessThan(0.5)
  })
})
