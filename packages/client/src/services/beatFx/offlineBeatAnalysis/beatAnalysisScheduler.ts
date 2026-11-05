/**
 * 离线分析调度器 —— 上游 `scheduleBeatAnalysis`
 * （`03-beat/00-tempo-worker-cache-prefetch.js:195-262`）的忠实移植。
 *
 * ## 它做什么
 *
 * 分析**不能**在切歌瞬间就开始：那时音频刚起播，`fetch` + `decode` 会与
 * 播放抢带宽与主线程。上游的做法是等一小段：
 *
 *   ① 先等 `delayMs`（1600ms）—— 让起播稳定；
 *   ② 再看播放进度够不够 `minPlaybackSec`（1.2s）—— 不够就按差额再排一次；
 *   ③ 播放中暂停了就重新排（`queueCurrentTrackAnalysis(620)`）——
 *      暂停时分析没有意义（没有新的拍点要看）；
 *   ④ 真正跑的时候走 `requestIdleCallback`（`idleTimeout` 1400ms）——
 *      空闲才跑，不与渲染抢帧；
 *   ⑤ 失败重排，最多 3 次，退避 `1200 + n×600` ms。
 *
 * ## 移植时剔除的部分
 *
 * · `readBeatDiskCache`（磁盘缓存）—— 本项目无 `/api/beatmap/cache` 后端。
 * · `beatMapCache[songId]` 的命中分支 —— 同上，没有缓存可命中。
 *   （代次判据 `token !== beatMapToken` 保留，那是**正确性**的一部分。）
 * · `hideBeatChip` / toast —— 上游的"节奏缓冲中…"气泡 UI，本项目无此控件。
 * · `beatMapBusy` 的等 420ms 重排 —— 上游用它避免两次分析并发。本项目
 *   的分析入口只有这一处（无队列预取），用 `busy` 布尔量等价保证。
 *
 * ★ `djMode.active` 分支剔除：出厂恒 false（`03-beat-dj-state.js:87`）。
 */

import { analyzeAudioBeats } from './analyzeAudioBeats'
import type { BeatMap } from './beatAnalysisTypes'

/** 共享缓存：切舞台 / 两个消费方同时要同一首时不重复分析。 */
const BEAT_MAP_CACHE_LIMIT = 8
const BEAT_MAP_PENDING_TIMEOUT_MS = 120_000
const beatMapCache = new Map<string, BeatMap>()
interface PendingBeatMapListener {
  token: number
  isCurrent: (token: number) => boolean
  onMap: (map: BeatMap, token: number) => void
}
interface PendingBeatMap {
  listeners: Set<PendingBeatMapListener>
  cancelOwner: () => void
}
const beatMapPending = new Map<string, PendingBeatMap>()

const cacheBeatMap = (key: string, map: BeatMap): void => {
  beatMapCache.delete(key)
  beatMapCache.set(key, map)
  while (beatMapCache.size > BEAT_MAP_CACHE_LIMIT) {
    const oldest = beatMapCache.keys().next().value
    if (oldest === undefined) break
    beatMapCache.delete(oldest)
  }
}

/** 已完成的拍点图；供舞台切换时直接复用。 */
export const getCachedBeatMap = (key: string): BeatMap | null => beatMapCache.get(key) ?? null

/** 单测/退出登录时清空共享缓存。 */
export const clearBeatMapCache = (): void => {
  beatMapCache.clear()
  for (const pending of beatMapPending.values()) pending.cancelOwner()
  beatMapPending.clear()
}

/** 上游 `beatAnalysisConfig`（`00-state/03-beat-dj-state.js:29-34`）。 */
export const BEAT_ANALYSIS_CONFIG = {
  /** 切歌后先等这么久再开始（ms）。 */
  delayMs: 1600,
  /** 至少要播放到这么久才分析（秒）—— 起播瞬间不分析。 */
  minPlaybackSec: 1.2,
  /** `requestIdleCallback` 的超时（ms）。 */
  idleTimeout: 1400,
  /** 上游 `skipMusicTempoWhilePlaying` 出厂 false ⇒ 播放中也跑 music-tempo。 */
  skipMusicTempoWhilePlaying: false,
} as const

