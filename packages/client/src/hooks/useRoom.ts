import { useSocketContext } from '@/providers/socket-context'
import { resetAllRoomState } from '@/lib/resetStores'
import { clearAudioBytes } from '@/lib/audioBytes'
import { clearPrefetchCache } from '@/lib/prefetchService'
import { storage } from '@/lib/storage'
import { EVENTS } from '@music-together/shared'
import { useCallback } from 'react'
import { useRoomStore } from '@/stores/roomStore'

import { useRoomState } from './room/useRoomState'
import { useChatSync } from './room/useChatSync'
import { useQueueSync } from './room/useQueueSync'
import { useAuthSync } from './room/useAuthSync'
import { useConnectionGuard } from './room/useConnectionGuard'
import { useNearbyPrefetch } from './useNearbyPrefetch'

/**
 * Composition hook that wires up all room-related socket event listeners.
 * Sub-hooks are split by responsibility for maintainability.
 * The public API (leaveRoom, updateSettings, setUserRole) remains unchanged.
 */
export function useRoom() {
  const { socket } = useSocketContext()

  // Sub-hooks handle their own event listeners
  useRoomState()
  useChatSync()
  useQueueSync()
  useAuthSync()
  useConnectionGuard()
  useNearbyPrefetch()

  const leaveRoom = useCallback(() => {
    const roomId = useRoomStore.getState().room?.id
    if (roomId) storage.clearRejoinToken(roomId)
    socket.emit(EVENTS.ROOM_LEAVE)
    clearAudioBytes()
    clearPrefetchCache()
    resetAllRoomState()
  }, [socket])

  const updateSettings = useCallback(
    (settings: {
      name?: string
      password?: string | null
      audioQuality?: import('@music-together/shared').AudioQuality
      hidden?: boolean
      permanent?: boolean
      allowTemporaryAdminTrackRemoval?: boolean
      allowTemporaryAdminQueueClear?: boolean
      removePlayedTracks?: boolean
      roamingEnabled?: boolean
      automixEnabled?: boolean
      transitionMode?: import('@music-together/shared').TransitionMode
      crossfadeMaxSec?: number
      automixPerformance?: boolean
      roamingSource?: import('@music-together/shared').RoamingSource
      roamingMode?: import('@music-together/shared').NeteaseRoamingMode
    }) => {
      const roomId = useRoomStore.getState().room?.id
      if (!socket.connected || !roomId) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        const finish = (confirmed: boolean) => {
          clearTimeout(timer)
          socket.off(EVENTS.ROOM_SETTINGS, onConfirmed)
          socket.off(EVENTS.ROOM_ERROR, onRejected)
          socket.off('disconnect', onRejected)
          resolve(confirmed)
        }
        const onRejected = () => finish(false)
        const onConfirmed = (
          data: Parameters<import('@music-together/shared').ServerToClientEvents['room:settings']>[0],
        ) => {
          if (useRoomStore.getState().room?.id !== roomId) return finish(false)
          if (
            Object.entries(settings).every(
              ([key, value]) => value === undefined || data[key as keyof typeof data] === value,
            )
          )
            finish(true)
        }
        const timer = setTimeout(onRejected, 8_000)
        socket.on(EVENTS.ROOM_SETTINGS, onConfirmed)
        socket.on(EVENTS.ROOM_ERROR, onRejected)
        socket.on('disconnect', onRejected)
        socket.emit(EVENTS.ROOM_SETTINGS, settings)
      })
    },
    [socket],
  )

  const setUserRole = useCallback(
    (userId: string, role: 'admin' | 'member') => {
      socket.emit(EVENTS.ROOM_SET_ROLE, { userId, role })
    },
    [socket],
  )

  const kickUser = useCallback(
    (userId: string, ban = false) => {
      socket.emit(EVENTS.ROOM_KICK, { userId, ban })
    },
    [socket],
  )

  const unbanUser = useCallback(
    (userId: string) => {
      socket.emit(EVENTS.ROOM_UNBAN, { userId })
    },
    [socket],
  )

  return { leaveRoom, updateSettings, setUserRole, kickUser, unbanUser }
}
