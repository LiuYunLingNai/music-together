import { describe, expect, it } from 'vitest'
import {
  BEAT_MAP_LOOKAHEAD,
  beatEventTime,
  beatMapCameraEvents,
  beatMapPulseEvents,
  cinemaProfileFromBeatMap,
  convergeCinemaScale,
  createBeatMapCursor,
  scheduledBeatPulseAmount,
  syncBeatMapCursor,
  tickBeatMap,
  type RealtimeLockState,
} from './beatMapRuntime'
import type { BeatMap, BeatMapEvent, PulseBeat } from './beatAnalysisTypes'

/**
 * `beatMapRuntime` 的行为回归 —— 整个离线分析唯一**直接改变观感**的部分。
 *
 * 钉三件事：
 *   ① lookahead 的方向：运镜事件必须在自己时刻**之前 75ms** 就出队，
 *      而脉冲在**当刻**出队。这两条判据写反（都提前或都不提前）是
 *      最容易犯的错，且画面症状是"冲击和鼓点对不上"而非崩溃。
 *   ② 让位仲裁：实时引擎新鲜时离线不触发，但**光标仍要推进**。
 *      上游把 `idx++` 放在 if 外面，就是为了避免让位结束后
 *      一口气补触发几十个历史拍点。
 *   ③ `scheduledBeatPulse` 的两道门槛与上限。
 */

const FRESH: RealtimeLockState = { lastHitAt: 100, tempoGap: 0.5 }
const STALE: RealtimeLockState = { lastHitAt: -10, tempoGap: 0 }

function makeMap(over: Partial<BeatMap> = {}): BeatMap {
  return {
    kicks: [],
    beats: [],
    pulseBeats: [],
    cameraBeats: [],
    gridStep: 0.5,
    tempoSource: 'local',
    analysisProfile: 'default',
    duration: 10,
    visualBeatCount: 0,
    analyzedAt: 0,
    ...over,
  }
}

function cam(time: number, over: Partial<BeatMapEvent> = {}): BeatMapEvent {
  return { time, strength: 0.8, confidence: 0.9, impact: 0.7, low: 0.5, index: 0, ...over }
}

function pulse(time: number, over: Partial<PulseBeat> = {}): PulseBeat {
  return { time, strength: 0.8, impact: 0.7, low: 0.4, ...over }
}

describe('常量与事件取用', () => {
  it('lookahead 必须是 0.075（上游 beatCam.lookahead）', () => {
    expect(BEAT_MAP_LOOKAHEAD).toBe(0.075)
  })

  it('beatEventTime 兼容裸数字与对象', () => {
    expect(beatEventTime(1.5)).toBe(1.5)
    expect(beatEventTime({ time: 2.5 })).toBe(2.5)
  })

  it('字段回退只在字段缺失时发生（空数组是 truthy，上游同样如此）', () => {
    // ★ 上游是 `cameraBeats || beats || kicks || []`，空数组 truthy ⇒
    //   `cameraBeats: []` 会**短路**返回空数组，不会回退到 beats。
    //   这是上游原样行为（分析只在有内容时才写 cameraBeats），照抄。
    expect(beatMapCameraEvents(makeMap({ cameraBeats: [cam(1)] }))).toHaveLength(1)
    expect(beatMapCameraEvents(makeMap({ cameraBeats: undefined as never, beats: [cam(1)] }))).toHaveLength(1)
    expect(beatMapPulseEvents(makeMap({ pulseBeats: [pulse(1)] }))).toHaveLength(1)
  })
})

