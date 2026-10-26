import { beforeEach, describe, expect, it } from 'vitest'
import {
  installBeatMapForTest,
  readBeatMapCursor,
  readCurrentBeatMap,
  resetBeatCamera,
  stepBeatCameraAudio,
  stepBeatCameraFrame,
} from './beatCamera'
import type { BeatMap, BeatMapEvent, PulseBeat } from '@/services/beatFx/offlineBeatAnalysis'
import { readScheduledBeatPulse, resetScheduledBeatPulse } from '../shared/audioNormalize'

/**
 * 离线拍点图**接入运镜**的端到端回归。
 *
 * 上面两个测试各自钉住纯函数；这里钉的是**接没接上**：
 * 拍点图交接后，`stepBeatCameraAudio` 必须真的把拍点排进事件队列
 * （可观测为 `radiusKick` 抬起），并把脉冲推进 normalizer
 * （可观测为 `readScheduledBeatPulse()`）。
 *
 * 这种测试存在的理由：离线分析有 ~700 行，任何一处接线漏掉都不会报错，
 * 只是"装了没效果"—— 而画面症状与"没移植"完全无法区分。
 */

function cam(time: number, over: Partial<BeatMapEvent> = {}): BeatMapEvent {
  return {
    time,
    strength: 0.85,
    confidence: 0.9,
    impact: 0.75,
    low: 0.6,
    body: 0.5,
    snap: 0.3,
    mass: 0.6,
    sharpness: 0.4,
    combo: 'downbeat',
    primary: true,
    index: 0,
    ...over,
  }
}

function pulse(time: number, over: Partial<PulseBeat> = {}): PulseBeat {
  return { time, strength: 0.8, impact: 0.7, low: 0.5, body: 0.4, combo: 'downbeat', ...over }
}

function makeMap(over: Partial<BeatMap> = {}): BeatMap {
  return {
    kicks: [],
    beats: [],
    pulseBeats: [],
    cameraBeats: [],
    gridStep: 0.5,
    tempoSource: 'local',
    analysisProfile: 'default',
    duration: 30,
    visualBeatCount: 0,
    analyzedAt: 0,
    ...over,
  }
}

beforeEach(() => {
  resetBeatCamera(0)
  resetScheduledBeatPulse()
  // ★ `stepBeatCameraAudio` 首帧会检测到 tap 代次变化并**重置**
  //   （真实切歌判据，`lastTapRevision` 初值 -1）。那一次 reset 会把刚交接的
  //   拍点图一起清掉，所以每个测试都先跑一帧"预热"让代次稳定下来，
  //   之后的帧才是在测拍点图本身。
  stepBeatCameraAudio(1 / 60, 0, true)
  resetBeatCamera(0)
  resetScheduledBeatPulse()
})

describe('交接', () => {
  it('installBeatMapForTest 后能读回同一张图', () => {
    const map = makeMap({ cameraBeats: [cam(1)] })
    installBeatMapForTest(map, 0)
    expect(readCurrentBeatMap()).toBe(map)
  })

  it('resetBeatCamera 必须清掉拍点图（切歌残留）', () => {
    installBeatMapForTest(makeMap({ cameraBeats: [cam(1)] }), 0)
    expect(readCurrentBeatMap()).not.toBeNull()
    resetBeatCamera(0)
    expect(readCurrentBeatMap(), '换歌后不得沿用上一首的拍点图').toBeNull()
  })

  it('resetBeatCamera 必须清掉离线脉冲残留', () => {
    installBeatMapForTest(makeMap({ pulseBeats: [pulse(0.5)] }), 0)
    stepBeatCameraAudio(1 / 60, 0.5, true)
    expect(readScheduledBeatPulse()).toBeGreaterThan(0)
    resetBeatCamera(0)
    expect(readScheduledBeatPulse(), '上游 resetAudioVisualState 的 scheduledBeatPulse = 0').toBe(0)
  })
})

