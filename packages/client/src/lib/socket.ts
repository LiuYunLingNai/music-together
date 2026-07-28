import type { ClientToServerEvents, ServerToClientEvents } from '@music-together/shared'
import { SERVER_URL } from './config'

interface ConnectionEvents {
  connect: () => void
  disconnect: () => void
  connect_error: (error: Error) => void
}

type SocketInboundEvents = ServerToClientEvents & ConnectionEvents
type StoredHandler = (...args: unknown[]) => void

export type TypedSocket = {
  connected: boolean
  connect: () => void
  disconnect: () => void
  on: <E extends keyof SocketInboundEvents>(event: E, handler: SocketInboundEvents[E]) => void
  off: <E extends keyof SocketInboundEvents>(event: E, handler: SocketInboundEvents[E]) => void
  emit: <E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>) => void
}

let socket: TypedSocket | null = null

export function getSocket(): TypedSocket {
  if (!socket) {
    socket = createWebSocket()
  }
  return socket
}

export function connectSocket(): TypedSocket {
  const s = getSocket()
  s.connect()
  return s
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

export function waitForConnect(): Promise<TypedSocket> {
  const s = getSocket()
  if (s.connected) return Promise.resolve(s)
  return new Promise((resolve) => {
    const handler = () => {
      s.off('connect', handler)
      resolve(s)
    }
    s.on('connect', handler)
    s.connect()
  })
}

function createWebSocket(): TypedSocket {
  let ws: WebSocket | null = null
  let connected = false
  const handlers = new Map<string, Set<StoredHandler>>()
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let shouldReconnect = true

  const connect = () => {
    shouldReconnect = true
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const wsUrl = SERVER_URL.replace(/^http/, 'ws') + '/ws'
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      connected = true
      const connectHandlers = handlers.get('connect')
      if (connectHandlers) {
        for (const h of connectHandlers) h()
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg && typeof msg.event === 'string') {
          const eventHandlers = handlers.get(msg.event)
          if (eventHandlers) {
            for (const h of eventHandlers) h(msg.data)
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message', err)
      }
    }

    ws.onclose = () => {
      connected = false
      const disconnectHandlers = handlers.get('disconnect')
      if (disconnectHandlers) {
        for (const h of disconnectHandlers) h()
      }

      if (shouldReconnect) {
        reconnectTimer = setTimeout(() => {
          connect()
        }, 2000)
      }
    }

    ws.onerror = (err) => {
      console.error('WebSocket error', err)
      const errorHandlers = handlers.get('connect_error')
      if (errorHandlers) {
        for (const h of errorHandlers) h(new Error('WebSocket error'))
      }
    }
  }

  const disconnect = () => {
    shouldReconnect = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected = false
  }

  const on = <E extends keyof SocketInboundEvents>(event: E, handler: SocketInboundEvents[E]) => {
    let set = handlers.get(event as string)
    if (!set) {
      set = new Set()
      handlers.set(event as string, set)
    }
    set.add(handler as unknown as StoredHandler)
  }

  const off = <E extends keyof SocketInboundEvents>(event: E, handler: SocketInboundEvents[E]) => {
    const set = handlers.get(event as string)
    if (set) {
      set.delete(handler as unknown as StoredHandler)
    }
  }

  const emit = <E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data: args[0] }))
    }
  }

  return {
    get connected() {
      return connected
    },
    connect,
    disconnect,
    on,
    off,
    emit,
  }
}
