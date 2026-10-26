import { describe, expect, it } from 'vitest'
import {
  cinemaAnalysisProfileForSong,
  estimateTempoPhaseOffset,
  medianGap,
  normalizeMusicTempoBeats,
} from './beatTempoGrid'
import type { BeatMapEvent } from './beatAnalysisTypes'

/**
 * `beatTempoGrid` 的数值回归。
 *
 * 这里全是纯函数，因此可以**逐个钉住上游的算式**。移植这段最怕两类退化：
 *   ① 中位数被"顺手改对"成算术中位（上游刻意取偏上中位）；
 *   ② 相位校正的投票逻辑被简化成"取平均"，丢掉 26% 一致性门槛与
 *      `±maxOffset` 钳制 —— 那样网格会被单个离群候选拖到隔壁拍上去。
 */

describe('medianGap', () => {
  it('偶数长度取偏上中位（上游 floor(len*0.5)，不是算术中位）', () => {
    // 4 个 gap：[0.10, 0.20, 0.30, 0.40] → floor(4*0.5)=2 → 0.30
    // 算术中位是 0.25，这里必须钉住 0.30
    expect(medianGap([0, 0.1, 0.3, 0.6, 1.0], 0.05, 0.5)).toBeCloseTo(0.3, 10)
  })

  it('区间外的 gap 不参与统计', () => {
    // 0.9 超出 maxGap=0.5；0.05 低于 minGap=0.1
    const g = medianGap([0, 0.05, 0.35, 0.55, 1.45], 0.1, 0.5)
    // 只留下 0.30（0.35-0.05）与 0.20（0.55-0.35）→ 2 个 → floor(2*0.5)=1 → 0.30
    expect(g).toBeCloseTo(0.3, 10)
  })

  it('少于两个点返回 0', () => {
    expect(medianGap([1], 0.1, 0.5)).toBe(0)
    expect(medianGap(null, 0.1, 0.5)).toBe(0)
    expect(medianGap(undefined, 0.1, 0.5)).toBe(0)
  })

  it('全区间外返回 0', () => {
    expect(medianGap([0, 5, 10], 0.1, 0.5)).toBe(0)
  })
})

describe('normalizeMusicTempoBeats', () => {
  it('丢首尾 50ms 内与非有限值', () => {
    const out = normalizeMusicTempoBeats([0.01, 0.2, 0.6, 1.0, Number.NaN, 9.99], 10)
    expect(out).not.toContain(0.01)
    expect(out).not.toContain(9.99)
    expect(out.every((t) => Number.isFinite(t))).toBe(true)
    expect(out).toContain(0.2)
  })

  it('稀疏序列（主拍密度）不抽稀，只排序', () => {
    const raw = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
    expect(normalizeMusicTempoBeats(raw, 10)).toEqual([0.5, 1.0, 1.5, 2.0, 2.5, 3.0])
  })

  it('过密序列（半拍）按 minMainGap 抽稀', () => {
    // 每 0.20s 一个点（300 BPM 级别的过密输出）→ 中位 gap 0.20 < 0.42
    //   minMainGap = min(0.44, 0.20*1.65) = 0.33
    // 从 0.20 起：0.20 ✓ / 0.40 ✓ / 0.73? 0.40+0.33=0.73 → 0.80 ✓ / 1.20? 0.80+0.33=1.13 → 1.40 ✓
    const raw: number[] = []
    for (let i = 0; i < 20; i++) raw.push(0.2 + i * 0.2)
    const out = normalizeMusicTempoBeats(raw, 100)
    for (let i = 1; i < out.length; i++) {
      expect(out[i] - out[i - 1], `第 ${i} 段间隔不得小于 minMainGap`).toBeGreaterThanOrEqual(0.33 - 1e-9)
    }
    // 抽稀必须真的发生（不是原样返回）
    expect(out.length).toBeLessThan(raw.length)
  })

  it('少于 4 个点直接返回（上游 early return）', () => {
    expect(normalizeMusicTempoBeats([0.2, 0.25, 0.3], 10)).toEqual([0.2, 0.25, 0.3])
  })

  it('空输入返回空数组', () => {
    expect(normalizeMusicTempoBeats([], 10)).toEqual([])
    expect(normalizeMusicTempoBeats(null)).toEqual([])
  })
})

