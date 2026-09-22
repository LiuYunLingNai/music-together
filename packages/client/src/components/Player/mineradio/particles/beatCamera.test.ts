import { beforeEach, describe, expect, it } from 'vitest'
import { resetSonicAudioMonitor, stepSonicAudioMonitor } from '../shared/SonicAudioMonitor'
import {
  consumePrimeCamPunch,
  primeBeatCameraAfterTrackStart,
  readCinemaProfileSnapshot,
  resetBeatCamera,
  stepBeatCameraAudio,
  stepBeatCameraFrame,
} from './beatCamera'

/**
 * 回归保护：拍点相机的**行为**（不只是常量）。
 *
 * 这块移植最怕的退化是"看着像接上了、其实每拍都一样" —— 上一版实现就是
 * "4 个常数 + 指数衰减"。因此这里除了钉结构，更重要的是钉**行为**：
 *   ① 包络必须真的按 `attack/hold/release` 走（不是单帧脉冲）
 *   ② 不同 hit 强度必须产生**不同**的推镜幅度（不再是常数）
 *   ③ 停止播放必须释放（否则镜头停在最后一拍上）
 *   ④ 拖拽/静默不得产生 NaN
 *
 * 手法与 `SonicAudioMonitor.test.ts` 一致：用合成频谱驱动**真实的**音频引擎，
 * 再让拍点相机消费它 —— 这样连"桥接字段取错"这类问题也能被抓到。
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

/** 安静帧。 */
const QUIET = spectrumWith([])

/** 喂若干帧音频（含逐拍交替），并按音频频率推进拍点相机。 */
function feed(frames: number, spectrum: Uint8Array, dt = 1 / 45, startTime = 0): void {
  for (let i = 0; i < frames; i++) {
    stepSonicAudioMonitor(spectrum, {
      dt,
      sampleRate: 44100,
      fftSize: 2048,
      currentTime: startTime + i * dt,
      playing: true,
    })
    stepBeatCameraAudio(dt, startTime + i * dt, true)
  }
}

/**
 * 喂"逐拍交替"的乐曲若干秒，并按音频频率推进拍点相机。
 * 每 0.45 秒一拍（≈133 BPM），落在引擎的 [0.42, 0.88] tempo-lock 窗口内。
 */
function feedMusic(durationSec: number, opts: { loud?: number } = {}): void {
  const loud = opts.loud ?? 1
  const dt = 1 / 45
  const frames = Math.round(durationSec / dt)
  const beatPeriod = 0.45
  for (let i = 0; i < frames; i++) {
    const t = i * dt
    // 每拍的前 45% 为"打到"、其余为衰减后的低能量 —— 制造真实 onset
    const phase = (t % beatPeriod) / beatPeriod
    const accent = (1 - phase) * loud
    const spec = spectrumWith([
      [38, 74, 0.95 * accent],
      [74, 165, 0.9 * accent],
      [165, 420, 0.3 * accent],
    ])
    stepSonicAudioMonitor(spec, {
      dt,
      sampleRate: 44100,
      fftSize: 2048,
      currentTime: t,
      playing: true,
    })
    stepBeatCameraAudio(dt, t, true)
  }
}

beforeEach(() => {
  resetSonicAudioMonitor()
  resetBeatCamera(0)
})