/** 上游 `scheduleAnalysisTask`（`01-scene/02-beat-camera-runtime.js:306-317`）。 */
function scheduleAnalysisTask(fn: () => void, timeout: number): void {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  // 上游：后台隐藏时**不**等空闲，直接 `setTimeout(fn, 0)` ——
  // 用户看不见，没必要占着 idle 队列。
  if (hidden) {
    setTimeout(fn, 0)
    return
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: timeout || 900 })
  } else {
    setTimeout(fn, Math.min(timeout || 420, 420))
  }
}

/** 调度器需要的外部状态 —— 由 `beatCamera` 侧提供（上游读全局）。 */
export interface BeatAnalysisEnv {
  /** 切歌代次（上游 `beatMapToken`）。 */
  token: number
  /** 当前播放时刻（秒）。上游 `audio.currentTime`。 */
  currentTime: () => number
  /** 是否正在播放（上游 `!audio.paused`）。 */
  isPlaying: () => boolean
  /** 是否仍在当前代次（上游 `token !== beatMapToken` 的封装）。 */
  isCurrent: (token: number) => boolean
  /** 分析完成 ⇒ 交接拍点图。 */
  onMap: (map: BeatMap, token: number) => void
}

/**
 * `scheduleBeatAnalysis` 的返回值 —— 取消函数 + 两个状态探针。
 *
 * `isBusy` / `isPending` 对应上游的 `beatMapBusy` / `beatAnalysisTimer`
 * （`11-main-loop.js:414` 的 `waitingForBeatMap` 读它们）。
 */
export interface BeatAnalysisHandle {
  /** 放弃本次分析（切歌/卸载时调）。 */
  cancel: () => void
  /** 分析正在跑。 */
  isBusy: () => boolean
  /** 已排程但还没开跑。 */
  isPending: () => boolean
}

/**
 * 排一次分析。
 *
 * 上游每次切歌都调 `scheduleBeatAnalysis(songId, audioUrl, token, song)`；
 * 这里签名去掉 `songId`（无磁盘缓存 ⇒ 不需要按歌去重），保留
 * `audioUrl` / `token` / `song`（`song` 只喂 `cinemaAnalysisProfileForSong`）。
 *
 * @param audioUrl 与播放同一份 URL
 * @param env 见 `BeatAnalysisEnv`
 * @param song 歌名信息，仅用于 `cinemaAnalysisProfileForSong` 的歌名判断
 */
function scheduleBeatAnalysisUncached(
  audioUrl: string,
  env: BeatAnalysisEnv,
  song?: { name?: string; title?: string; artist?: string } | null,
): BeatAnalysisHandle {
  const { token } = env
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let busy = false
  let cancelled = false

  function cancel(): void {
    if (timer) clearTimeout(timer)
    timer = null
  }

  /** 上游 `queueCurrentTrackAnalysis(delay)`。 */
  function queue(delay: number): void {
    if (cancelled) return
    // 代次变了 ⇒ 这首歌不用分析了（上游 `token !== beatMapToken`）
    if (!env.isCurrent(token)) return
    cancel()
    // 上游 `Math.max(120, Number(delay) || 0)` —— 防止 0/NaN 造成同步递归
    timer = setTimeout(waitForQuietStart, Math.max(120, Number(delay) || 0))
  }

  function waitForQuietStart(): void {
    timer = null
    if (cancelled || !env.isCurrent(token)) return
    if (!env.isPlaying()) {
      // 暂停 ⇒ 等播放恢复（上游同样排 620ms 再看）
      queue(620)
      return
    }
    const current = env.currentTime()
    if (current < BEAT_ANALYSIS_CONFIG.minPlaybackSec) {
      queue(Math.max(500, (BEAT_ANALYSIS_CONFIG.minPlaybackSec - current) * 1000))
      return
    }
    scheduleAnalysisTask(startAnalysis, BEAT_ANALYSIS_CONFIG.idleTimeout)
  }

  function startAnalysis(): void {
    if (cancelled || !env.isCurrent(token)) return
    if (!env.isPlaying()) {
      queue(620)
      return
    }
    if (busy) {
      // 上游等 420ms 再看（无磁盘缓存，这里只保留并发保护）
      queue(420)
      return
    }
    attempts++
    busy = true
    analyzeAudioBeats(audioUrl, token, env.isCurrent, {
      // 上游 `skipMusicTempoWhilePlaying && !audio.paused`；出厂 false ⇒ 恒 false
      skipMusicTempo: BEAT_ANALYSIS_CONFIG.skipMusicTempoWhilePlaying && !env.isPlaying(),
      background: true,
      song: song || null,
    })
      .then((map) => {
        busy = false
        if (cancelled || !env.isCurrent(token)) return
        if (!map) {
          if (attempts < 3) queue(1200 + attempts * 600)
          return
        }
        env.onMap(map, token)
      })
      .catch((err) => {
        busy = false
        console.warn('scheduled beat analysis failed:', err)
        if (!cancelled && env.isCurrent(token) && attempts < 3) queue(1200 + attempts * 600)
      })
  }

  queue(BEAT_ANALYSIS_CONFIG.delayMs)
  return {
    cancel: () => {
      cancelled = true
      cancel()
    },
    isBusy: () => busy,
    isPending: () => timer !== null,
  }
}

