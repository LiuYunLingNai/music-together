import { describe, expect, it, vi } from 'vitest'
import { disconnectSocket, getSocket, reconnectDelayMs } from './socket'

it('ignores callbacks from a replaced connection and keeps the active connection usable', () => {
  class FakeWebSocket {
    static OPEN = 1
    static CONNECTING = 0
    static instances: FakeWebSocket[] = []
    readyState = 0
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    constructor() {
      FakeWebSocket.instances.push(this)
    }
    close() {
      this.readyState = 3
    }
    send() {}
  }
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  try {
    const socket = getSocket()
    const disconnected = vi.fn()
    const incoming = vi.fn()
    socket.on('disconnect', disconnected)
    socket.on('room:error', incoming)
    socket.connect()
    const old = FakeWebSocket.instances[0]
    socket.disconnect()
    socket.connect()
    const active = FakeWebSocket.instances[1]
    active.readyState = 1
    active.onopen?.()
    old.onclose?.()
    old.onmessage?.({ data: JSON.stringify({ event: 'room:error', data: { code: 'OLD' } }) })
    expect(socket.connected).toBe(true)
    expect(disconnected).not.toHaveBeenCalled()
    expect(incoming).not.toHaveBeenCalled()
    active.onmessage?.({ data: JSON.stringify({ event: 'room:error', data: { code: 'CURRENT' } }) })
    expect(incoming).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(10_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  } finally {
    disconnectSocket()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

it('探活：连接静默且探测无回应时主动判定断线并立即重连', () => {
  class FakeWebSocket {
    static OPEN = 1
    static CONNECTING = 0
    static instances: FakeWebSocket[] = []
    readyState = 0
    sent: string[] = []
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    constructor() {
      FakeWebSocket.instances.push(this)
    }
    close() {
      this.readyState = 3
    }
    send(data: string) {
      this.sent.push(data)
    }
  }
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  try {
    const socket = getSocket()
    const disconnected = vi.fn()
    socket.on('disconnect', disconnected)
    socket.connect()
    const first = FakeWebSocket.instances[0]
    first.readyState = 1
    first.onopen?.()

    vi.advanceTimersByTime(16_000)
    expect(first.sent.some((raw) => raw.includes('ntp:ping'))).toBe(true)
    expect(disconnected).not.toHaveBeenCalled()

    vi.advanceTimersByTime(12_000)
    expect(disconnected).toHaveBeenCalledOnce()
    expect(socket.connected).toBe(false)
    vi.advanceTimersByTime(600)
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2)
  } finally {
    disconnectSocket()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

/**
 * 回归：重连必须**指数退避**，不得是热循环。
 *
 * 真实事故（用户报"进网页后台日志爆炸输出"）：
 *
 *   服务端**鉴权拒绝**时（`wss.ts` 发 `connect_error` 后立刻 `ws.close()`），
 *   客户端有**两条重试路径叠加**：
 *     ① `SocketProvider.onConnectError` → 重新 bootstrap → 立即 `connect()`
 *        （**零延迟**）
 *     ② `ws.onclose` → 定时器再连一次
 *
 *   当失败是**持久性**的（dev 下 `127.0.0.1` 页面 + `localhost` 后端 →
 *   跨站点 cookie 不发送），①形成热循环：每轮服务端打 2 行 warn，日志刷屏。
 *
 * 修复后：第 1 次等 0.5s（断线期间音频继续播放，越早接回越好），之后指数增长并封顶 30s。
 */
describe('reconnectDelayMs（重连退避）', () => {
  it('首次连接（attempt 0）立即尝试', () => {
    expect(reconnectDelayMs(0)).toBe(0)
  })

  it('第一次重连只等 0.5s', () => {
    expect(reconnectDelayMs(1)).toBe(500)
  })

  it('之后指数增长', () => {
    expect(reconnectDelayMs(2)).toBe(1_000)
    expect(reconnectDelayMs(3)).toBe(2_000)
    expect(reconnectDelayMs(4)).toBe(4_000)
    expect(reconnectDelayMs(5)).toBe(8_000)
    expect(reconnectDelayMs(6)).toBe(16_000)
  })

  it('封顶 30s（不会无限增长）', () => {
    expect(reconnectDelayMs(7)).toBe(30_000)
    expect(reconnectDelayMs(8)).toBe(30_000)
    expect(reconnectDelayMs(50)).toBe(30_000)
    expect(reconnectDelayMs(1000)).toBe(30_000)
  })

  it('单调不减，且始终有限（畸形入参不得返回 NaN/负数）', () => {
    let prev = -1
    for (let n = 0; n <= 40; n++) {
      const d = reconnectDelayMs(n)
      expect(Number.isFinite(d)).toBe(true)
      expect(d).toBeGreaterThanOrEqual(prev)
      expect(d).toBeGreaterThanOrEqual(0)
      prev = d
    }
    // 非有限/负数入参按"首次连接"处理
    expect(reconnectDelayMs(Number.NaN)).toBe(0)
    expect(reconnectDelayMs(-5)).toBe(0)
    expect(reconnectDelayMs(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('热循环被压制：前 10 次重连的总等待仍然很长', () => {
    // 首次重连变快后，持久性失败仍须靠退避拦住热循环
    const total = Array.from({ length: 10 }, (_, i) => reconnectDelayMs(i + 1)).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(60_000)
  })
})
