type Handler<T = unknown> = (data: T) => void
type StatusHandler = (connected: boolean, error?: string) => void

export class MusicTogetherSocket {
  private socket: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private statusHandlers = new Set<StatusHandler>()
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private shouldReconnect = false
  private manualDisconnect = false
  private generation = 0
  private lastError: string | undefined

  constructor(private serverUrl: string) {}

  connect(): void {
    this.manualDisconnect = false
    this.shouldReconnect = true
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const generation = ++this.generation
    const url = `${this.serverUrl.replace(/^http/, 'ws')}/ws`
    const socket = new WebSocket(url)
    this.socket = socket

    socket.onopen = () => {
      if (generation !== this.generation || this.manualDisconnect) {
        socket.close()
        return
      }
      this.reconnectAttempt = 0
      this.lastError = undefined
      this.notifyStatus(true)
    }
    socket.onmessage = (message) => {
      if (generation !== this.generation || this.manualDisconnect) return
      try {
        const envelope = JSON.parse(String(message.data)) as { event?: string; data?: unknown }
        if (!envelope.event) return
        if (envelope.event === 'connect_error') {
          const error = envelope.data as { message?: string }
          this.lastError = error.message ?? '连接认证失败'
          this.notifyStatus(false, this.lastError)
          return
        }
        this.handlers.get(envelope.event)?.forEach((handler) => handler(envelope.data))
      } catch {
        this.notifyStatus(false, '收到无法解析的服务器消息')
      }
    }
    socket.onerror = () => {
      if (generation !== this.generation || this.manualDisconnect) return
      this.lastError = '无法连接服务器'
      this.notifyStatus(false, this.lastError)
    }
    socket.onclose = () => {
      if (generation !== this.generation) return
      this.notifyStatus(false, this.lastError)
      if (this.socket === socket) this.socket = null
      if (!this.shouldReconnect || this.manualDisconnect) return
      const delay = [2_000, 4_000, 8_000, 15_000, 30_000][Math.min(this.reconnectAttempt, 4)]
      this.reconnectAttempt += 1
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null
        if (generation === this.generation && this.shouldReconnect && !this.manualDisconnect) this.connect()
      }, delay)
    }
  }

  disconnect(): void {
    this.manualDisconnect = true
    this.shouldReconnect = false
    this.generation += 1
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  emit(event: string, data?: unknown): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ event, data }))
      return true
    }
    return false
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  on<T>(event: string, handler: Handler<T>): () => void {
    const handlers = this.handlers.get(event) ?? new Set<Handler>()
    handlers.add(handler as Handler)
    this.handlers.set(event, handlers)
    return () => handlers.delete(handler as Handler)
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  private notifyStatus(connected: boolean, error?: string): void {
    this.statusHandlers.forEach((handler) => handler(connected, error))
  }
}
