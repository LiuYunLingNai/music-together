import { useEffect, useRef } from 'react'
import { EVENTS } from '@music-together/shared'
import { getSocket } from '@/lib/socket'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'

/** 服务端 planner 只需要行级起止；词级时间轴不参与过渡决策。 */
const MAX_LINES = 1200

/**
 * 把当前曲的歌词时间线上报给服务端。上游 `transitionPlanner` 用最后一句
 * 人声结束时刻证明「无人声窗口」，宿主服务端本身没有歌词，只能由客户端
 * 提供这份证据。
 */
export function useAutomixLyricEvidence(): void {
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null)
  const lines = usePlayerStore((state) => state.ttmlLines)
  const automixEnabled = useRoomStore(
    (state) => state.room?.automixEnabled === true && (state.room.transitionMode ?? 'automix') === 'automix',
  )
  const sentKeyRef = useRef('')

  useEffect(() => {
    if (!automixEnabled || !trackId || !lines?.length) return
    const compact = lines
      .slice(0, MAX_LINES)
      .map((line) => {
        const fullText = (line.words ?? []).map((word) => word.word ?? '').join('')
        return {
          startTime: line.startTime / 1000,
          endTime: line.endTime / 1000,
          fullText: fullText.slice(0, 200),
        }
      })
      .filter((line) => line.endTime > line.startTime)
    if (!compact.length) return
    const key = `${trackId}:${compact.length}:${compact[0]!.startTime}:${compact[compact.length - 1]!.endTime}`
    if (sentKeyRef.current === key) return
    sentKeyRef.current = key
    getSocket().emit(EVENTS.PLAYER_TRACK_LINES, { trackId, lines: compact })
  }, [automixEnabled, trackId, lines])
}
