import { describe, expect, it } from 'vitest'
import { SONIC_BAND_EDGES } from './AudioAnalyser'

/**
 * 回归保护：八频段定义必须与上游 Mineradio 一致。
 *
 * 上游出处：`03-beat/06-sonic-audio-monitor.js:43-52` 的
 * `SONIC_AUDIO_BAND_EDGES`。声波地形的着色器按这些边界区分
 * subBass / bass / lowMid / mid / highMid / presence / brilliance / air，
 * 一旦边界漂移，地形的形态就会整体错位（而且不会报错，只会"感觉不对"）。
 */
describe('Mineradio 八频段定义', () => {
  it('频段 ID 与上游顺序一致', () => {
    expect(SONIC_BAND_EDGES.map(([id]) => id)).toEqual([
      'subBass',
      'bass',
      'lowMid',
      'mid',
      'highMid',
      'presence',
      'brilliance',
      'air',
    ])
  })

  it('Hz 边界逐项等于上游原值', () => {
    const expected: Record<string, [number, number]> = {
      subBass: [32, 58],
      bass: [58, 118],
      lowMid: [118, 260],
      mid: [260, 720],
      highMid: [720, 1800],
      presence: [1800, 4200],
      brilliance: [4200, 9000],
      air: [9000, 16000],
    }
    for (const [id, lo, hi] of SONIC_BAND_EDGES) {
      expect([lo, hi]).toEqual(expected[id])
    }
  })

  it('频段连续且单调递增（相邻频段首尾相接，无空洞）', () => {
    for (let i = 1; i < SONIC_BAND_EDGES.length; i++) {
      const previousHi = SONIC_BAND_EDGES[i - 1][2]
      const currentLo = SONIC_BAND_EDGES[i][1]
      expect(currentLo).toBe(previousHi)
    }
  })

  it('每个频段的下界严格小于上界', () => {
    for (const [, lo, hi] of SONIC_BAND_EDGES) {
      expect(lo).toBeLessThan(hi)
    }
  })
})
