/**
 * WebSocket server wrapper — provides a socket.io-compatible API on top of
 * the lightweight `ws` library.
 *
 * Protocol: JSON messages of the form `{ "event": "<name>", "data": <payload> }`.
 *
 * Features replicated from socket.io:
 *   - Typed event emitter (on/emit)
 *   - Room management (join/leave/to/except)
 *   - Middleware (connection handshake guard)
 *   - socket.data, socket.id, socket.handshake
 *   - Graceful close
 */

import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { TIMING } from '@music-together/shared'
import { nanoid } from 'nanoid'
import { WebSocket, WebSocketServer, type RawData, type AddressInfo } from 'ws'
import { logger } from './utils/logger.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Handshake {
  headers: Record<string, string | string[] | undefined>
}

type EventHandler = (...args: any[]) => void

export class TypedSocket<
  ClientToServerEvents extends Record<string, any> = Record<string, any>,
  ServerToClientEvents extends Record<string, any> = Record<string, any>,
  SocketData extends Record<string, any> = Record<string, any>,
> {
  readonly id: string
  readonly handshake: Handshake
  data: SocketData = {} as SocketData

  /** @internal */
  public readonly ws: WebSocket
  private handlers = new Map<string, Set<EventHandler>>()
  private rooms = new Set<string>()
  /** Reference to the server, for room/broadcast operations */
  private server: TypedServer<ClientToServerEvents, ServerToClientEvents, SocketData>

  constructor(
    ws: WebSocket,
    req: IncomingMessage,
    server: TypedServer<ClientToServerEvents, ServerToClientEvents, SocketData>,
  ) {
    this.id = nanoid(12)
    this.ws = ws
    this.server = server
    this.handshake = { headers: req.headers as Record<string, string | string[] | undefined> }

    this.ws.on('message', (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg && typeof msg.event === 'string') {
          this.dispatch(msg.event, msg.data)
        }
      } catch (err) {
        logger.warn('Failed to parse WebSocket message', { socketId: this.id })
      }
    })

    this.ws.on('close', () => {
      this.dispatch('disconnect', 'transport close')
      this.server.removeSocket(this)
    })

    this.ws.on('error', (err) => {
      logger.warn('WebSocket error', { socketId: this.id, error: err.message })
    })
  }

  // -- Event emitter --------------------------------------------------------

  on<E extends keyof ClientToServerEvents & string>(event: E, handler: EventHandler): this
  on(event: 'disconnect', handler: (reason: string) => void): this
  on(event: string, handler: EventHandler): this {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return this
  }

  off<E extends keyof ClientToServerEvents & string>(event: E, handler: EventHandler): this
  off(event: 'disconnect', handler: (reason: string) => void): this
  off(event: string, handler: EventHandler): this {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  emit<E extends keyof ServerToClientEvents & string>(event: E, ...args: any[]): boolean {
    if (this.ws.readyState !== WebSocket.OPEN) return false
    const data = args.length <= 1 ? args[0] : args
    this.ws.send(JSON.stringify({ event, data }))
    return true
  }

  private dispatch(event: string, ...args: any[]): void {
    const set = this.handlers.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        handler.call(this, ...args)
      } catch (err) {
        logger.error('Event handler error', err, { socketId: this.id, event })
      }
    }
  }

  // -- Room management ------------------------------------------------------

  join(room: string): void {
    this.rooms.add(room)
    this.server.addSocketToRoom(room, this)
  }

  leave(room: string): void {
    this.rooms.delete(room)
    this.server.removeSocketFromRoom(room, this)
  }

  /** Returns a broadcaster that sends to all sockets in `room` except this one */
  to(room: string): Broadcaster<ServerToClientEvents> {
    return new Broadcaster(this.server, room, this.id)
  }

  // -- Connection control ---------------------------------------------------

  get connected(): boolean {
    return this.ws.readyState === WebSocket.OPEN
  }

  disconnect(close = true): void {
    if (close) {
      this.ws.close()
    }
  }

  // -- Internal (used by TypedServer) ---------------------------------------

  /** @internal */
  _sendToRoom(room: string, event: string, data: any, exceptSocketId?: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return
    // This socket sends to its own room members excluding itself
    // (used by socket.to(room).emit())
  }

  /** @internal */
  _rooms(): ReadonlySet<string> {
    return this.rooms
  }
}

// ---------------------------------------------------------------------------
// Broadcaster — returned by .to(room)
// ---------------------------------------------------------------------------

class Broadcaster<ServerToClientEvents extends Record<string, any>> {
  private server: TypedServer<any, ServerToClientEvents, any>
  private room: string
  private exceptId?: string

  constructor(server: TypedServer<any, ServerToClientEvents, any>, room: string, exceptId?: string) {
    this.server = server
    this.room = room
    this.exceptId = exceptId
  }

