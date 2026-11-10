import type { Track } from '@music-together/shared'
import { getServerTime } from '@/lib/clockSync'
import { mapTrackHandoffProgress } from './handoffCurve'

/**
 * 宿主版上游 `transitionCue.ts`：`plain` 标记与 `shouldDrawCue` 的判定保持
 * 一致；只有时钟换成服务端时间 —— 房间内每台设备按同一个 `startsAt` 推进，
 * 画面与音频同源。
 *
 * 广播只是提醒，`getActiveTransitionCue` 才是事实：过渡中途挂载的渲染器
 * 直接问它，不依赖自己是否收到了那一次广播。
 */
export interface TransitionCue {
  /** 入歌。 */
  incoming: Track | null
  fromTrackId: string
  /** 过渡开始的服务端时间（毫秒）。 */
  startsAt: number
  /** 从开始到混合结束的墙钟秒数。 */
  seconds: number
  /** 两侧在音频里换手的位置（0..1）。 */
  crossover: number
  /** 出歌每拍的墙钟秒数；没有测到速度时为 null。 */
  periodSec: number | null
  /**
   * 纯淡化而不是混音。对齐类渲染器仍然需要它。
   */
  plain?: true
}

type Listener = () => void

let cue: TransitionCue | null = null
const listeners = new Set<Listener>()

const emit = (): void => {
  for (const listener of listeners) listener()
}

export const announceTransition = (next: TransitionCue): void => {
  cue = next
  emit()
}

/** 只清掉自己那次过渡，避免新过渡被旧定时器抹掉。 */
export const settleTransition = (startsAt: number): void => {
  if (cue?.startsAt !== startsAt) return
  cue = null
  emit()
}

/** 进行中的过渡；自己的时钟走完就当作结束，晚挂载不会画一个已经结束的过渡。 */
export const getActiveTransitionCue = (): TransitionCue | null => {
  if (!cue) return null
  if (transitionElapsedSec(cue) >= cue.seconds) return null
  return cue
}

export const subscribeTransitionCue = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 过渡已走过的秒数；调用方按帧读取。 */
export const transitionElapsedSec = (cue: TransitionCue): number =>
  Math.max(0, (getServerTime() - cue.startsAt) / 1000)

/** 屏幕上交接走到了哪里（0..1），走 `handoffProgress` 的同一条曲线。 */
export const getTransitionHandoffProgress = (active = getActiveTransitionCue()): number => {
  if (!active) return 0
  if (!(active.seconds > 0)) return 1
  return mapTrackHandoffProgress(
    transitionElapsedSec(active) / active.seconds,
    active.crossover,
  )
}

/** 短于这个长度的淡化不值得提示：一闪而过反而更吵。 */
export const MIN_HINT_SECONDS = 1

/** 过渡提示是否该画：纯淡化也算过渡，只要长到看得见。 */
export const shouldDrawCue = (cue: TransitionCue, switchedOn: boolean): boolean =>
  switchedOn && cue.seconds >= MIN_HINT_SECONDS
