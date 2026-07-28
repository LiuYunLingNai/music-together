import type { ServerToClientEvents } from '@music-together/shared'
import { useSocketContext } from '@/providers/socket-context'
import { useEffect, useEffectEvent } from 'react'

/**
 * Generic hook to subscribe to a typed Socket.IO event.
 * Automatically handles on/off lifecycle and keeps the handler reference stable.
 *
 * @example
 * useSocketEvent(EVENTS.ROOM_STATE, useCallback((room) => { ... }, []))
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  const { socket } = useSocketContext()
  const onEvent = useEffectEvent((...args: unknown[]) => {
    ;(handler as unknown as (...eventArgs: unknown[]) => void)(...args)
  })

  useEffect(() => {
    const wrapper = onEvent as unknown as ServerToClientEvents[E]

    socket.on(event, wrapper as never)
    return () => {
      socket.off(event, wrapper as never)
    }
  }, [socket, event])
}