  except(socketId: string): this {
    this.exceptId = socketId
    return this
  }

  emit<E extends keyof ServerToClientEvents & string>(event: E, ...args: any[]): void {
    const data = args.length <= 1 ? args[0] : args
    const msg = JSON.stringify({ event, data })
    const sockets = this.server.getSocketsInRoom(this.room)
    for (const s of sockets) {
      if (this.exceptId && s.id === this.exceptId) continue
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(msg)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TypedServer
// ---------------------------------------------------------------------------

type MiddlewareFn<SD extends Record<string, any>> = (
  socket: TypedSocket<any, any, SD>,
  next: (err?: Error) => void,
) => void

export class TypedServer<
  ClientToServerEvents extends Record<string, any> = Record<string, any>,
  ServerToClientEvents extends Record<string, any> = Record<string, any>,
  SocketData extends Record<string, any> = Record<string, any>,
> {
  private wss: WebSocketServer
  private sockets = new Set<TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>>()
  private roomMap = new Map<string, Set<TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>>>()
  private middlewares: MiddlewareFn<SocketData>[] = []
  private connectionHandlers: ((socket: TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>) => void)[] = []
  private heartbeatTimer: ReturnType<typeof setInterval>
  private aliveSockets = new Map<WebSocket, boolean>()

  constructor(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ noServer: true })

    httpServer.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname

      if (pathname === '/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request)
        })
      } else {
        socket.destroy()
      }
    })

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.aliveSockets.set(ws, true)
      ws.on('pong', () => this.aliveSockets.set(ws, true))
      this.handleConnection(ws, req)
    })

    this.heartbeatTimer = setInterval(() => {
      for (const socket of this.sockets) {
        const ws = socket.ws
        if (this.aliveSockets.get(ws) === false) {
          logger.warn('WebSocket heartbeat timed out', { socketId: socket.id })
          ws.terminate()
          continue
        }
        this.aliveSockets.set(ws, false)
        ws.ping()
      }
    }, TIMING.WEBSOCKET_HEARTBEAT_INTERVAL_MS)
    this.heartbeatTimer.unref()
  }

  // -- Middleware ------------------------------------------------------------

  use(fn: MiddlewareFn<SocketData>): this {
    this.middlewares.push(fn)
    return this
  }

  // -- Connection event -----------------------------------------------------

  on(event: 'connection', handler: (socket: TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>) => void): this {
    this.connectionHandlers.push(handler)
    return this
  }

  // -- Room / broadcast -----------------------------------------------------

  to(room: string): Broadcaster<ServerToClientEvents> {
    return new Broadcaster(this, room)
  }

  /** @internal */
  addSocketToRoom(room: string, socket: TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>): void {
    let set = this.roomMap.get(room)
    if (!set) {
      set = new Set()
      this.roomMap.set(room, set)
    }
    set.add(socket)
  }

  /** @internal */
  removeSocketFromRoom(room: string, socket: TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>): void {
    const set = this.roomMap.get(room)
    if (!set) return
    set.delete(socket)
    if (set.size === 0) this.roomMap.delete(room)
  }

  /** @internal */
  removeSocket(socket: TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>): void {
    this.sockets.delete(socket)
    this.aliveSockets.delete(socket.ws)
    // Clean up all room memberships
    for (const [room, set] of this.roomMap) {
      set.delete(socket)
      if (set.size === 0) this.roomMap.delete(room)
    }
  }

  /** @internal */
  getSocketsInRoom(room: string): TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>[] {
    const set = this.roomMap.get(room)
    return set ? Array.from(set) : []
  }

  // -- Close ----------------------------------------------------------------

  close(cb?: () => void): void {
    clearInterval(this.heartbeatTimer)
    for (const s of this.sockets) {
      try {
        s.ws.close()
      } catch {
        // ignore
      }
    }
    this.wss.close(cb)
  }

  // -- Internal connection handler ------------------------------------------

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const socket = new TypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>(ws, req, this)

    // Run middlewares sequentially
    const runMiddleware = (index: number): void => {
      if (index >= this.middlewares.length) {
        // All middleware passed — register and notify
        this.sockets.add(socket)
        for (const handler of this.connectionHandlers) {
          handler(socket)
        }
        return
      }
      this.middlewares[index]!(socket, (err) => {
        if (err) {
          logger.warn('WebSocket middleware rejected connection', {
            socketId: socket.id,
            error: err.message,
          })
          // Send error and close
          try {
            ws.send(JSON.stringify({ event: 'connect_error', data: { message: err.message } }))
            ws.close()
          } catch {
            // ignore
          }
          return
        }
        runMiddleware(index + 1)
      })
    }

    runMiddleware(0)
  }
}
