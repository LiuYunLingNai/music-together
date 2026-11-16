import { useEffect } from 'react'
import type { Howl } from 'howler'
import type { MutableRefObject } from 'react'
import { toast } from 'sonner'
import { usePlayerStore } from '@/stores/playerStore'
import { SLEEP_TIMER_FADE_MS, useSleepTimerStore } from '@/stores/sleepTimerStore'

/**
 * 睡眠定时器：到期后本机淡出并停止，不向服务端发暂停 —— 房间其他人不受影响。
 *
 * 停止后置 `localHold`，`schedulePlayback` 会拒绝服务端随后下发的恢复播放，
 * 直到用户自己按播放/切歌/拖动进度（见 `usePlayer` 的控件）。
 */
export function useSleepTimer(
  howlRef: MutableRefObject<Howl | null>,
  pausePlayback: (position: number) => void,
): void {
  useEffect(() => {
    return () => {
      const state = useSleepTimerStore.getState()
      state.disarm()
      state.clearLocalHold()
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const state = useSleepTimerStore.getState()
      if (state.deadlineMs === null || Date.now() < state.deadlineMs) return
      state.disarm()

      const howl = howlRef.current
      const previousVolume = howl?.volume() ?? 1
      if (howl) howl.fade(previousVolume, 0, SLEEP_TIMER_FADE_MS)

      window.setTimeout(() => {
        const current = howlRef.current
        const position = current?.seek() ?? usePlayerStore.getState().currentTime
        pausePlayback(typeof position === 'number' ? position : usePlayerStore.getState().currentTime)
        // 恢复应用层音量，下一次播放不会因为淡出停在 0。
        if (current) current.volume(previousVolume)
        useSleepTimerStore.getState().holdLocalPlayback()
        toast.info('睡眠定时器已停止本机播放')
      }, SLEEP_TIMER_FADE_MS)
    }, 1000)

    return () => clearInterval(timer)
  }, [howlRef, pausePlayback])
}
