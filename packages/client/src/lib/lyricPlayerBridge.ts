import type { LyricPlayerBase } from '@applemusic-like-lyrics/core'

let player: LyricPlayerBase | null = null
let offsetMs = 0

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
    player?.setCurrentTime(toLyricTime(timeSeconds), isSeeking)
  },

  seek(timeSeconds: number, behavior: LyricSeekBehavior = 'immediate'): void {
    if (!player) return
    player.resetScroll()
    player.setCurrentTime(toLyricTime(timeSeconds), true)
    const immediate = behavior === 'immediate'
    void player.calcLayout(immediate, immediate)
  },
}