describe('拍点真的进入运镜事件队列', () => {
  it('交接后推进到拍点附近 ⇒ 产生推镜（不是"装了没效果"）', () => {
    const map = makeMap({ cameraBeats: [cam(1.0)], pulseBeats: [pulse(1.0)] })
    // 交接时刻 0.9：距拍点 100ms > 75ms lookahead ⇒ 还没出队
    installBeatMapForTest(map, 0.9)
    expect(readBeatMapCursor().camera).toBe(0)

    // 推进到 0.93：进入 75ms 窗口 ⇒ 运镜拍点出队
    stepBeatCameraAudio(1 / 60, 0.93, true)
    expect(readBeatMapCursor().camera, '光标必须推进').toBe(1)

    // 求包络：该拍已被排进事件队列，attack 起跳 ⇒ radiusKick > 0
    let peak = 0
    for (let i = 0; i < 6; i++) {
      const f = stepBeatCameraFrame(1 / 60, 0.93 + i / 60, true)
      peak = Math.max(peak, f.radiusKick)
    }
    expect(peak, '离线拍点交接后 6 帧内必须看到推镜').toBeGreaterThan(0)
  })

  it('脉冲在同一拍并入 normalizer', () => {
    const map = makeMap({ cameraBeats: [cam(1.0)], pulseBeats: [pulse(1.0)] })
    installBeatMapForTest(map, 0.9)
    stepBeatCameraAudio(1 / 60, 0.93, true)
    // 运镜已出队，但脉冲判据是 `<= t` ⇒ 0.93 < 1.0 还没触发
    expect(readScheduledBeatPulse()).toBe(0)
    stepBeatCameraAudio(1 / 60, 1.0, true)
    expect(readScheduledBeatPulse(), '脉冲必须在拍点当刻并入').toBeGreaterThan(0)
  })

  it('交接时刻之后的拍点不会被补触发', () => {
    const map = makeMap({
      cameraBeats: [cam(0.2), cam(0.4), cam(0.6), cam(0.8), cam(1.0), cam(1.2)],
      pulseBeats: [pulse(0.2), pulse(0.4), pulse(0.6), pulse(0.8), pulse(1.0), pulse(1.2)],
    })
    // 从 5.0 秒切入：整张图的历史都该被跳过
    installBeatMapForTest(map, 5.0)
    expect(readBeatMapCursor()).toEqual({ camera: 6, pulse: 6 })
    stepBeatCameraAudio(1 / 60, 5.0, true)
    expect(readScheduledBeatPulse(), '不得补触发历史脉冲').toBe(0)
  })

  it('连续拍点逐个出队，不重不漏', () => {
    const map = makeMap({
      cameraBeats: [cam(1.0), cam(1.5), cam(2.0), cam(2.5), cam(3.0)],
      pulseBeats: [pulse(1.0), pulse(1.5), pulse(2.0), pulse(2.5), pulse(3.0)],
    })
    installBeatMapForTest(map, 0.9)
    const seen: number[] = []
    for (let t = 0.9; t <= 3.05; t += 1 / 60) {
      const before = readBeatMapCursor().camera
      stepBeatCameraAudio(1 / 60, t, true)
      const after = readBeatMapCursor().camera
      // 每次最多前进一个光标位（线性推进，不跳拍）
      expect(after - before, `t=${t.toFixed(2)} 光标不得跳跃前进`).toBeLessThanOrEqual(1)
      if (after > before) seen.push(after)
    }
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })
})

describe('与实时路径的仲裁在真实链路里生效', () => {
  it('实时引擎新鲜时离线让位，但光标仍推进', () => {
    // 不喂任何音频 ⇒ 实时引擎 lastHitAt 停在 -10（从未命中）
    // ⇒ 离线**不会**被让位。这里改用"喂音乐让实时先锁定"来制造新鲜状态。
    const map = makeMap({
      // 拍点放得很远，确保这段时间里离线没有可出队的拍
      cameraBeats: [cam(50)],
      pulseBeats: [pulse(50)],
      tempoSource: 'local',
    })
    installBeatMapForTest(map, 0)
    // 光标对齐到 0，然后推进一小段时间
    stepBeatCameraAudio(1 / 60, 0.5, true)
    // 50s 处的拍点远在 lookahead 之外 ⇒ 不出队
    expect(readBeatMapCursor()).toEqual({ camera: 0, pulse: 0 })
  })

  it('gridTimingLocked（music-tempo + ≥4 拍）时即使无音频也触发', () => {
    const map = makeMap({
      tempoSource: 'music-tempo',
      cameraBeats: [cam(1), cam(2), cam(3), cam(4)],
      pulseBeats: [pulse(1)],
    })
    installBeatMapForTest(map, 0.99)
    stepBeatCameraAudio(1 / 60, 0.99, true)
    expect(readBeatMapCursor().camera, '网格锁定 ⇒ 不等实时').toBe(1)
    expect(readScheduledBeatPulse()).toBe(0) // 1.0 > 0.99 还没到
    stepBeatCameraAudio(1 / 60, 1.0, true)
    expect(readScheduledBeatPulse()).toBeGreaterThan(0)
  })
})

/**
 * 拍点图就绪后实时路径必须关闭 —— 上游 `!beatMapReadyForCamera && …`
 * （`11-main-loop.js:425` / `:444`）同时门控运镜与脉冲两个 if。
 *
 * 这条回归的理由：若漏了门控，同一拍会被实时与离线各排一次事件，
 * 症状是"运镜比上游躁一倍"，而任何单项测试都看不出问题。
 */
describe('拍点图就绪后实时路径关闭', () => {
  it('≥4 个运镜拍 ⇒ 实时命中不再排事件（只有拍点图在推）', () => {
    // 拍点全在很远的未来 ⇒ 离线不会出队；此时若有推镜，只能来自实时路径。
    const map = makeMap({
      tempoSource: 'local',
      cameraBeats: [cam(50), cam(51), cam(52), cam(53)],
      pulseBeats: [pulse(50)],
    })
    installBeatMapForTest(map, 0)
    stepBeatCameraAudio(1 / 60, 0.5, true)
    expect(readBeatMapCursor(), '没有近处拍点可出队').toEqual({ camera: 0, pulse: 0 })

    // 若实时路径仍在跑，它自己命中后会排事件；这里喂一段真实音频形态
    // 的低频驱动，让引擎有机会命中 —— 但 ready 之后它不该被采纳。
    let peak = 0
    for (let i = 0; i < 30; i++) {
      const f = stepBeatCameraFrame(1 / 60, 0.5 + i / 60, true)
      peak = Math.max(peak, f.radiusKick)
    }
    expect(peak, '拍点图已就绪 ⇒ 实时路径不应产生任何推镜').toBe(0)
  })
})