describe('tickBeatMap · lookahead 方向', () => {
  it('运镜事件在拍点前 75ms 出队；脉冲在当刻出队', () => {
    const map = makeMap({ cameraBeats: [cam(1.0)], pulseBeats: [pulse(1.0)] })

    // t = 0.90：距拍点还有 100ms > 75ms ⇒ 都还没出队
    let r = tickBeatMap(createBeatMapCursor(), map, 0.9, true, STALE)
    expect(r.cameraBeats).toHaveLength(0)
    expect(r.pulseBeats).toHaveLength(0)

    // t = 0.93：距拍点 70ms < 75ms ⇒ 运镜**提前**出队，脉冲仍未出
    const c1 = createBeatMapCursor()
    r = tickBeatMap(c1, map, 0.93, true, STALE)
    expect(r.cameraBeats, '运镜必须在拍点前 75ms 就位').toHaveLength(1)
    expect(r.pulseBeats, '脉冲不得提前（否则冲击早于鼓点）').toHaveLength(0)

    // t = 1.00：脉冲此刻出队
    const c2 = createBeatMapCursor()
    tickBeatMap(c2, map, 0.93, true, STALE)
    r = tickBeatMap(c2, map, 1.0, true, STALE)
    expect(r.cameraBeats, '同一拍不得重复出队').toHaveLength(0)
    expect(r.pulseBeats).toHaveLength(1)
  })

  it('一次 tick 跨多个拍点时全部出队', () => {
    const map = makeMap({
      cameraBeats: [cam(1.0), cam(1.5), cam(2.0)],
      pulseBeats: [pulse(1.0), pulse(1.5), pulse(2.0)],
    })
    const c = createBeatMapCursor()
    const r = tickBeatMap(c, map, 2.0, true, STALE)
    expect(r.cameraBeats).toHaveLength(3)
    expect(r.pulseBeats).toHaveLength(3)
    expect(c.camera).toBe(3)
    expect(c.pulse).toBe(3)
  })

  it('未播放 ⇒ 空结果且光标不动', () => {
    const map = makeMap({ cameraBeats: [cam(1)], pulseBeats: [pulse(1)] })
    const c = createBeatMapCursor()
    const r = tickBeatMap(c, map, 5, false, STALE)
    expect(r.cameraBeats).toHaveLength(0)
    expect(r.pulseBeats).toHaveLength(0)
    expect(c.camera).toBe(0)
    expect(c.pulse).toBe(0)
  })

  it('无拍点图 ⇒ 空结果', () => {
    const r = tickBeatMap(createBeatMapCursor(), null, 1, true, STALE)
    expect(r.cameraBeats).toHaveLength(0)
    expect(r.pulseBeats).toHaveLength(0)
  })
})

describe('tickBeatMap · 与实时引擎的仲裁', () => {
  it('实时新鲜（未锁定）⇒ 不触发，但光标仍推进', () => {
    const map = makeMap({ tempoSource: 'local', cameraBeats: [cam(1), cam(2), cam(3)], pulseBeats: [pulse(1)] })
    const c = createBeatMapCursor()
    // FRESH.lastHitAt=100，t=100.5，tempoGap=0.5 ⇒ freshWindow=0.59 ⇒ 仍新鲜
    const r = tickBeatMap(c, map, 100.5, true, FRESH)
    expect(r.cameraBeats, '实时锁定时离线让位').toHaveLength(0)
    expect(r.pulseBeats).toHaveLength(0)
    expect(c.camera, '★ 光标必须推进（上游 idx++ 在 if 外）').toBeGreaterThan(0)
  })

  it('实时过期 ⇒ 离线接管', () => {
    const map = makeMap({ cameraBeats: [cam(1)], pulseBeats: [pulse(1)] })
    const c = createBeatMapCursor()
    const r = tickBeatMap(c, map, 1.0, true, STALE)
    expect(r.cameraBeats).toHaveLength(1)
    expect(r.pulseBeats).toHaveLength(1)
  })

  it('网格锁定（music-tempo + ≥4 个运镜拍）⇒ 即使实时新鲜也触发', () => {
    const map = makeMap({
      tempoSource: 'music-tempo',
      cameraBeats: [cam(1), cam(2), cam(3), cam(4)],
      pulseBeats: [pulse(1)],
    })
    const c = createBeatMapCursor()
    // t=100.5 ⇒ 四个拍点全在 75ms lookahead 窗口内 ⇒ 全部出队
    const r = tickBeatMap(c, map, 100.5, true, FRESH)
    expect(r.cameraBeats, 'music-tempo 网格优先于实时').toHaveLength(4)
    expect(r.pulseBeats).toHaveLength(1)
  })

  it('music-tempo 但运镜拍 <4 ⇒ 不算网格锁定', () => {
    const map = makeMap({ tempoSource: 'music-tempo', cameraBeats: [cam(1), cam(2)], pulseBeats: [pulse(1)] })
    const c = createBeatMapCursor()
    const r = tickBeatMap(c, map, 100.5, true, FRESH)
    expect(r.cameraBeats).toHaveLength(0)
  })

  it('liveFreshWindow 下限 0.50（tempoGap 为 0 时）', () => {
    const map = makeMap({ cameraBeats: [cam(1)], pulseBeats: [pulse(1)] })
    const c = createBeatMapCursor()
    // lastHitAt=0.6, t=1.0 ⇒ 差 0.4 < 0.50 ⇒ 仍算新鲜 ⇒ 让位
    const r = tickBeatMap(c, map, 1.0, true, { lastHitAt: 0.6, tempoGap: 0 })
    expect(r.cameraBeats).toHaveLength(0)
  })

  it('lastHitAt <= 0 视为从未锁定', () => {
    const map = makeMap({ cameraBeats: [cam(1)], pulseBeats: [pulse(1)] })
    const r = tickBeatMap(createBeatMapCursor(), map, 1.0, true, { lastHitAt: 0, tempoGap: 0.5 })
    expect(r.cameraBeats).toHaveLength(1)
  })
})

