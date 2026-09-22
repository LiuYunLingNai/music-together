import type { LyricPlayerBase } from '@applemusic-like-lyrics/core'

let player: LyricPlayerBase | null = null
let offsetMs = 0

/**
 * 逐帧播放位置（秒）—— WebGL 歌词舞台的时钟。
 *
 * ★ 为什么需要它：`usePlayerStore.currentTime` 被 `useHowl` 按
 *   `CURRENT_TIME_THROTTLE_MS = 100` 节流（10Hz），而 AMLL 走的是
 *   **每帧**的 `setCurrentTime`（`useHowl.ts:85`）。WebGL 歌词若读 store，
 *   逐字填充会按 ~100ms 离散跳变、激活行切换最多滞后 100ms ——
 *   同一首歌切到经典播放器就变顺滑，是肉眼可见的不一致。
 *
 * 这里由 `useHowl` 的既有 rAF 循环顺手写入（**只读旁路**，不改变播放语义、
 * 不新增定时器、不参与 seek/同步），WebGL 歌词在 `useFrame` 里读取。
 * `-1` 表示尚无有效值，消费方应回退到 store。
 */
let frameTimeSeconds = -1
/** 逐帧时钟的写入时刻（`performance.now()`），用于判断新鲜度。 */
let frameTimeStamp = 0

/**
 * 逐帧时钟的新鲜度窗口（毫秒）。
 *
 * 播放中 rAF 每帧都写（~16ms），远小于本窗口；暂停后 rAF 停止，
 * 超过本窗口即判定为陈旧并回退到 store —— 这样"暂停时拖动进度条"
 * 也能立刻反映到 WebGL 歌词（那条路径只更新 store）。
 */
const FRAME_TIME_FRESH_MS = 250

const toLyricTime = (timeSeconds: number) => Math.max(0, Math.round(timeSeconds * 1000 - offsetMs))
export type LyricSeekBehavior = 'immediate' | 'smooth'

export const lyricPlayerBridge = {
  attach(nextPlayer: LyricPlayerBase): () => void {
    player = nextPlayer
    return () => {
      if (player === nextPlayer) player = null
    }
  },

  setOffset(nextOffsetMs: number): void {
    offsetMs = Number.isFinite(nextOffsetMs) ? nextOffsetMs : 0
  },

  setCurrentTime(timeSeconds: number, isSeeking = false): void {
    if (Number.isFinite(timeSeconds)) {
      frameTimeSeconds = Math.max(0, timeSeconds)
      frameTimeStamp = performance.now()
    }
    player?.setCurrentTime(toLyricTime(timeSeconds), isSeeking)
  },

  /**
   * 读取最近一次逐帧播放位置（秒）。
   *
   * 仅在**新鲜**时返回（见 `FRAME_TIME_FRESH_MS`）；否则返回 `null`，
   * 消费方回退到 `usePlayerStore.currentTime`。
   */
  getFrameTime(): number | null {
    if (frameTimeSeconds < 0) return null
    if (performance.now() - frameTimeStamp > FRAME_TIME_FRESH_MS) return null
    return frameTimeSeconds
  },

  /** 播放停止/卸载时清空，避免下次进入舞台读到上一首的时间。 */
  clearFrameTime(): void {
    frameTimeSeconds = -1
    frameTimeStamp = 0
  },

  seek(timeSeconds: number, behavior: LyricSeekBehavior = 'immediate'): void {
    if (!player) return
    player.resetScroll()
    player.setCurrentTime(toLyricTime(timeSeconds), true)
    const immediate = behavior === 'immediate'
    void player.calcLayout(immediate, immediate)
  },
}
