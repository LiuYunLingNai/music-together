import { LIMITS, type RoomListItem, type Track } from '@music-together/shared'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { db } from './database.js'
import type { RoomData, RoomRepository, SocketMapping } from './types.js'

interface PermanentRoomRow {
  id: string
  state_json: string
}

interface PersistedRoomState {
  name: RoomData['name']
  /** Legacy plaintext field retained only for reading databases created before encryption. */
  password?: RoomData['password']
  passwordEncrypted?: string | null
  creatorId: RoomData['creatorId']
  adminUserIds: string[]
  hidden?: boolean
  audioQuality: RoomData['audioQuality']
  queue: RoomData['queue']
  currentTrack: RoomData['currentTrack']
  playState: RoomData['playState']
  playMode: RoomData['playMode']
}

const encryptionKey = createHash('sha256').update(config.identity.secret).digest()

function encryptPassword(password: string | null): string | null {
  if (password === null) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

function decryptPassword(value: string | null | undefined): string | null {
  if (value == null) return null
  const [, iv, tag, encrypted] = value.split(':')
  if (!value.startsWith('v1:') || !iv || !tag || !encrypted) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
  } catch (error) {
    logger.warn('Failed to decrypt permanent room password', { error })
    return null
  }
}

function withoutStreamUrl(track: Track): Track {
  const { streamUrl: _streamUrl, ...persistable } = track
  return persistable
}

export class InMemoryRoomRepository implements RoomRepository {
  private rooms = new Map<string, RoomData>()
  private socketToRoom = new Map<string, SocketMapping>()
  /** Smoothed RTT per socket (ms).  Cleaned up together with socket mapping. */
  private socketRTT = new Map<string, number>()
  /** Reverse index: roomId → Set of socketIds.  Keeps getP90RTT O(room sockets) instead of O(all sockets). */
  private roomToSockets = new Map<string, Set<string>>()
  private upsertPermanentRoom = db.prepare(`
    INSERT INTO permanent_rooms (id, state_json, updated_at)
    VALUES (@id, @stateJson, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `)
  private deletePermanentRoom = db.prepare('DELETE FROM permanent_rooms WHERE id = ?')

  constructor() {
    const rows = db.prepare<[], PermanentRoomRow>('SELECT id, state_json FROM permanent_rooms').all()
    for (const row of rows) {
      try {
        const state = JSON.parse(row.state_json) as PersistedRoomState
        this.rooms.set(row.id, {
          id: row.id,
          name: state.name,
          password:
            state.passwordEncrypted !== undefined ? decryptPassword(state.passwordEncrypted) : (state.password ?? null),
          creatorId: state.creatorId,
          hostId: state.creatorId,
          adminUserIds: new Set(state.adminUserIds ?? []),
          temporaryAdminUserId: null,
          hidden: state.hidden ?? false,
          permanent: true,
          audioQuality: state.audioQuality,
          users: [],
          queue: (state.queue ?? []).slice(0, LIMITS.QUEUE_MAX_SIZE).map(withoutStreamUrl),
          currentTrack: null,
          playState: {
            isPlaying: false,
            currentTime: 0,
            serverTimestamp: Date.now(),
          },
          playMode: state.playMode ?? 'loop-all',
        })
      } catch {
        this.deletePermanentRoom.run(row.id)
      }
    }
  }

  get(roomId: string): RoomData | undefined {
    return this.rooms.get(roomId)
  }

  set(roomId: string, room: RoomData): void {
    this.rooms.set(roomId, room)
    this.persist(roomId)
  }