describe('syncBeatMapCursor', () => {
  it('把两条光标都对齐到当前时刻', () => {
    const map = makeMap({
      cameraBeats: [cam(1), cam(2), cam(3), cam(4)],
      pulseBeats: [pulse(1), pulse(2), pulse(3)],
    })
    const c = createBeatMapCursor()
    syncBeatMapCursor(c, map, 2.5)
    // 上游对运镜用严格小于 ⇒ camera 指到第一个 >= 2.5 的（index 2）
    expect(c.camera).toBe(2)
    expect(c.pulse).toBe(2)
  })

  it('对齐后不会补触发历史拍点', () => {
    const map = makeMap({ cameraBeats: [cam(1), cam(2), cam(3)], pulseBeats: [pulse(1), pulse(2), pulse(3)] })
    const c = createBeatMapCursor()
    syncBeatMapCursor(c, map, 2.9)
    const r = tickBeatMap(c, map, 2.9, true, STALE)
    expect(r.cameraBeats, '已过的拍点不得补触发').toHaveLength(0)
    expect(r.pulseBeats).toHaveLength(0)
  })

  it('非有限时间按 0 处理', () => {
    const map = makeMap({ cameraBeats: [cam(1)], pulseBeats: [pulse(1)] })
    const c = createBeatMapCursor()
    syncBeatMapCursor(c, map, Number.NaN)
    expect(c.camera).toBe(0)
    expect(c.pulse).toBe(0)
  })

  it('null 拍点图只清光标', () => {
    const c = createBeatMapCursor()
    c.camera = 5
    c.pulse = 5
    syncBeatMapCursor(c, null, 3)
    expect(c.camera).toBe(0)
    expect(c.pulse).toBe(0)
  })
})

