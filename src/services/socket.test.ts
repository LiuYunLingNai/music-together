import { afterEach, describe, expect, it, vi } from 'vitest'
import { MusicTogetherSocket } from './socket'

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  static instances: MockWebSocket[] = []
  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  send(): void {}
}

describe('MusicTogetherSocket manual disconnect', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    MockWebSocket.instances = []
  })

  it('does not reconnect after an intentional disconnect races with close', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    const socket = new MusicTogetherSocket('https://music.example')
    socket.connect()
    const first = MockWebSocket.instances[0]
    first.readyState = MockWebSocket.OPEN
    first.onopen?.()
    first.readyState = MockWebSocket.CLOSED
    first.onclose?.()
    expect(vi.getTimerCount()).toBe(1)

    socket.disconnect()
    vi.advanceTimersByTime(60_000)
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(socket.connected).toBe(false)
  })

  it('ignores a stale socket opening after manual disconnect', () => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    const socket = new MusicTogetherSocket('https://music.example')
    const status = vi.fn()
    socket.onStatus(status)
    socket.connect()
    const first = MockWebSocket.instances[0]
    socket.disconnect()
    first.readyState = MockWebSocket.OPEN
    first.onopen?.()
    expect(status).not.toHaveBeenCalledWith(true, undefined)
  })
})
