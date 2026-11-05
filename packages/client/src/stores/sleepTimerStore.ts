import { create } from 'zustand'

const STORAGE_KEY = 'mt-sleep-timer'
const MAX_MINUTES = 12 * 60

interface SleepTimerState {
  /** 首选时长（分钟），持久化；0 表示未设置。 */
  durationMinutes: number
  /** 本次到期的绝对时间；一次性，不持久化。 */
  deadlineMs: number | null
  /** 到期后本机保持停止，直到用户主动恢复播放。 */
  localHold: boolean
}

const clampMinutes = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(MAX_MINUTES, Math.round(parsed))
}

const readDuration = (): number => {
  if (typeof window === 'undefined') return 0
  try {
    return clampMinutes(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 0
  }
}

const persistDuration = (minutes: number): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, String(minutes))
  } catch {
    // 存储被禁用时保持内存态即可。
  }
}

interface SleepTimerStore extends SleepTimerState {
  setDurationMinutes: (minutes: number) => void
  arm: () => void
  disarm: () => void
  holdLocalPlayback: () => void
  clearLocalHold: () => void
}

export const useSleepTimerStore = create<SleepTimerStore>((set, get) => ({
  durationMinutes: readDuration(),
  deadlineMs: null,
  localHold: false,
  setDurationMinutes: (minutes) => {
    const next = clampMinutes(minutes)
    persistDuration(next)
    set({ durationMinutes: next })
    if (next === 0) set({ deadlineMs: null })
  },
  arm: () => {
    const minutes = get().durationMinutes
    if (minutes <= 0) return
    set({ deadlineMs: Date.now() + minutes * 60_000, localHold: false })
  },
  disarm: () => set({ deadlineMs: null }),
  holdLocalPlayback: () => set({ localHold: true }),
  clearLocalHold: () => set({ localHold: false }),
}))

export const SLEEP_TIMER_FADE_MS = 6000
