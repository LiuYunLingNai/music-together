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
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
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
 *     ② `ws.onclose` → 2s 定时器再连一次
 *
 *   当失败是**持久性**的（dev 下 `127.0.0.1` 页面 + `localhost` 后端 →
 *   跨站点 cookie 不发送），①形成热循环：每轮服务端打 2 行 warn，日志刷屏。
 *
 * 修复后：第 1 次仍等 2s（正常断网体感不变），之后指数增长并封顶 30s。
 */
describe('reconnectDelayMs（重连退避）', () => {
  it('首次连接（attempt 0）立即尝试', () => {
    expect(reconnectDelayMs(0)).toBe(0)
  })

  it('第一次重连仍是 2s（保持正常断网的原有体感）', () => {
    expect(reconnectDelayMs(1)).toBe(2_000)
  })

  it('之后指数增长', () => {
    expect(reconnectDelayMs(2)).toBe(4_000)
    expect(reconnectDelayMs(3)).toBe(8_000)
    expect(reconnectDelayMs(4)).toBe(16_000)
  })

  it('封顶 30s（不会无限增长）', () => {
    expect(reconnectDelayMs(5)).toBe(30_000)
    expect(reconnectDelayMs(6)).toBe(30_000)
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

  it('热循环被压制：前 10 次重连的总等待远超固定 2s 策略', () => {
    // 固定 2s × 10 = 20s；退避后应显著更长（说明热循环已被拦住）
    const total = Array.from({ length: 10 }, (_, i) => reconnectDelayMs(i + 1)).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(60_000)
  })
})
