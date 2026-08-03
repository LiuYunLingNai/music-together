import { useSocketContext } from '@/providers/SocketProvider'
import { resetAllRoomState } from '@/lib/resetStores'
import { useEffect } from 'react'
import { stopActiveAudio } from '@/lib/audioPlaybackLifecycle'

/**
 * Resets all room-related stores on socket disconnect.
 * Re-join on reconnect is handled by RoomPage's auto-join effect.
 */
export function useConnectionGuard() {
  const { socket } = useSocketContext()

  useEffect(() => {
    const onDisconnect = () => {
      stopActiveAudio()
      resetAllRoomState()
    }

    socket.on('disconnect', onDisconnect)

    return () => {
      socket.off('disconnect', onDisconnect)
    }
  }, [socket])
}
