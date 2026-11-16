import type { Howl } from 'howler'
import { setHowlPosition } from './howlPosition'
import { duckHowlGraph, setHowlGraphMuted } from './timeStretch'

const DUCK_RAMP_SEC = 0.012
const UNDUCK_RAMP_SEC = 0.02
const UNDUCK_FALLBACK_MS = 400
const pendingDuck = new WeakMap<Howl, () => void>()

/**
 * 播放中定位：先在音频图增益上淡出 12ms 再跳，跳完（seeked，或 400ms 兜底）淡入，
 * 波形不再在断点处直接切开。只动图增益、不碰元素音量，兜底定时器保证一定恢复。
 * 图不可用或已被其他流程静音时退回直接定位。
 */
export function setHowlPositionSmooth(howl: Howl, targetTime: number, soundId?: number): void {
  pendingDuck.get(howl)?.()
  if (!howl.playing(soundId) || !duckHowlGraph(howl, DUCK_RAMP_SEC)) {
    setHowlPosition(howl, targetTime, soundId)
    return
  }
  const node = (howl as unknown as { _sounds?: Array<{ _node?: HTMLMediaElement }> })._sounds?.[0]?._node
  let finished = false
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(seekTimer)
    clearTimeout(fallbackTimer)
    node?.removeEventListener('seeked', finish)
    if (pendingDuck.get(howl) === finish) pendingDuck.delete(howl)
    setHowlGraphMuted(howl, false, UNDUCK_RAMP_SEC)
  }
  pendingDuck.set(howl, finish)
  const seekTimer = setTimeout(() => {
    if (finished) return
    node?.addEventListener('seeked', finish, { once: true })
    fallbackTimer = setTimeout(finish, UNDUCK_FALLBACK_MS)
    setHowlPosition(howl, targetTime + DUCK_RAMP_SEC, soundId)
  }, DUCK_RAMP_SEC * 1000)
}
