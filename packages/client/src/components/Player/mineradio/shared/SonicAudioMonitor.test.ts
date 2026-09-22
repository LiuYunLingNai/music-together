import { beforeEach, describe, expect, it } from 'vitest'
import {
  MONITOR_BAND_EDGES,
  SONIC_BEAT_WINDOWS,
  beatParams,
  computeHzBands,
  getSonicAudioFrame,
  resetSonicAudioMonitor,
  stepSonicAudioMonitor,
} from './SonicAudioMonitor'

/**
 * 回归保护：音频引擎的**行为**（不只是常量）。
 *
 * 用户最看重的是「鼓点反馈」，「不满意」的根因是：
 *   ① 引擎整层缺失（只有朴素 RMS + 粗 onset）
 *   ② `readAudioBands` 有状态却被 6 个组件每帧调用，互相破坏
 * 因此这里除了钉常量，更重要的是钉**行为**：给定一段"鼓点"频谱，
 * 引擎必须真的产出 kick onset 与包络。
 */

/** 构造一帧频谱：把给定频段区间填成某个能量，其余为 0。 */
function spectrumWith(
  entries: Array<[number, number, number]>,
  len = 1024,
  sampleRate = 44100,
  fftSize = 2048,
): Uint8Array {
  const data = new Uint8Array(len)
  const binHz = sampleRate / fftSize
  for (const [lo, hi, value] of entries) {
    const start = Math.max(0, Math.floor(lo / binHz))
    const end = Math.min(len - 1, Math.ceil(hi / binHz))
    for (let i = start; i <= end; i++) data[i] = Math.round(value * 255)
  }
  return data
}

describe('SonicAudioMonitor · 常量与上游一致', () => {
  it('八频段边界与上游 SONIC_AUDIO_BAND_EDGES 相同', () => {
    expect(MONITOR_BAND_EDGES).toEqual([
      ['subBass', 32, 58],
      ['bass', 58, 118],
      ['lowMid', 118, 260],
      ['mid', 260, 720],
      ['highMid', 720, 1800],
      ['presence', 1800, 4200],
      ['brilliance', 4200, 9000],
      ['air', 9000, 16000],
    ])
  })

  it('六个节拍窗口与上游一致（名字/边界/bias）', () => {
    expect(SONIC_BEAT_WINDOWS.map((w) => w.name)).toEqual(['Deep', 'Club', 'Kick', 'Punch', 'Body', 'Wide'])
    expect(SONIC_BEAT_WINDOWS[1]).toEqual({ name: 'Club', startHz: 46, endHz: 118, bias: 1.22 })
  })

  it('beatParams 在灵敏度 50 处取 normal 档', () => {
    const p = beatParams(50)
    expect(p.thresholdStdDevGain).toBeCloseTo(1.8, 6)
    expect(p.thresholdFloor).toBeCloseTo(0.028, 6)
    expect(p.minTriggerFlux).toBeCloseTo(0.045, 6)
  })

  it('beatParams 在 0 / 100 处分别取 strict / sensitive 档', () => {
    expect(beatParams(0).thresholdStdDevGain).toBeCloseTo(2.6, 6)
    expect(beatParams(0).minTriggerFlux).toBeCloseTo(0.07, 6)
    expect(beatParams(100).thresholdStdDevGain).toBeCloseTo(1.1, 6)
    expect(beatParams(100).minTriggerFlux).toBeCloseTo(0.025, 6)
  })

  it('computeHzBands 只把能量放进对应频段', () => {
    // 只在 60-110Hz（bass 段）注入能量
    const data = spectrumWith([[58, 118, 1]])
    const meta = { len: data.length, sampleRate: 44100, fftSize: 2048, nyquist: 22050, binHz: 44100 / 2048 }
    const bands = computeHzBands(data, meta)
    expect(bands.bass).toBeGreaterThan(0.5)
    expect(bands.air).toBeLessThan(0.01)
    expect(bands.brilliance).toBeLessThan(0.01)
  })
})

describe('SonicAudioMonitor · 鼓点响应（行为）', () => {
  beforeEach(() => {
    resetSonicAudioMonitor()
  })

  /** 推进若干帧，每次给一段低频"鼓"频谱。 */
  function feed(dt: number, count: number, level = 1) {
    let frame = null
    for (let i = 0; i < count; i++) {
      frame = stepSonicAudioMonitor(spectrumWith([[40, 140, level]]), {
        dt,
        sampleRate: 44100,
        fftSize: 2048,
        playing: true,
      })
    }
    return frame
  }

  it('持续的低频冲击会产生 kick 包络（而不是恒为 0）', () => {
    const frame = feed(1 / 60, 30)
    expect(frame).not.toBeNull()
    expect(frame!.kickEnvelope).toBeGreaterThan(0)
  })

  it('安静时 kick 包络归零', () => {
    const frame = feed(1 / 60, 20, 0)
    expect(frame!.kickEnvelope).toBeLessThan(0.05)
    expect(frame!.kickOnset).toBe(0)
  })

  it('鼓点相对静音会显著抬高 kickEnvelope（有动态范围）', () => {
    // 先跑一段安静，再给强鼓
    feed(1 / 60, 20, 0)
    const loud = feed(1 / 60, 20, 1)
    expect(loud!.kickEnvelope).toBeGreaterThan(0.2)
  })

  it('frame 提供地形需要的全部字段', () => {
    const frame = feed(1 / 60, 10)
    for (const key of [
      'subBass',
      'bass',
      'bassBand',
      'lowMid',
      'mid',
      'highMid',
      'presence',
      'brilliance',
      'air',
      'kickEnvelope',
      'kickOnset',
      'kickLevel',
      'kickConfidence',
      'energy',
      'smoothness',
      'density',
      'sharpness',
      'warmth',
      'brightness',
      'triggerPulse',
    ] as const) {
      expect(frame).toHaveProperty(key)
      expect(Number.isFinite(Number((frame as unknown as Record<string, unknown>)[key]))).toBe(true)
    }
  })

  it('getSonicAudioFrame 返回最近一次结果（消费者读缓存）', () => {
    const frame = feed(1 / 60, 5)
    expect(getSonicAudioFrame()).toBe(frame)
  })

  it('未播放时走衰减路径：包络逐帧下降', () => {
    const loud = feed(1 / 60, 20, 1)
    const before = loud!.kickEnvelope
    const decayed = stepSonicAudioMonitor(null, { dt: 1 / 60, sampleRate: 44100, fftSize: 2048, playing: false })
    expect(decayed!.kickEnvelope).toBeLessThan(before)
  })
})
