import { describe, expect, it } from 'vitest'
import { beatTimesOf, downbeatTimesOf, resolveBeatAccents } from './beatAccents'
import { mergeBeatFxEvents, stepBeatFxClock, createBeatFxClockState } from './clock'
import type { BeatMap, BeatMapEvent } from './offlineBeatAnalysis'

/** 造一张可控的拍点图：每 0.5 秒一拍，四拍一小节。 */
const makeMap = (count: number, tweak: (index: number) => Partial<BeatMapEvent> = () => ({})): BeatMap => {
  const cameraBeats: BeatMapEvent[] = Array.from({ length: count }, (_, index) => ({
    time: index * 0.5,
    strength: 0.5,
    confidence: 0.8,
    impact: index % 4 === 0 ? 0.9 : 0.4,
    low: index % 4 === 0 ? 0.7 : 0.2,
    body: 0.2,
    snap: 0.1,
    pulse: true,
    combo: (['downbeat', 'push', 'drop', 'rebound'] as const)[index % 4],
    ...tweak(index),
  }))
  return {
    kicks: [],
    beats: [],
    pulseBeats: [],
    cameraBeats,
    gridStep: 0.5,
    tempoSource: 'music-tempo',
    analysisProfile: 'default',
    duration: count * 0.5,
    visualBeatCount: count,
    analyzedAt: 0,
  }
}

describe('拍点重音换算', () => {
  it('每个网格拍一条，三段占比归一', () => {
    const accents = resolveBeatAccents(makeMap(8))
    expect(accents).toBeDefined()
    expect(accents!.impact).toHaveLength(8)
    accents!.low.forEach((value, index) => {
      expect(value + accents!.mid[index] + accents!.high[index]).toBeCloseTo(1, 6)
    })
  })

  it('pulse 为 false 的拍标记为无节奏', () => {
    const accents = resolveBeatAccents(makeMap(8, (index) => (index === 3 ? { pulse: false } : {})))
    expect(accents!.rhythmic[3]).toBe(0)
    expect(accents!.pulse[3]).toBe(0)
    expect(accents!.rhythmic[2]).toBe(1)
  })

  it('不伪造重音：impact 留空，动感系数恒为 1', () => {
    // 本仓没有 beat_this 的逐拍重音，`offlineBeatAnalysis` 的 impact 是运镜合成强度
    // （中位数 0.4 左右），拿来当重音会把每一拍都判成弱拍、效果整体减弱一半。
    const accents = resolveBeatAccents(makeMap(16))
    expect(accents!.impact.every((value) => Number.isNaN(value))).toBe(true)
    expect(accents!.trackScale).toBe(1)
  })

  it('拍点太少时不给重音（与上游一致：退回无重音）', () => {
    expect(resolveBeatAccents(makeMap(1))).toBeUndefined()
  })

  it('重拍时间取四循环的第 0 拍', () => {
    const map = makeMap(8)
    expect(downbeatTimesOf(map)).toEqual([0, 2])
    expect(beatTimesOf(map)[1]).toBeCloseTo(0.5, 6)
  })
})

describe('时钟读取重音', () => {
  it('无重音时每一拍的包络峰值相同', () => {
    const map = makeMap(8)
    const events = mergeBeatFxEvents(beatTimesOf(map), downbeatTimesOf(map), resolveBeatAccents(map))
    const state = createBeatFxClockState(events, 1)
    stepBeatFxClock(state, 1.99, 0)
    expect(state.firedBeats).toBe(0)
    // 每拍都在「刚跨过」的那一帧读数，晚到量相同，因此峰值应完全一致。
    stepBeatFxClock(state, 2.0, 0.01)
    const first = state.beatImpact
    stepBeatFxClock(state, 2.49, 0.01)
    stepBeatFxClock(state, 2.5, 0.01)
    expect(state.beatImpact).toBeCloseTo(first, 6)
  })

  it('无重音时包络峰值为动感系数本身', () => {
    const map = makeMap(8)
    const events = mergeBeatFxEvents(beatTimesOf(map), downbeatTimesOf(map))
    const state = createBeatFxClockState(events, 1)
    stepBeatFxClock(state, 1.9, 0)
    // 晚到 20ms 时按 160ms 的半衰曲线衰减到 exp(-0.2875) ≈ 0.75，峰值仍是 1。
    stepBeatFxClock(state, 2.02, 0.02)
    expect(state.beatImpact).toBeCloseTo(Math.exp(-0.02 / 0.16 * 2.3), 5)
  })

  it('拖动进度只重新对齐，不补发一串拍', () => {
    const map = makeMap(20)
    const events = mergeBeatFxEvents(beatTimesOf(map), downbeatTimesOf(map), resolveBeatAccents(map))
    const state = createBeatFxClockState(events, 1)
    stepBeatFxClock(state, 0, 0)
    // 跳到 8s：游标落到第一个严格晚于 8s 的拍（8.0 那一拍本身不补发）。
    stepBeatFxClock(state, 8, 0.016)
    expect(state.firedBeats).toBe(0)
    expect(state.cursor).toBe(17)
    expect(state.events[state.cursor].t).toBeCloseTo(8.5, 6)
  })
})
