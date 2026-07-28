import { createContext, useContext } from 'react'
import type { TypedSocket } from '@/lib/socket'

export interface SocketContextValue {
  socket: TypedSocket
  isConnected: boolean
}

export const SocketContext = createContext<SocketContextValue | null>(null)

export function useSocketContext(): SocketContextValue {
  const context = useContext(SocketContext)
  if (!context) throw new Error('useSocketContext must be used within SocketProvider')
  return context
}
