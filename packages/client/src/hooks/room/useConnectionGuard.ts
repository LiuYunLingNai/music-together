import { useSocketContext } from '@/providers/socket-context'
import { resetAllRoomState } from '@/lib/resetStores'
import { stopActiveAudio } from '@/lib/audioPlaybackLifecycle'
import { useEffect } from 'react'

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