describe('scheduledBeatPulseAmount', () => {
  /**
   * ★ 上游 `cameraDynamicsScale(0.88 + impact * 0.16)` —— 实参**不是 1**。
   *   这里用真正的恒等函数（`x => x`）而非 `() => 1`，否则会掩盖实参错误。
   */
  const dynScale = (v: number) => v

  it('第一道门槛：impact<0.18 且 strength<0.52 ⇒ 丢弃', () => {
    expect(scheduledBeatPulseAmount(pulse(1, { strength: 0.3, impact: 0.1 }), 1, dynScale)).toBeNull()
    // 强度够高则保留
    expect(scheduledBeatPulseAmount(pulse(1, { strength: 0.6, impact: 0.1 }), 1, dynScale)).not.toBeNull()
    expect(scheduledBeatPulseAmount(pulse(1, { strength: 0.3, impact: 0.3 }), 1, dynScale)).not.toBeNull()
  })

  it('第二道门槛：安静曲目（trackScale<0.52）里只留重拍', () => {
    // trackScale 0.4 < 0.52，且 impact 0.3 < 0.46、strength 0.5 < 0.74 ⇒ 丢弃
    expect(scheduledBeatPulseAmount(pulse(1, { strength: 0.5, impact: 0.3 }), 0.4, dynScale)).toBeNull()
    // impact 提到 0.5 ⇒ 保留
    expect(scheduledBeatPulseAmount(pulse(1, { strength: 0.5, impact: 0.5 }), 0.4, dynScale)).not.toBeNull()
    // trackScale 抬到 0.6 ⇒ 门槛不适用
    expect(scheduledBeatPulseAmount(pulse(1, { strength: 0.5, impact: 0.3 }), 0.6, dynScale)).not.toBeNull()
  })

  it('非 DJ 公式与 0.78 上限', () => {
    // impact 0.7 ⇒ dynScale 实参 = 0.88 + 0.7*0.16 = 0.992
    // pulse = (0.14 + 0.8*0.46 + 0.7*0.18 + 0.4*0.08) * 0.992
    //       = (0.14 + 0.368 + 0.126 + 0.032) * 0.992 = 0.666 * 0.992
    const v = scheduledBeatPulseAmount(pulse(1, { strength: 0.8, impact: 0.7, body: 0.4 }), 1, dynScale)
    expect(v).toBeCloseTo(0.666 * 0.992, 6)
    // 全部顶到 1 ⇒ 0.14+0.46+0.18+0.08 = 0.86，×1.04 → 被 0.78 截断
    const max = scheduledBeatPulseAmount(pulse(1, { strength: 1, impact: 1, body: 1 }), 1, dynScale)
    expect(max).toBe(0.78)
  })

  it('combo 提升：downbeat +0.08 / drop +0.04 / 其他 0', () => {
    // 提升量同样要乘 dynScale（impact 0.5 ⇒ 实参 0.88+0.08=0.96）
    const k = 0.96
    const base = scheduledBeatPulseAmount(pulse(1, { strength: 0.5, impact: 0.5 }), 1, dynScale) as number
    const down = scheduledBeatPulseAmount(pulse(1, { strength: 0.5, impact: 0.5, combo: 'downbeat' }), 1, dynScale) as number
    const drop = scheduledBeatPulseAmount(pulse(1, { strength: 0.5, impact: 0.5, combo: 'drop' }), 1, dynScale) as number
    const push = scheduledBeatPulseAmount(pulse(1, { strength: 0.5, impact: 0.5, combo: 'push' }), 1, dynScale) as number
    expect(down - base).toBeCloseTo(0.08 * k, 6)
    expect(drop - base).toBeCloseTo(0.04 * k, 6)
    expect(push - base).toBeCloseTo(0, 6)
  })

  it('裸数字拍点按上游默认值（strength/impact 0.42，body 0）', () => {
    // dynScale 实参 = 0.88 + 0.42*0.16 = 0.9472
    // pulse = (0.14 + 0.42*0.46 + 0.42*0.18) * 0.9472
    //       = (0.14 + 0.1932 + 0.0756) * 0.9472 = 0.4088 * 0.9472
    const v = scheduledBeatPulseAmount(1, 1, dynScale)
    expect(v).toBeCloseTo(0.4088 * 0.9472, 6)
  })

  it('dynScale 真的参与乘法（且 0.78 上限在其后）', () => {
    const b = pulse(1, { strength: 0.5, impact: 0.5, body: 0 })
    // 一次：实参 0.96 ⇒ (0.14 + 0.23 + 0.09 + 0) × 0.96 = 0.46 × 0.96 = 0.4416
    const once = scheduledBeatPulseAmount(b, 1, dynScale) as number
    expect(once).toBeCloseTo(0.46 * 0.96, 6)
    // 翻倍：0.46 × 1.92 = 0.8832 > 0.78 ⇒ 被上限截断
    const doubled = scheduledBeatPulseAmount(b, 1, (x) => x * 2) as number
    expect(doubled).toBe(0.78)
    expect(doubled).toBeGreaterThan(once)
  })
})