describe('拍点相机 · 包络形状', () => {
  it('有鼓点的乐曲必须真的产生推镜（不再是"接上了但没反应"）', () => {
    // 跑 6 秒音乐，同时逐帧读相机冲击量
    const dt = 1 / 45
    let peak = 0
    let maxFramePunch = 0
    for (let i = 0; i < Math.round(6 / dt); i++) {
      const t = i * dt
      const phase = (t % 0.45) / 0.45
      const accent = 1 - phase
      stepSonicAudioMonitor(
        spectrumWith([
          [38, 74, 0.95 * accent],
          [74, 165, 0.9 * accent],
          [165, 420, 0.3 * accent],
        ]),
        { dt, sampleRate: 44100, fftSize: 2048, currentTime: t, playing: true },
      )
      stepBeatCameraAudio(dt, t, true)
      const f = stepBeatCameraFrame(1 / 60, t, true)
      peak = Math.max(peak, f.radiusKick)
      maxFramePunch = Math.max(maxFramePunch, f.punch)
    }
    expect(peak, '喂了 6 秒鼓点却没有任何推镜').toBeGreaterThan(0)
    expect(maxFramePunch, 'punch 从未抬起').toBeGreaterThan(0)
  })

  it('停止播放后冲击量衰减到 0（镜头不停在最后一拍）', () => {
    feedMusic(6)
    // 停播后必须释放
    for (let i = 0; i < 900; i++) stepBeatCameraFrame(1 / 60, 6, false)
    const after = stepBeatCameraFrame(1 / 60, 6, false)
    expect(after.punch).toBeLessThan(0.001)
    expect(after.radiusKick).toBeLessThan(0.001)
    expect(after.phiKick).toBeLessThan(0.001)
    expect(after.rollKick).toBeLessThan(0.001)
  })

  it('包络是持续的，不是单帧脉冲（否则镜头会抖）', () => {
    feedMusic(6)
    // 统计 radiusKick 持续非零的最长连续帧数：单帧脉冲只会有一两帧
    let framesAbove = 0
    let maxRun = 0
    let run = 0
    for (let i = 0; i < 90; i++) {
      const v = stepBeatCameraFrame(1 / 60, 6 + i / 60, true).radiusKick
      if (v > 0.0005) {
        framesAbove++
        run++
        maxRun = Math.max(maxRun, run)
      } else {
        run = 0
      }
    }
    expect(framesAbove, '包络没有任何非零帧').toBeGreaterThan(0)
    // attack(≥14ms)+hold(≥14ms)+release(≥110ms) ⇒ 至少 ~8 帧 @60fps
    expect(maxRun, '包络太短，像单帧脉冲而不是 attack/hold/release').toBeGreaterThanOrEqual(5)
  })

  it('整曲自适应：安静曲目不得给出满幅推镜（不再是常数）', () => {
    // 安静乐曲（低频弱），跑 12 秒让 dynamics/profile 收敛
    feedMusic(12, { loud: 0.18 })
    let quietPeak = 0
    for (let i = 0; i < 120; i++) {
      quietPeak = Math.max(quietPeak, stepBeatCameraFrame(1 / 60, 12 + i / 60, true).radiusKick)
    }

    // 换一首炸歌（先重置，模拟切歌）
    resetSonicAudioMonitor()
    resetBeatCamera(0)
    feedMusic(12, { loud: 1 })
    let loudPeak = 0
    for (let i = 0; i < 120; i++) {
      loudPeak = Math.max(loudPeak, stepBeatCameraFrame(1 / 60, 12 + i / 60, true).radiusKick)
    }

    expect(loudPeak, '炸歌没有任何推镜').toBeGreaterThan(0)
    // 自适应系数夹在 [0.34, 1.08]，安静曲目应显著更低
    expect(quietPeak, '安静曲目与炸歌幅度相同 —— 整曲自适应没生效').toBeLessThan(loudPeak)
  })

  /**
   * ★ 第三十四轮（§5.4 A1）：`lowOnset` 必须取**连续量**。
   *
   * 缺陷原状：`lowOnset` 喂的是 0/1 上升沿（`kickOnset`），而
   * `punchRaw = clamp01(lowOnset*2.4 + …)` —— 1×2.4 直接夹到 1；
   * 上游的 `bassOnset = max(0, rb − smoothBass)` 是连续的。
   *
   * ★★ **实测边界（勿夸大，也不要缩小）**：接手方用合成频谱在真实引擎上
   *    对拍过"改成连续量"与"保持 0/1"两种实现，结论与审计报告的表述**不同**：
   *
   *      材料            punchPeak(连续)   punchPeak(0/1)
   *      逐拍鼓点          0.9777           0.9704      ← 几乎无差别
   *      持续低频          0.6280           0.2634      ← **差别显著**
   *
   *    原因：`rb` 是**峰值相对**归一化（`pow(bKick / max(0.038, bassPeak*0.66), 0.78)`），
   *    鼓点一起跳 `rb` 就接近 1，**连续量也会接近 1** —— 所以"打击乐上
   *    punchPeak 顶到 1"是**上游行为**，不是缺陷。
   *
   *    审计原文称"`punchPeak` 整首锁死 1、`target` 恒 +0.34"——在我构造的
   *    极端合成材料里 `target` 两边都是 1.12（被 clamp，其它项也满了），
   *    因此**该表述过强**。真实差别体现在**持续音/安静段**：
   *    0/1 只在检测器触发的那几帧顶满、其余帧为 0，于是 `punchPeak` 被
   *    反复拉到高位又掉下来，与连续量的收敛值相差 2 倍以上。
   *
   *    ★ 因此本用例只钉**能稳定区分**的那一种材料（持续低频），
   *      并留出宽裕阈值。改成 0/1 即失败（0.2634 < 0.5）。
   */
  it('★ A1 回归：持续低频下 punchPeak 必须取连续量的收敛值（0/1 会掉到一半以下）', () => {
    resetSonicAudioMonitor()
    resetBeatCamera(0)
    const dt = 1 / 45
    // 持续中低频、**无逐拍起落** —— 这时上游的 bassOnset 很小
    for (let i = 0; i < Math.round(12 / dt); i++) {
      const t = i * dt
      stepSonicAudioMonitor(
        spectrumWith([
          [38, 74, 0.95],
          [74, 165, 0.9],
          [165, 420, 0.3],
        ]),
        { dt, sampleRate: 44100, fftSize: 2048, currentTime: t, playing: true },
      )
      stepBeatCameraAudio(dt, t, true)
    }
    const s = readCinemaProfileSnapshot()
    // 连续量实测 ≈0.628；0/1 实测 ≈0.263。阈值取中间。
    expect(
      s.punchPeak,
      '持续低频下 punchPeak 偏低 —— lowOnset 又退化成 0/1 上升沿了',
    ).toBeGreaterThan(0.5)
  })

  it('punchPeak 停喂后必须回落（是衰减记忆，不是锁存）', () => {
    resetSonicAudioMonitor()
    resetBeatCamera(0)
    feedMusic(8, { loud: 1 })
    const hot = readCinemaProfileSnapshot().punchPeak
    // 喂静音 6 秒（≈270 分析帧，0.9975^270 ≈ 0.51）
    for (let i = 0; i < Math.round(6 * 45); i++) {
      stepSonicAudioMonitor(QUIET, {
        dt: 1 / 45,
        sampleRate: 44100,
        fftSize: 2048,
        currentTime: 8 + i / 45,
        playing: true,
      })
      stepBeatCameraAudio(1 / 45, 8 + i / 45, true)
    }
    const cooled = readCinemaProfileSnapshot().punchPeak
    expect(cooled, 'punchPeak 必须随静音回落').toBeLessThan(hot)
  })
})

