import { useEffect } from 'react'
import { EVENTS, modeNeedsBeatGrid } from '@music-together/shared'
import { getSocket } from '@/lib/socket'
import { predictNextTrack } from '@/lib/nextTrack'
import { analyseTrackUrl, hasProfileBeenReported, markProfileReported, profilePrefetchLeadSec } from '@/lib/automix/profileClient'
import { resolveTrackUrl, trackCacheKey } from '@/lib/playbackSource'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'

/**
 * 只有 id 最小的在线设备跑整曲分析：结果经服务端共享给全体，
 * 其余设备不必各自解码同一首歌。成员变化时下一次 tick 自动重新选主。
 */
const isAnalysisLeader = (users: { id: string }[]): boolean => {
  if (users.length <= 1) return true
  const selfId = useRoomStore.getState().currentUser?.id
  if (!selfId) return false
  return users.every((user) => user.id >= selfId)
}

/** 分析失败后的冷却：暂停时窗口会一直开着，不能每 3 秒重试一次。 */
const FAILURE_COOLDOWN_MS = 60_000

/**
 * 自动混音需要当前曲与下一首的画像。当前曲通常由拍点分析顺手上报；
 * 下一首没有拍点分析，在这里补。房间关闭自动混音时完全不跑。
 */
export function useAutomixProfilePrefetch(): void {
  useEffect(() => {
    let disposed = false
    let busy = false
    const failed = new Map<string, number>()

    const tick = async (): Promise<void> => {
      if (disposed || busy) return
      const room = useRoomStore.getState().room
      if (!room?.automixEnabled) return
      if (!modeNeedsBeatGrid(room.transitionMode ?? 'automix')) return
      if (!isAnalysisLeader(room.users)) return
      const { currentTime, duration } = usePlayerStore.getState()
      const remaining = duration - currentTime
      if (!Number.isFinite(remaining) || remaining > profilePrefetchLeadSec()) return

      const current = room.currentTrack
      const next = predictNextTrack(room)
      const target =
        next && next.id !== current?.id && !hasProfileBeenReported(next.id)
          ? next
          : current && !hasProfileBeenReported(current.id)
            ? current
            : null
      if (!target) return
      const retryAt = failed.get(target.id)
      if (retryAt !== undefined && performance.now() - retryAt < FAILURE_COOLDOWN_MS) return

      busy = true
      try {
        const url = await resolveTrackUrl(target)
        if (!url || disposed) return
        const trackKey = trackCacheKey(target)
        const profile = await analyseTrackUrl(url, trackKey, target.duration)
        if (!profile || disposed) {
          failed.set(target.id, performance.now())
          return
        }
        markProfileReported(target.id)
        getSocket().emit(EVENTS.PLAYER_TRACK_PROFILE, { trackId: target.id, profile })
      } finally {
        busy = false
      }
    }

    const interval = setInterval(() => void tick(), 3000)
    void tick()
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [])
}