describe('cinemaProfileFromBeatMap', () => {
  it('空图/无 duration 返回 null', () => {
    expect(cinemaProfileFromBeatMap(null, 1)).toBeNull()
    expect(cinemaProfileFromBeatMap(makeMap({ duration: 0, cameraBeats: [cam(1)] }), 1)).toBeNull()
  })

  it('全部 camera=false 的图返回 null', () => {
    expect(cinemaProfileFromBeatMap(makeMap({ cameraBeats: [cam(1, { camera: false })] }), 1)).toBeNull()
  })

  it('target 落在 [0.28, 1.12]', () => {
    // 弱拍稀疏图
    const weak = cinemaProfileFromBeatMap(
      makeMap({ duration: 100, cameraBeats: [cam(1, { strength: 0.05, impact: 0.05, low: 0 })] }),
      1,
    )
    expect(weak).not.toBeNull()
    expect(weak!.target).toBeGreaterThanOrEqual(0.28)
    // 强拍密集图
    const strong = cinemaProfileFromBeatMap(
      makeMap({
        duration: 100,
        cameraBeats: Array.from({ length: 200 }, (_, i) => cam(i * 0.5, { strength: 1, impact: 1, low: 1, primary: true })),
      }),
      1,
    )
    expect(strong).not.toBeNull()
    expect(strong!.target).toBeLessThanOrEqual(1.12)
    expect(strong!.target).toBeGreaterThan(weak!.target)
  })

  it('nameHint 缩放 target（上游乘在最后）', () => {
    const events = [cam(1, { strength: 0.9, impact: 0.9, low: 0.9 })]
    const a = cinemaProfileFromBeatMap(makeMap({ duration: 10, cameraBeats: events }), 1)
    const b = cinemaProfileFromBeatMap(makeMap({ duration: 10, cameraBeats: events }), 0.5)
    expect(a).not.toBeNull()
    expect(b!.target).toBeCloseTo(a!.target * 0.5, 10)
  })

  it('density = 拍数 / max(20, duration)', () => {
    const events = Array.from({ length: 10 }, (_, i) => cam(i + 1))
    const r = cinemaProfileFromBeatMap(makeMap({ duration: 100, cameraBeats: events }), 1)
    expect(r!.density).toBeCloseTo(10 / 100, 10)
    const short = cinemaProfileFromBeatMap(makeMap({ duration: 5, cameraBeats: events }), 1)
    expect(short!.density).toBeCloseTo(10 / 20, 10)
  })
})

describe('convergeCinemaScale', () => {
  it('往下收得快（0.55），往上涨得慢（0.22）', () => {
    // 0.6 → 0.2：一步走 55%
    expect(convergeCinemaScale(0.6, 0.2)).toBeCloseTo(0.6 + (0.2 - 0.6) * 0.55, 10)
    // 0.2 → 0.6：一步走 22%
    expect(convergeCinemaScale(0.2, 0.6)).toBeCloseTo(0.2 + (0.6 - 0.2) * 0.22, 10)
  })

  it('不对称性是真的（同距离不同步长）', () => {
    const down = Math.abs(convergeCinemaScale(0.8, 0.4) - 0.8)
    const up = Math.abs(convergeCinemaScale(0.4, 0.8) - 0.4)
    expect(down).toBeGreaterThan(up)
  })

  it('target 相等时不动', () => {
    expect(convergeCinemaScale(0.7, 0.7)).toBe(0.7)
  })
})