describe('拍点相机 · 数值健全性', () => {
  it('任何输入下都不得产出 NaN / Infinity', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['静音', QUIET],
      ['满幅', spectrumWith([[20, 16000, 1]])],
      ['只有高频', spectrumWith([[4200, 9000, 1]])],
    ]
    for (const [name, spec] of cases) {
      resetSonicAudioMonitor()
      resetBeatCamera(0)
      feed(120, spec)
      for (let i = 0; i < 120; i++) {
        const f = stepBeatCameraFrame(1 / 60, 2 + i / 60, true)
        for (const key of ['punch', 'thetaKick', 'phiKick', 'radiusKick', 'rollKick'] as const) {
          expect(Number.isFinite(f[key]), `${name} 的 ${key} = ${f[key]}`).toBe(true)
        }
      }
    }
  })

  it('thetaKick 恒为 0（DJ 分支未移植；普通曲目累加 theta 会让镜头持续左右摇）', () => {
    feedMusic(8)
    for (let i = 0; i < 200; i++) {
      expect(stepBeatCameraFrame(1 / 60, 8 + i / 60, true).thetaKick).toBe(0)
    }
  })

  it('未播放时喂入引擎不产生事件（stepBeatCameraAudio 应早退）', () => {
    stepBeatCameraAudio(1 / 45, 0, false)
    const f = stepBeatCameraFrame(1 / 60, 0, true)
    expect(f.punch).toBe(0)
  })

  it('resetBeatCamera 清空在飞事件与自适应（切歌不得带上一首的状态）', () => {
    // 喂音乐，并在过程中抓住一帧"确实有在飞事件"的时刻 ——
    // 不能在固定时刻断言：包络会走完（正确行为），那一瞬 radiusKick 本就会归零。
    const dt = 1 / 45
    let inflightAt = -1
    let inflightRadius = 0
    for (let i = 0; i < Math.round(8 / dt); i++) {
      const t = i * dt
      const phase = (t % 0.45) / 0.45
      const accent = 1 - phase
      stepSonicAudioMonitor(
        spectrumWith([
          [38, 74, 0.95 * accent],
          [74, 165, 0.9 * accent],
          [165, 420, 0.3 * accent],
        ]),
        { dt, sampleRate: 44100, fftSize: 2048, currentTime: t, playing: true },
      )
      stepBeatCameraAudio(dt, t, true)
      const f = stepBeatCameraFrame(1 / 60, t, true)
      if (f.radiusKick > inflightRadius) {
        inflightRadius = f.radiusKick
        inflightAt = t
      }
    }
    expect(inflightAt, '整段音乐里从未出现在飞事件').toBeGreaterThanOrEqual(0)
    expect(inflightRadius).toBeGreaterThan(0)

    // 在"有在飞事件"的时刻重置 → 必须立刻归零
    resetBeatCamera(inflightAt)
    const f = stepBeatCameraFrame(1 / 60, inflightAt, true)
    expect(f.punch).toBe(0)
    expect(f.radiusKick).toBe(0)
    expect(f.phiKick).toBe(0)
    expect(f.rollKick).toBe(0)
  })

  it('预热期内不接受命中（上游 warmupUntil = currentTime + 0.48）', () => {
    resetSonicAudioMonitor()
    resetBeatCamera(0)
    // 只在 0 ~ 0.3s 内喂鼓点：应全部落在预热窗口里，不产生推镜
    const dt = 1 / 45
    for (let i = 0; i < 14; i++) {
      const t = i * dt
      const phase = (t % 0.45) / 0.45
      const accent = 1 - phase
      stepSonicAudioMonitor(
        spectrumWith([
          [38, 74, 0.95 * accent],
          [74, 165, 0.9 * accent],
        ]),
        { dt, sampleRate: 44100, fftSize: 2048, currentTime: t, playing: true },
      )
      stepBeatCameraAudio(dt, t, true)
    }
    expect(stepBeatCameraFrame(1 / 60, 0.3, true).punch).toBe(0)
  })
})

