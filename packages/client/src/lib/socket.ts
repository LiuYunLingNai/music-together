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

/** 首次重连等待（毫秒）—— 与旧的固定间隔一致，避免改变正常断网时的体感。 */
const RECONNECT_BASE_MS = 2_000
/** 退避上限（毫秒）。 */
const RECONNECT_MAX_MS = 30_000

/**
 * 第 `attempt` 次重连前应等待的毫秒数（指数退避 + 上限）。
 *
 * ★ 为什么需要退避：服务端**鉴权拒绝**时（`wss.ts` 发 `connect_error` 后立刻
 *   `ws.close()`），客户端有**两条重试路径叠加**：
 *
 *     ① `SocketProvider.onConnectError` → 重新 bootstrap 身份 → 立即 `connect()`
 *        （**零延迟**）
 *     ② `ws.onclose` → 2s 定时器再连一次
 *
 *   当失败是**持久性**的（如 dev 下 `127.0.0.1` 页面配 `localhost` 后端导致的
 *   跨站点 cookie 不发送），①会形成热循环 —— 每轮服务端打 2 行 warn，
 *   日志刷屏，且对服务端造成无意义的连接压力。
 *
 *   退避后：第 1 次仍等 2s（正常断网体感不变），之后 4s / 8s / 16s / 30s 封顶。
 *   恢复连接后计数归零，因此正常的"短暂断网→重连"不受影响。
 *
 * @param attempt 已失败的连续尝试次数（0 = 首次连接，立即尝试）
 */
export function reconnectDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return 0
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt - 1))
}

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
  /** 连续失败次数，用于指数退避；连接成功后归零。 */
  let failureCount = 0
  /** 上一次发起连接的时刻（`performance.now()`），用于退避节流。 */
  let lastAttemptAt = 0

  const connect = () => {
    shouldReconnect = true
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    // ★ 退避节流：上一次尝试距今不足应等时长时，安排一个定时器后返回，
    //   而不是立刻新建 WebSocket。这样 `SocketProvider` 的"鉴权失败立即重连"
    //   路径（零延迟）也会被退避拦住，不会形成热循环。
    const delay = reconnectDelayMs(failureCount)
    if (delay > 0) {
      const elapsed = performance.now() - lastAttemptAt
      if (elapsed < delay) {
        if (reconnectTimer === null) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            // 等待期间若被主动断开，不得复活（否则登出后会自己连回来）
            if (shouldReconnect) connect()
          }, delay - elapsed)
        }
        return
      }
    }
    lastAttemptAt = performance.now()

    const wsUrl = SERVER_URL.replace(/^http/, 'ws') + '/ws'
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      connected = true
      // 连接成功 → 退避计数归零（下一次断网仍从 2s 起步）
      failureCount = 0
      // 成功建连后清掉可能仍在排队的重连定时器，避免多开一条连接
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
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
        // 累计失败次数 → 下一次 connect() 走指数退避（2s / 4s / 8s … 封顶 30s）
        failureCount += 1
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, reconnectDelayMs(failureCount))
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
    // ★ 主动断开（登录/登出后 `reconnectSocket` 会紧接着 `connect()`）视为
    //   "用户动作"，退避计数归零 —— 否则处在失败退避中的用户登录成功后，
    //   重连还要多等几秒。
    //   注意：鉴权热循环走的是 `onConnectError → connect()`，**不经过**
    //   `disconnect()`，因此不会被这条重置绕过。
    failureCount = 0
    lastAttemptAt = 0
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
