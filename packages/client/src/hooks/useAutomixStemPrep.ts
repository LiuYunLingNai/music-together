import { useEffect } from 'react'
import { modeNeedsBeatGrid } from '@music-together/shared'
import { predictNextTrack } from '@/lib/nextTrack'
import { getPendingAutomixPlan } from '@/lib/playbackTransition'
import { clearStemPlans, prepareStemTransition, stemPrepLeadSec } from '@/lib/automix/stemDeck'
import { canStartStemPrep } from '@/lib/automix/stemCapabilities'
import { resolveTrackUrl } from '@/lib/playbackSource'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'

/** 与服务端 `automixService` 相同的档位规则：默认 5 s，短曲最多让出四分之一。 */
export const automixOverlapSec = (duration: number): number => {
  if (!Number.isFinite(duration) || duration <= 1.6) return 0
  return Math.min(Math.max(Math.min(5, duration * 0.25), 0.8), 25)
}

/**
 * 单人房 + 自动混音时提前分离过渡窗口的四轨。房间里有第二个听众就自动停用：
 * 分轨只改善本机听感，却要让每台设备都跑一遍 WebGPU 分析，不划算。
 */
export function useAutomixStemPrep(): void {
  useEffect(() => {
    let disposed = false
    let preparedKey = ''
    let preparedAt = 0
    /** 准备失败后不要每 2s 重试一次；同一次过渡最多 5s 后再试。 */
    const PREPARE_RETRY_MS = 5_000
    const clearPrepared = (): void => {
      clearStemPlans()
      preparedKey = ''
      preparedAt = 0
    }

    const tick = (): void => {
      if (disposed) return
      // 上游 `canSeparateStems()` 的宿主版：没开真实分轨、浏览器没有 WebGPU、
      // 或模型已永久失败时，不再为过渡分离分轨（也避免静默下载 92 MB 权重）。
      if (!canStartStemPrep()) {
        clearPrepared()
        return
      }
      const room = useRoomStore.getState().room
      if (!room?.automixEnabled || !modeNeedsBeatGrid(room.transitionMode ?? 'automix') || room.users.length > 1) {
        clearPrepared()
        return
      }
      const { currentTime, duration, isPlaying } = usePlayerStore.getState()
      if (!isPlaying || !room.playState.isPlaying) return
      const current = room.currentTrack
      const next = predictNextTrack(room)
      if (!current || !next || next.id === current.id) return
      const remaining = duration - currentTime
      // 分轨只服务服务端已经排好的过渡：本地估的落点不会随 PLAYER_PLAY 下发，
      // 提前分离也永远不会被消费，白跑一趟 WebGPU。
      const plan = getPendingAutomixPlan()
      const planned =
        plan && plan.fromTrackId === current.id && plan.toTrackId === next.id ? plan : null
      if (!planned) return
      const overlap = planned.overlapMs / 1000
      if (overlap <= 0) return
      // 硬切只有几十毫秒，没有可供分轨交接的窗口。
      if (planned.style === 'beatCut') return
      if (!Number.isFinite(remaining) || remaining > stemPrepLeadSec()) return
      if (remaining <= overlap + 1) return

      const key = `${current.id}->${next.id}@${overlap.toFixed(2)}@${planned.expansion ?? 0}`
      if (preparedKey === key && Date.now() - preparedAt < PREPARE_RETRY_MS) return
      preparedKey = key
      preparedAt = Date.now()

      void (async () => {
        const [outUrl, inUrl] = await Promise.all([resolveTrackUrl(current), resolveTrackUrl(next)])
        if (!outUrl || !inUrl || disposed) return
        await prepareStemTransition({
          outgoing: current,
          outgoingUrl: outUrl,
          outgoingStartSec: Math.max(0, planned.outStartMs / 1000),
          incoming: next,
          incomingUrl: inUrl,
          incomingStartSec: planned.inStartMs / 1000,
          overlapSec: overlap,
          expansion: planned.expansion ?? null,
          beatsPerBar: planned.outgoingBeatsPerBar ?? 4,
          gesture: {
            outgoingBarSec: planned.outgoingBarSec ?? null,
            incomingBarSec: planned.incomingBarSec ?? null,
            outgoingDownbeatOffset: planned.outgoingDownbeatOffset ?? null,
            keysClash: planned.relation === 'clashing',
            incomingSectionStart: planned.incomingSectionStart ?? null,
          },
        })
      })()
    }

    const interval = setInterval(tick, 2000)
    tick()
    return () => {
      disposed = true
      clearInterval(interval)
      clearStemPlans()
    }
  }, [])
}
