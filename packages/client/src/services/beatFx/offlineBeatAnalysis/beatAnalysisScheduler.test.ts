import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BEAT_ANALYSIS_CONFIG, scheduleBeatAnalysis, type BeatAnalysisEnv } from './beatAnalysisScheduler'
import { analyzeAudioBeats } from './analyzeAudioBeats'
import type { BeatMap } from './beatAnalysisTypes'

/**
 * 调度器的时序回归 —— 上游 `scheduleBeatAnalysis`
 * （`00-tempo-worker-cache-prefetch.js:195-262`）。
 *
 * 用假定时器驱动，因为这里测的**全是时序**：等多久、什么条件下重新排、
 * 失败退避多少。这些数字错了不会报错，只会让分析"莫名不跑"或
 * "起播瞬间就抢带宽"。
 */

vi.mock('./analyzeAudioBeats', () => ({
  analyzeAudioBeats: vi.fn(async () => null),
}))

const analyze = vi.mocked(analyzeAudioBeats)

/**
 * ★ `scheduleAnalysisTask` 走 `requestIdleCallback`，而 vitest 的假定时器
 *   不驱动它（Node ≥18 原生有这个 API，但不会因时间推进而触发回调）
 *   ⇒ 分析永远不会"跑起来"。这里把它换成"立即跑"，让时序完全由假
 *   定时器掌控。被测的是**排程逻辑**，不是 idle 调度本身。
 */
beforeEach(() => {
  vi.useFakeTimers()
  analyze.mockReset()
  analyze.mockImplementation(async () => null)
  ;(globalThis as unknown as { requestIdleCallback?: unknown }).requestIdleCallback = (
    fn: () => void,
  ) => {
    fn()
    return 0
  }
})

afterEach(() => {
  vi.useRealTimers()
})

function makeEnv(over: Partial<BeatAnalysisEnv> = {}): BeatAnalysisEnv {
  return {
    token: 1,
    currentTime: () => 5,
    isPlaying: () => true,
    isCurrent: (t) => t === 1,
    onMap: vi.fn(),
    ...over,
  }
}

describe('BEAT_ANALYSIS_CONFIG', () => {
  it('逐字对齐上游（03-beat-dj-state.js:29-34）', () => {
    expect(BEAT_ANALYSIS_CONFIG.delayMs).toBe(1600)
    expect(BEAT_ANALYSIS_CONFIG.minPlaybackSec).toBe(1.2)
    expect(BEAT_ANALYSIS_CONFIG.idleTimeout).toBe(1400)
    expect(BEAT_ANALYSIS_CONFIG.skipMusicTempoWhilePlaying).toBe(false)
  })
})

