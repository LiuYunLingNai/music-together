import type {
  AudioQuality,
  ChatMessage,
  ClientInfo,
  PlayMode,
  PlayState,
  RoomListItem,
  RoomMember,
  Track,
  User,
  RoamingSource,
  NeteaseRoamingMode,
} from '@music-together/shared'

/** 服务端内部房间数据模型 -- 含密码（仅通过 owner 专用 RoomState 发送给客户端） */
export interface RoomData {
  id: string
  name: string
  password: string | null
  /** 房间创建者 ID（永久不变，创建者为 owner，加入时自动成为 conductor） */
  creatorId: string
  hostId: string
  /** 持久化 admin 用户 ID 集合（离开/回来自动恢复 admin） */
  adminUserIds: Set<string>
  /** 临时管理员 ID：仅当房间内没有在线 owner / 持久 admin 时授予，不持久化 */
  temporaryAdminUserId: string | null
  /** Whether a temporary admin may remove individual tracks. */
  allowTemporaryAdminTrackRemoval: boolean
  /** Whether a temporary admin may clear the entire queue. */
  allowTemporaryAdminQueueClear: boolean
  /** Remove the previously played queue item after a successful next-track transition. */
  removePlayedTracks: boolean
  /** Continue with personalized recommendations when the user queue has no successor. */
  roamingEnabled: boolean
  /** Logged-in platform used to fetch personalized roaming songs. */
  roamingSource: RoamingSource
  roamingMode: NeteaseRoamingMode
  /** Hide the room from the public lobby; direct joins remain available. */
  hidden: boolean
  /** Keep the room when empty and restore it after a server restart. */
  permanent: boolean
  audioQuality: AudioQuality
  /** Full roster; users contains only the currently connected members. */
  members: RoomMember[]
  users: User[]
  queue: Track[]
  currentTrack: Track | null
  playState: PlayState
  playMode: PlayMode
}

export interface SocketMapping {
  roomId: string
  userId: string
  client?: ClientInfo
}

export interface RoomRepository {
  get(roomId: string): RoomData | undefined
  set(roomId: string, room: RoomData): void
  persist(roomId: string): void
  delete(roomId: string): void
  getAll(): ReadonlyMap<string, RoomData>
  getAllIds(): string[]
  /** Public lobby projection; hidden rooms must never be included. */
  getPublicLobbyList(): RoomListItem[]
  setSocketMapping(socketId: string, roomId: string, userId: string, client?: ClientInfo): void
  replaceUserId(oldUserId: string, newUserId: string): void
  getSocketMapping(socketId: string): SocketMapping | undefined
  deleteSocketMapping(socketId: string): void
  /** Check if a user has another active socket in the same room (excluding a specific socket) */
  hasOtherSocketForUser(roomId: string, userId: string, excludeSocketId: string): boolean
  /** Return coarse client labels for every active socket owned by a room member. */
  getClientInfosForUser(roomId: string, userId: string): ClientInfo[]
  /** 根据 roomId + userId 查找对应的 socketId（用于定向发送） */
  getSocketIdForUser(roomId: string, userId: string): string | null
  /** Store a smoothed RTT measurement for a given socket */
  setSocketRTT(socketId: string, rttMs: number): void
  /** Retrieve the current smoothed RTT for a socket (default 0) */
  getSocketRTT(socketId: string): number
  /** Get the P90 RTT among all sockets in a room (falls back to max for ≤3 sockets) */
  getP90RTT(roomId: string): number
}

export interface ChatRepository {
  getHistory(roomId: string): ChatMessage[]
  addMessage(roomId: string, message: ChatMessage): void
  createRoom(roomId: string): void
  persistRoom(roomId: string): void
  deleteRoom(roomId: string): void
}
