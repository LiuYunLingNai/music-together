import type { ClientToServerEvents, ServerToClientEvents } from '@music-together/shared'
import type { RoomData } from '../repositories/types.js'
import type { User } from '@music-together/shared'
import type { TypedServer as WsTypedServer, TypedSocket as WsTypedSocket } from '../wss.js'

export interface SocketData {
  identityUserId: string
}

export type TypedServer = WsTypedServer<ClientToServerEvents, ServerToClientEvents, SocketData>
export type TypedSocket = WsTypedSocket<ClientToServerEvents, ServerToClientEvents, SocketData>

export interface HandlerContext {
  io: TypedServer
  socket: TypedSocket
  roomId: string
  room: RoomData
  user: User
}