describe('estimateTempoPhaseOffset', () => {
  /** 造一条规则网格：step 秒一个拍点。 */
  function grid(start: number, step: number, count: number): number[] {
    const out: number[] = []
    for (let i = 0; i < count; i++) out.push(start + i * step)
    return out
  }

  /** 造一批候选，全部相对网格有同样的 offset。 */
  function candidates(gridTimes: number[], offset: number, count: number): BeatMapEvent[] {
    return gridTimes.slice(0, count).map((t, i) => ({
      time: t + offset,
      strength: 0.8,
      confidence: 0.9,
      impact: 0.7,
      low: 0.5,
      primary: true,
      camera: true,
      mass: 0.6,
      index: i,
    }))
  }

  it('一致的正偏移应当被校正出来', () => {
    const g = grid(1.0, 0.5, 20)
    const c = candidates(g, 0.1, 12)
    const off = estimateTempoPhaseOffset(g, c, 0.5, 60)
    // 0.1 落进同一桶（bin=4），应被还原到 0.1 附近
    expect(off).toBeGreaterThan(0.05)
    expect(off).toBeLessThan(0.15)
  })

  it('一致的负偏移同样被还原（符号不能丢）', () => {
    const g = grid(1.0, 0.5, 20)
    const c = candidates(g, -0.1, 12)
    const off = estimateTempoPhaseOffset(g, c, 0.5, 60)
    expect(off).toBeLessThan(-0.05)
    expect(off).toBeGreaterThan(-0.15)
  })

  it('|offset| < 0.045 视为已对准，返回 0（上游 :86-88）', () => {
    const g = grid(1.0, 0.5, 20)
    const c = candidates(g, 0.02, 12)
    expect(estimateTempoPhaseOffset(g, c, 0.5, 60)).toBe(0)
  })

  it('偏移被钳到 ±maxOffset = clamp(step*0.58, 0.12, 0.26)', () => {
    const g = grid(1.0, 0.5, 20)
    // step 0.5 → maxOffset = min(0.26, max(0.12, 0.29)) = 0.26
    const c = candidates(g, 5.0, 12) // 荒谬的大偏移
    const off = estimateTempoPhaseOffset(g, c, 0.5, 60)
    expect(Math.abs(off)).toBeLessThanOrEqual(0.26 + 1e-9)
    // 大偏移的候选会被 `|offset| > maxOffset` 这一行全部滤掉 ⇒ 无样本 ⇒ 0
    expect(off).toBe(0)
  })

  it('step 很小时 maxOffset 至少为 0.12（下限）', () => {
    const g = grid(1.0, 0.3, 20)
    const c = candidates(g, 0.13, 12)
    // step 0.3 → 0.3*0.58=0.174 → maxOffset=0.174；0.13 < 0.174 不被滤
    const off = estimateTempoPhaseOffset(g, c, 0.3, 60)
    expect(Math.abs(off)).toBeLessThanOrEqual(0.174 + 1e-9)
  })

  it('相位分散到互不相邻的桶 ⇒ 26% 一致性门槛拦下，返回 0', () => {
    const g = grid(1.0, 0.5, 20)
    // 4 个候选，偏移分别落在 bin 1/4/7/10 —— **间隔 3 个桶**，因此任一桶的
    // 「自身 + 左右邻桶 72% 溢出」都只含自己那一个样本：
    //   bestWeight = w, totalWeight = 4w ⇒ 0.25 < 0.26 ⇒ 判定无一致相位。
    // ★ 这正是 26% 这个数的意义：它要求"约四分之一以上的权重聚在一起"。
    //   若把候选**均匀**摊在 ±maxOffset 内（10 个桶），最优桶连同邻桶约拿
    //   3/10 = 30%，是**过得去**的 —— 上游并不认为那是噪声。
    const c: BeatMapEvent[] = [0.03, 0.105, 0.18, 0.255].map((off, i) => ({
      time: g[i] + off,
      strength: 0.8,
      confidence: 0.9,
      impact: 0.7,
      low: 0.5,
      primary: true,
      camera: true,
      index: i,
    }))
    expect(estimateTempoPhaseOffset(g, c, 0.5, 60)).toBe(0)
  })

  it('两个各占一半的簇能过 26% 门槛（上游语义，非 bug）', () => {
    const g = grid(1.0, 0.5, 20)
    const c: BeatMapEvent[] = g.slice(0, 12).map((t, i) => ({
      time: t + (i % 2 === 0 ? 0.05 : 0.2),
      strength: 0.8,
      confidence: 0.9,
      impact: 0.7,
      low: 0.5,
      primary: true,
      camera: true,
      index: i,
    }))
    // 两簇各 50% 权重，最优桶过 26% ⇒ 取较近的那一簇（0.05）
    const off = estimateTempoPhaseOffset(g, c, 0.5, 60)
    expect(off).toBeGreaterThan(0.03)
    expect(off).toBeLessThan(0.09)
  })

  it('输入不足（网格 <8 / 候选 <4）直接返回 0', () => {
    const g = grid(1.0, 0.5, 4)
    const c = candidates(g, 0.1, 12)
    expect(estimateTempoPhaseOffset(g, c, 0.5, 60), '网格点不足 8 个').toBe(0)
    expect(estimateTempoPhaseOffset(grid(1.0, 0.5, 20), c.slice(0, 2), 0.5, 60), '候选不足 4 个').toBe(0)
    expect(estimateTempoPhaseOffset(grid(1.0, 0.5, 20), c, 0, 60), 'step 为 0').toBe(0)
  })

  it('前 1.0s 与末 0.5s 内的候选不参与投票（上游 :102）', () => {
    const g = grid(1.0, 0.5, 20)
    const early: BeatMapEvent[] = Array.from({ length: 12 }, (_, i) => ({
      time: 0.3 + i * 0.05, // 全部落在 <1.0s
      strength: 0.9,
      confidence: 0.9,
      impact: 0.8,
      low: 0.6,
      primary: true,
      camera: true,
      index: i,
    }))
    expect(estimateTempoPhaseOffset(g, early, 0.5, 60)).toBe(0)
  })
})