/**
 * 共享入口：同一份音频 URL 只分析一次。
 *
 * Mineradio 的 `beatCamera` 与 Folia 的 `beatFxSource` 原本各自调度；
 * 切舞台时第一方取消、第二方从头分析，既慢又浪费。这里按音频 URL
 * 缓存结果，并把并发请求挂到同一次分析上。取消只解除自己的订阅，
 * 最后一个订阅者退出时才取消底层分析。
 */
export function scheduleBeatAnalysis(
  audioUrl: string,
  env: BeatAnalysisEnv,
  song?: { name?: string; title?: string; artist?: string } | null,
): BeatAnalysisHandle {
  const key = audioUrl
  const cached = getCachedBeatMap(key)
  if (cached) {
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled && env.isCurrent(env.token)) env.onMap(cached, env.token)
    }, 0)
    return {
      cancel: () => {
        cancelled = true
        clearTimeout(timer)
      },
      isBusy: () => false,
      isPending: () => false,
    }
  }

  const existing = beatMapPending.get(key)
  if (existing) {
    const listener: PendingBeatMapListener = {
      token: env.token,
      isCurrent: env.isCurrent,
      onMap: env.onMap,
    }
    existing.listeners.add(listener)
    return {
      cancel: () => {
        existing.listeners.delete(listener)
        if (existing.listeners.size === 0) {
          existing.cancelOwner()
          if (beatMapPending.get(key) === existing) beatMapPending.delete(key)
        }
      },
      isBusy: () => false,
      isPending: () => true,
    }
  }

  const listeners = new Set<PendingBeatMapListener>()
  const listener: PendingBeatMapListener = {
    token: env.token,
    isCurrent: env.isCurrent,
    onMap: env.onMap,
  }
  listeners.add(listener)
  const pending: PendingBeatMap = { listeners, cancelOwner: () => {} }
  beatMapPending.set(key, pending)

  let settleTimer: ReturnType<typeof setTimeout> | null = null
  const finish = (map: BeatMap): void => {
    cacheBeatMap(key, map)
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    if (beatMapPending.get(key) === pending) beatMapPending.delete(key)
    for (const current of [...listeners]) {
      if (!current.isCurrent(current.token)) continue
      try {
        current.onMap(map, current.token)
      } catch (err) {
        console.warn('shared beat analysis listener failed:', err)
      }
    }
  }

  const owner = scheduleBeatAnalysisUncached(
    audioUrl,
    {
      ...env,
      onMap: (map) => finish(map),
    },
    song,
  )
  pending.cancelOwner = owner.cancel
  settleTimer = setTimeout(() => {
    if (beatMapPending.get(key) !== pending) return
    beatMapPending.delete(key)
    owner.cancel()
  }, BEAT_MAP_PENDING_TIMEOUT_MS)

  return {
    cancel: () => {
      listeners.delete(listener)
      if (listeners.size > 0) return
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      if (beatMapPending.get(key) === pending) beatMapPending.delete(key)
      owner.cancel()
    },
    isBusy: owner.isBusy,
    isPending: owner.isPending,
  }
}
