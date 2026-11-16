import { EVENTS, type ClientToServerEvents, type ServerToClientEvents } from '@music-together/shared'
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

/** 连接空闲超过这个时间就主动探测一次；半开连接（切 WiFi、休眠恢复）浏览器可能很久才报断。 */
const LIVENESS_IDLE_MS = 12_000
/** 探测后仍无任何入站消息，判定连接已死并立即重连。 */
const LIVENESS_DEAD_MS = 8_000
const LIVENESS_TICK_MS = 4_000

/** 首次重连等待（毫秒）。断线期间音频继续播放，越早接回时间线越好。 */
const RECONNECT_BASE_MS = 500
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
 *   退避后：第 1 次等 0.5s，之后 1s / 2s / 4s / 8s / 16s，30s 封顶。
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
  /** 最近一次入站消息的时刻，用于探活。 */
  let lastInboundAt = 0
  let probeSentAt = 0
  let livenessTimer: ReturnType<typeof setInterval> | null = null

  const stopLiveness = () => {
    if (livenessTimer !== null) clearInterval(livenessTimer)
    livenessTimer = null
    probeSentAt = 0
  }

  const handleClosed = (connection: WebSocket) => {
    if (ws !== connection) return
    stopLiveness()
    connected = false
    const disconnectHandlers = handlers.get('disconnect')
    if (disconnectHandlers) {
      for (const h of disconnectHandlers) h()
    }

    if (shouldReconnect) {
      // 累计失败次数 → 下一次 connect() 走指数退避（0.5s / 1s / 2s … 封顶 30s）
      failureCount += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (shouldReconnect) connect()
      }, reconnectDelayMs(failureCount))
    }
  }

  const startLiveness = () => {
    stopLiveness()
    lastInboundAt = performance.now()
    livenessTimer = setInterval(() => {
      if (!connected || !ws) return
      const now = performance.now()
      if (probeSentAt > 0 && lastInboundAt > probeSentAt) probeSentAt = 0
      if (probeSentAt > 0) {
        if (now - probeSentAt >= LIVENESS_DEAD_MS) {
          // 连接已死：不等浏览器的关闭握手，直接按断线处理并重连。
          const dead = ws
          handleClosed(dead)
          ws = null
          try {
            dead.close()
          } catch {
            // 已经关闭。
          }
        }
        return
      }
      if (now - lastInboundAt >= LIVENESS_IDLE_MS) {
        probeSentAt = now
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: EVENTS.NTP_PING, data: { clientPingId: 0 } }))
        }
      }
    }, LIVENESS_TICK_MS)
  }

  /** 网络恢复或页面回到前台：跳过退避，立刻重试。 */
  const retryNow = () => {
    if (!shouldReconnect || connected) return
    if (ws && ws.readyState === WebSocket.CONNECTING) return
    failureCount = 0
    lastAttemptAt = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    connect()
  }

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
    const connection = new WebSocket(wsUrl)
    ws = connection

    ws.onopen = () => {
      if (ws !== connection) return
      connected = true
      // 连接成功 → 退避计数归零（下一次断网仍从 0.5s 起步）
      failureCount = 0
      startLiveness()
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
      if (ws !== connection) return
      lastInboundAt = performance.now()
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

    ws.onclose = () => handleClosed(connection)

    ws.onerror = (err) => {
      if (ws !== connection) return
      console.error('WebSocket error', err)
      const errorHandlers = handlers.get('connect_error')
      if (errorHandlers) {
        for (const h of errorHandlers) h(new Error('WebSocket error'))
      }
    }
  }

  const disconnect = () => {
    shouldReconnect = false
    stopLiveness()
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

  if (typeof window !== 'undefined') {
    window.addEventListener('online', retryNow)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retryNow()
    })
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