describe('初始延迟', () => {
  it('delayMs 之内不分析', () => {
    const env = makeEnv()
    scheduleBeatAnalysis('http://x/a.mp3', env)
    vi.advanceTimersByTime(BEAT_ANALYSIS_CONFIG.delayMs - 1)
    expect(analyze, '还没到 delayMs 就开跑会抢起播带宽').not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('少于 120ms 的重排被抬到 120ms（上游 Math.max(120, …)）', () => {
    const env = makeEnv({ isPlaying: () => false })
    scheduleBeatAnalysis('http://x/a.mp3', env)
    vi.advanceTimersByTime(BEAT_ANALYSIS_CONFIG.delayMs)
    // 暂停 ⇒ 重排 620ms
    vi.advanceTimersByTime(619)
    expect(analyze).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(analyze).not.toHaveBeenCalled()
    // 仍暂停 ⇒ 再排 620
    vi.advanceTimersByTime(620)
    expect(analyze).not.toHaveBeenCalled()
  })
})

describe('播放进度门槛', () => {
  it('不足 minPlaybackSec ⇒ 按差额重排', () => {
    let now = 0
    const env = makeEnv({ currentTime: () => now })
    scheduleBeatAnalysis('http://x/a.mp3', env)
    vi.advanceTimersByTime(BEAT_ANALYSIS_CONFIG.delayMs)
    expect(analyze, '起播瞬间不分析').not.toHaveBeenCalled()
    // 差额 1.2s ⇒ max(500, 1200) = 1200ms 后再看
    now = 1.2
    vi.advanceTimersByTime(1200)
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('差额小于 500ms 时仍等 500ms（上游 Math.max(500, …)）', () => {
    let now = 1.1
    const env = makeEnv({ currentTime: () => now })
    scheduleBeatAnalysis('http://x/a.mp3', env)
    vi.advanceTimersByTime(BEAT_ANALYSIS_CONFIG.delayMs)
    // 差 0.1s ⇒ 100ms，但下限 500ms ⇒ 等满 500ms 才复查
    vi.advanceTimersByTime(499)
    expect(analyze, '499ms 时还不该复查').not.toHaveBeenCalled()
    // ★ 播放进度**没长**（仍是 1.1）⇒ 复查后继续等，不会提前分析。
    //   这一步是上游的语义：进度不够就一直等，没有"超时硬跑"。
    vi.advanceTimersByTime(1)
    expect(analyze, '进度仍不足 ⇒ 继续等').not.toHaveBeenCalled()
    // 播放推进到门槛之上 ⇒ 下一次复查即开跑
    now = 1.2
    vi.advanceTimersByTime(500)
    expect(analyze).toHaveBeenCalledTimes(1)
  })
})

describe('代次判据', () => {
  it('代次变化 ⇒ 不再分析（切歌后上一首的分析必须停）', () => {
    const env = makeEnv({ isCurrent: (t) => t === 2 })
    scheduleBeatAnalysis('http://x/a.mp3', env)
    vi.advanceTimersByTime(BEAT_ANALYSIS_CONFIG.delayMs + 100)
    expect(analyze, '已切歌却还在分析上一首').not.toHaveBeenCalled()
  })

  it('取消后不再跑', () => {
    const env = makeEnv()
    scheduleBeatAnalysis('http://x/a.mp3', env).cancel()
    vi.advanceTimersByTime(BEAT_ANALYSIS_CONFIG.delayMs + 1000)
    expect(analyze).not.toHaveBeenCalled()
  })
})

describe('状态探针', () => {
  // `waitingForBeatMap`（11-main-loop.js:414）要区分"正在跑"与"已排程"。
  it('排程后未开跑 ⇒ isPending 真、isBusy 假', () => {
    const handle = scheduleBeatAnalysis('http://x/a.mp3', makeEnv())
    expect(handle.isPending()).toBe(true)
    expect(handle.isBusy()).toBe(false)
    handle.cancel()
  })

  it('开跑后 ⇒ isBusy 真、isPending 假', async () => {
    let release: () => void = () => {}
    analyze.mockImplementation(
      () =>
        new Promise<BeatMap | null>((r) => {
          release = () => r(null)
        }),
    )
    const handle = scheduleBeatAnalysis('http://x/a.mp3', makeEnv())
    await vi.advanceTimersByTimeAsync(BEAT_ANALYSIS_CONFIG.delayMs)
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(handle.isBusy(), '分析进行中').toBe(true)
    expect(handle.isPending(), '定时器已消费').toBe(false)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.isBusy()).toBe(false)
  })

  it('取消后两个探针都假', () => {
    const handle = scheduleBeatAnalysis('http://x/a.mp3', makeEnv())
    handle.cancel()
    expect(handle.isPending()).toBe(false)
    expect(handle.isBusy()).toBe(false)
  })
})

describe('重试退避', () => {
  it('失败 ⇒ 1200 + n×600，最多 3 次', async () => {
    const env = makeEnv()
    scheduleBeatAnalysis('http://x/a.mp3', env)
    await vi.advanceTimersByTimeAsync(BEAT_ANALYSIS_CONFIG.delayMs)
    expect(analyze).toHaveBeenCalledTimes(1)
    // ★ 每次推进都要留足时间让**整条重排链**走完：
    //   `.then` → `queue(1200)` → `waitForQuietStart`（复查播放进度）
    //   → `scheduleAnalysisTask` → 下一次 `analyzeAudioBeats`。
    //   观察到的规律：排 1200ms 后，还要再等一小段才真正发起下一次
    //   （复查那一跳不耗时，但微任务要在定时器回调里排到）⇒ 给足余量。
    await vi.advanceTimersByTimeAsync(2600)
    expect(analyze, '第 1 次失败后应重试').toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3600)
    expect(analyze, '第 2 次失败后应再重试').toHaveBeenCalledTimes(3)
    // 第 3 次失败 ⇒ attempts 已达 3，不再排
    await vi.advanceTimersByTimeAsync(120000)
    expect(analyze, '最多 3 次尝试').toHaveBeenCalledTimes(3)
  })

  it('抛异常同样计入尝试', async () => {
    analyze.mockImplementation(async () => {
      throw new Error('boom')
    })
    const env = makeEnv()
    scheduleBeatAnalysis('http://x/a.mp3', env)
    await vi.advanceTimersByTimeAsync(BEAT_ANALYSIS_CONFIG.delayMs)
    await vi.advanceTimersByTimeAsync(1200)
    await vi.advanceTimersByTimeAsync(1800)
    await vi.advanceTimersByTimeAsync(60000)
    expect(analyze).toHaveBeenCalledTimes(3)
  })
})

describe('成功交接', () => {
  it('拿到拍点图 ⇒ 调 onMap，且带同一个 token', async () => {
    const map = { duration: 10, tempoSource: 'music-tempo' as const } as unknown as BeatMap
    analyze.mockImplementation(async () => map)
    const env = makeEnv()
    scheduleBeatAnalysis('http://x/a.mp3', env, { name: '测试歌' })
    await vi.advanceTimersByTimeAsync(BEAT_ANALYSIS_CONFIG.delayMs)
    expect(env.onMap).toHaveBeenCalledTimes(1)
    expect(env.onMap).toHaveBeenCalledWith(map, 1)
    // 成功后不再重排
    await vi.advanceTimersByTimeAsync(60000)
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('传下去的 song 用于歌名剖面判断', async () => {
    // 只关心 options 的传递，拍点图内容用空壳即可
    analyze.mockImplementation(async () => ({ duration: 1 }) as unknown as BeatMap)
    const env = makeEnv()
    scheduleBeatAnalysis('http://x/a.mp3', env, { name: '日落大道' })
    await vi.advanceTimersByTimeAsync(BEAT_ANALYSIS_CONFIG.delayMs)
    expect(analyze).toHaveBeenCalledWith(
      'http://x/a.mp3',
      1,
      env.isCurrent,
      expect.objectContaining({ song: { name: '日落大道' }, background: true }),
    )
  })
})