  persist(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room?.permanent) {
      this.deletePermanentRoom.run(roomId)
      return
    }
    const state: PersistedRoomState = {
      name: room.name,
      passwordEncrypted: encryptPassword(room.password),
      creatorId: room.creatorId,
      adminUserIds: Array.from(room.adminUserIds),
      hidden: room.hidden,
      audioQuality: room.audioQuality,
      queue: room.queue.map(withoutStreamUrl),
      currentTrack: room.currentTrack ? withoutStreamUrl(room.currentTrack) : null,
      playState: room.playState,
      playMode: room.playMode,
    }
    this.upsertPermanentRoom.run({ id: roomId, stateJson: JSON.stringify(state), updatedAt: Date.now() })
  }

  delete(roomId: string): void {
    this.rooms.delete(roomId)
    this.deletePermanentRoom.run(roomId)
    // Clean up reverse index for the deleted room
    this.roomToSockets.delete(roomId)
  }

  getAll(): ReadonlyMap<string, RoomData> {
    return this.rooms
  }

  getAllIds(): string[] {
    return Array.from(this.rooms.keys())
  }

  getPublicLobbyList(): RoomListItem[] {
    // This projection is exclusively for the public lobby. Direct joins and admin APIs use get()/getAll().
    return Array.from(this.rooms.values())
      .filter((room) => !room.hidden)
      .map((room) => ({
        id: room.id,
        name: room.name,
        hasPassword: room.password !== null,
        permanent: room.permanent,
        userCount: room.users.length,
        currentTrackTitle: room.currentTrack?.title ?? null,
        currentTrackArtist: room.currentTrack?.artist.join(', ') ?? null,
      }))
  }

  setSocketMapping(socketId: string, roomId: string, userId: string): void {
    // Remove from previous room's reverse index (if socket was mapped before)
    const prev = this.socketToRoom.get(socketId)
    if (prev) {
      const prevSet = this.roomToSockets.get(prev.roomId)
      if (prevSet) {
        prevSet.delete(socketId)
        if (prevSet.size === 0) this.roomToSockets.delete(prev.roomId)
      }
    }

    this.socketToRoom.set(socketId, { roomId, userId })

    // Add to new room's reverse index
    let socketSet = this.roomToSockets.get(roomId)
    if (!socketSet) {
      socketSet = new Set()
      this.roomToSockets.set(roomId, socketSet)
    }
    socketSet.add(socketId)
  }

  replaceUserId(oldUserId: string, newUserId: string): void {
    for (const mapping of this.socketToRoom.values()) {
      if (mapping.userId === oldUserId) mapping.userId = newUserId
    }
  }

  getSocketMapping(socketId: string): SocketMapping | undefined {
    return this.socketToRoom.get(socketId)
  }

  deleteSocketMapping(socketId: string): void {
    // Remove from reverse index
    const mapping = this.socketToRoom.get(socketId)
    if (mapping) {
      const socketSet = this.roomToSockets.get(mapping.roomId)
      if (socketSet) {
        socketSet.delete(socketId)
        if (socketSet.size === 0) this.roomToSockets.delete(mapping.roomId)
      }
    }

    this.socketToRoom.delete(socketId)
    this.socketRTT.delete(socketId)
  }

  hasOtherSocketForUser(roomId: string, userId: string, excludeSocketId: string): boolean {
    const sockets = this.roomToSockets.get(roomId)
    if (!sockets) return false
    for (const sid of sockets) {
      if (sid === excludeSocketId) continue
      const mapping = this.socketToRoom.get(sid)
      if (mapping && mapping.userId === userId && mapping.roomId === roomId) return true
    }
    return false
  }

  getSocketIdForUser(roomId: string, userId: string): string | null {
    const sockets = this.roomToSockets.get(roomId)
    if (!sockets) return null
    for (const sid of sockets) {
      const mapping = this.socketToRoom.get(sid)
      if (mapping && mapping.userId === userId && mapping.roomId === roomId) return sid
    }
    return null
  }

  setSocketRTT(socketId: string, rttMs: number): void {
    const prev = this.socketRTT.get(socketId)
    if (prev === undefined) {
      this.socketRTT.set(socketId, rttMs)
    } else {
      // Exponential moving average (alpha = 0.2) for smoothing
      this.socketRTT.set(socketId, prev * 0.8 + rttMs * 0.2)
    }
  }

  getSocketRTT(socketId: string): number {
    return this.socketRTT.get(socketId) ?? 0
  }

  getP90RTT(roomId: string): number {
    const sockets = this.roomToSockets.get(roomId)
    if (!sockets || sockets.size === 0) return 0

    const rtts: number[] = []
    for (const socketId of sockets) {
      const rtt = this.socketRTT.get(socketId) ?? 0
      if (rtt > 0) rtts.push(rtt)
    }
    if (rtts.length === 0) return 0

    // For very small rooms (≤3 sockets), P90 is meaningless — use max
    if (rtts.length <= 3) {
      return Math.max(...rtts)
    }

    rtts.sort((a, b) => a - b)
    const idx = Math.min(Math.floor(rtts.length * 0.9), rtts.length - 1)
    return rtts[idx]
  }
}

/** Singleton instance */
export const roomRepo = new InMemoryRoomRepository()