describe('cinemaAnalysisProfileForSong', () => {
  it('《日落大道》返回 softGroove 剖面（原样移植上游的判断）', () => {
    const p = cinemaAnalysisProfileForSong({ name: '日落大道' })
    expect(p.id).toBe('sunset-boulevard-soft-groove')
    expect(p.softGroove).toBe(true)
    expect(p.phaseScan).toBe(true)
    expect(p.localRefine).toBe(true)
    expect(p.sparseCamera).toBe(true)
    expect(p.introPattern).toBe(true)
  })

  it('英文名与歌手名同样命中', () => {
    expect(cinemaAnalysisProfileForSong({ title: 'Sunset Boulevard' }).softGroove).toBe(true)
    expect(cinemaAnalysisProfileForSong({ artist: 'Sunset Boulevard' }).softGroove).toBe(true)
  })

  it('其余歌曲返回 default（四个布尔全 false）', () => {
    const p = cinemaAnalysisProfileForSong({ name: '普通摇滚', artist: '某人' })
    expect(p.id).toBe('default')
    expect(p.softGroove).toBe(false)
    expect(p.phaseScan).toBe(false)
    expect(p.localRefine).toBe(false)
    expect(p.sparseCamera).toBe(false)
    expect(p.introPattern).toBe(false)
  })

  it('空/缺失输入安全', () => {
    expect(cinemaAnalysisProfileForSong(null).id).toBe('default')
    expect(cinemaAnalysisProfileForSong(undefined).id).toBe('default')
    expect(cinemaAnalysisProfileForSong({}).id).toBe('default')
  })
})