/**
 * 第三十四轮补的两项（§5.4 A8 / A11）。
 */
describe('拍点相机 · 入场推镜与 seek 重置', () => {
  it('★ 切歌入场必须打一记推镜（§5.4 A8：此前完全缺失）', () => {
    resetSonicAudioMonitor()
    resetBeatCamera(0)
    // 模拟"刚切歌"：prime 后立刻求包络，应已有一记 radiusKick / phiKick / punch
    primeBeatCameraAfterTrackStart(0)
    const f = stepBeatCameraFrame(1 / 60, 0, true)
    expect(f.punch, '入场应有 punch').toBeGreaterThan(0)
    expect(f.radiusKick, '入场应有推镜').toBeGreaterThan(0)
    expect(f.phiKick, '入场应有俯仰冲击').toBeGreaterThan(0)
  })

  it('★ 入场 camPunch 由消费方取走且**只取一次**（一次性）', () => {
    resetBeatCamera(0)
    primeBeatCameraAfterTrackStart(0)
    expect(consumePrimeCamPunch(), '首次应取到 0.11').toBeCloseTo(0.11, 6)
    expect(consumePrimeCamPunch(), '再取应为 0（不得重复抬高）').toBe(0)
  })

  it('★ prime 必须在 reset **之后**才生效（顺序反了会被抹掉）', () => {
    resetBeatCamera(0)
    primeBeatCameraAfterTrackStart(0)
    // prime 会把 dynamics.scale 抬到 ≥0.92；若 reset 在其后，会被归回 0.82
    const f = stepBeatCameraFrame(1 / 60, 0, true)
    expect(f.radiusKick).toBeGreaterThan(0)
  })

  it('resetBeatCamera 必须清掉未消费的入场冲击（红线 22）', () => {
    primeBeatCameraAfterTrackStart(0)
    resetBeatCamera(0)
    expect(consumePrimeCamPunch(), 'reset 后不得残留入场冲击').toBe(0)
  })

  it('★ seek 必须重置引擎状态，而不只是清事件（§5.4 A11）', () => {
    // 先用一段音乐把 tempo / 峰值跟踪器喂起来
    resetSonicAudioMonitor()
    resetBeatCamera(0)
    const dt = 1 / 45
    for (let i = 0; i < Math.round(6 / dt); i++) {
      const t = i * dt
      const phase = (t % 0.45) / 0.45
      const accent = 1 - phase
      stepSonicAudioMonitor(
        spectrumWith([
          [38, 74, 0.95 * accent],
          [74, 165, 0.9 * accent],
        ]),
        { dt, sampleRate: 44100, fftSize: 2048, currentTime: t, playing: true },
      )
      stepBeatCameraAudio(dt, t, true)
    }
    // 跳到远处（>0.55s 跳变触发 seek 分支），随后立刻求包络：
    // 预热窗口应被重启 ⇒ 该时刻不得有推镜
    const seekTo = 60
    stepBeatCameraAudio(dt, seekTo, true)
    const f = stepBeatCameraFrame(1 / 60, seekTo, true)
    expect(f.radiusKick, 'seek 后应进入预热，不得立刻推镜').toBe(0)
    expect(f.punch, 'seek 后应进入预热，不得立刻 punch').toBe(0)
  })
})
