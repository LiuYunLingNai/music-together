import { useSocketContext } from '@/providers/socket-context'
import { resetAllRoomState } from '@/lib/resetStores'
import { stopActiveAudio } from '@/lib/audioPlaybackLifecycle'
import { OFFLINE_GRACE_MS, armPlaybackReattach, disarmPlaybackReattach } from '@/lib/playbackContinuity'
import { storage } from '@/lib/storage'
import { useRoomStore } from '@/stores/roomStore'
import { EVENTS } from '@music-together/shared'
import { useEffect } from 'react'

/** 重新加入后等待服务端回放的最长时间。 */
const REATTACH_DISARM_MS = 15_000

/**
 * 断线时保留房间与播放，只在宽限期内等待重连：
 * - 音频元素与已缓冲的数据不依赖 WebSocket，网络抖动期间继续播放。
 * - 连接恢复后用重连令牌重新加入，服务端回放的状态再把本机接回时间线。
 * - 超过宽限期仍未恢复，才停止播放并重置全部房间状态。
 */
export function useConnectionGuard() {
  const { socket } = useSocketContext()

  useEffect(() => {
    let offline = false
    let graceTimer: ReturnType<typeof setTimeout> | null = null
    let disarmTimer: ReturnType<typeof setTimeout> | null = null

    const clearGrace = () => {
      if (graceTimer) clearTimeout(graceTimer)
      graceTimer = null
    }
    const clearDisarm = () => {
      if (disarmTimer) clearTimeout(disarmTimer)
      disarmTimer = null
    }

    const hardReset = () => {
      clearGrace()
      clearDisarm()
      offline = false
      disarmPlaybackReattach()
      stopActiveAudio()
      resetAllRoomState()
    }

    const onDisconnect = () => {
      // 重连失败的每次尝试都会再触发一次断线事件，只在第一次开始计时。
      if (offline) return
      if (!useRoomStore.getState().room) {
        hardReset()
        return
      }
      offline = true
      armPlaybackReattach()
      graceTimer = setTimeout(hardReset, OFFLINE_GRACE_MS)
    }

    const onConnect = () => {
      if (!offline) return
      clearGrace()
      offline = false
      const room = useRoomStore.getState().room
      const nickname = storage.getNickname()
      if (!room || !nickname) {
        hardReset()
        return
      }
      // 重新加入若没有带回曲目回放，保留标记不能留给日后无关的同曲回放。
      clearDisarm()
      disarmTimer = setTimeout(disarmPlaybackReattach, REATTACH_DISARM_MS)
      socket.emit(EVENTS.ROOM_JOIN, {
        roomId: room.id,
        nickname,
        rejoinToken: storage.getRejoinToken(room.id) ?? undefined,
      })
    }

    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)

    return () => {
      clearGrace()
      clearDisarm()
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
    }
  }, [socket])
}
