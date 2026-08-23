import {
  HIGHEST_AUDIO_QUALITY,
  LIMITS,
  type ClientInfo,
  type RoomListItem,
  type RoomMember,
  type Track,
} from '@music-together/shared'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import { db } from './database.js'
import type { RoomData, RoomRepository, SocketMapping } from './types.js'

interface PermanentRoomRow {
  id: string
  state_json: string
}

interface PermanentRoomMemberRow {
  user_id: string
  nickname: string
  avatar_url: string | null
  user_role: 'user' | 'admin'
  joined_at: number
  last_seen_at: number
}

interface PersistedRoomState {
  name: RoomData['name']
  /** Legacy plaintext field retained only for reading databases created before encryption. */
  password?: RoomData['password']
  passwordEncrypted?: string | null
  creatorId: RoomData['creatorId']
  adminUserIds: string[]
  hidden?: boolean
  /** Legacy combined setting, migrated to both granular permissions when read. */
  allowTemporaryAdminQueueManagement?: boolean
  allowTemporaryAdminTrackRemoval?: boolean
  allowTemporaryAdminQueueClear?: boolean
  audioQuality: RoomData['audioQuality']
  queue: RoomData['queue']
  currentTrack: RoomData['currentTrack']
  playState: RoomData['playState']
  playMode: RoomData['playMode']
}

interface PermanentRoomAudioQualityMigration {
  state: PersistedRoomState
  previousAudioQuality: RoomData['audioQuality']
  audioQuality: RoomData['audioQuality']
}

/**
 * Do not migrate every `999` room: that value was both the old automatic
 * maximum and the explicit lossless-SQ choice. Per the migration policy,
 * provider-specific qualities at or above lossless SQ are normalized for every
 * permanent room.
 */
const LEGACY_AUTOMATIC_HIGHEST_AUDIO_QUALITIES = new Set<RoomData['audioQuality']>([
  'netease_hires',
  'netease_jyeffect',
  'netease_dolby',
  'netease_spatial',
  'netease_master',
  'tencent_flac',
  'tencent_master',
  'kugou_hires',
  'kugou_master',
])

function migratePermanentRoomAudioQuality(state: PersistedRoomState): PermanentRoomAudioQualityMigration | null {
  if (!LEGACY_AUTOMATIC_HIGHEST_AUDIO_QUALITIES.has(state.audioQuality)) return null

  return {
    state: { ...state, audioQuality: HIGHEST_AUDIO_QUALITY },
    previousAudioQuality: state.audioQuality,
    audioQuality: HIGHEST_AUDIO_QUALITY,
  }
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

function restorePlayState(state: PersistedRoomState): RoomData['playState'] {
  const persisted = state.playState
  const currentTime = Number(persisted?.currentTime)
  const revision = Number(persisted?.revision)
  return {
    // A server restart cannot keep an audio stream playing. Mark the room
    // paused until the first member joins and the URL is refreshed.
    isPlaying: false,
    currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
    serverTimestamp: Date.now(),
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
  }
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
  private updateMigratedPermanentRoom = db.prepare(`
    UPDATE permanent_rooms
    SET state_json = @stateJson, updated_at = @updatedAt
    WHERE id = @id AND state_json = @previousStateJson
  `)
  private selectPermanentRoomMembers = db.prepare<[string], PermanentRoomMemberRow>(`
    SELECT
      members.user_id,
      users.nickname,
      users.avatar_url,
      users.role AS user_role,
      members.joined_at,
      members.last_seen_at
    FROM permanent_room_members AS members
    JOIN users ON users.id = members.user_id
    WHERE members.room_id = ?
    ORDER BY members.joined_at ASC
  `)
  private insertLegacyPermanentMember = db.prepare(`
    INSERT INTO permanent_room_members (room_id, user_id, joined_at, last_seen_at)
    SELECT @roomId, users.id, @now, @now
    FROM users
    WHERE users.id = @userId
    ON CONFLICT(room_id, user_id) DO NOTHING
  `)
  private upsertPermanentMember = db.prepare(`
    INSERT INTO permanent_room_members (room_id, user_id, joined_at, last_seen_at)
    VALUES (@roomId, @userId, @joinedAt, @lastSeenAt)
    ON CONFLICT(room_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `)

  constructor() {
    const rows = db.prepare<[], PermanentRoomRow>('SELECT id, state_json FROM permanent_rooms').all()
    for (const row of rows) {
      try {
        let state = JSON.parse(row.state_json) as PersistedRoomState
        const migration = migratePermanentRoomAudioQuality(state)
        if (migration) {
          try {
            const result = this.updateMigratedPermanentRoom.run({
              id: row.id,
              stateJson: JSON.stringify(migration.state),
              previousStateJson: row.state_json,
              updatedAt: Date.now(),
            })
            if (result.changes === 1) {
              state = migration.state
              logger.info(
                `永久房间 ${row.id} 的旧版音质配置已从 ${migration.previousAudioQuality} 迁移为 ${migration.audioQuality}`,
                {
                  event: 'permanent_room.audio_quality_migrated',
                  roomId: row.id,
                  previousAudioQuality: migration.previousAudioQuality,
                  audioQuality: migration.audioQuality,
                },
              )
            } else {
              logger.warn(`永久房间 ${row.id} 的音质配置迁移已跳过：房间状态已发生变化`, {
                event: 'permanent_room.audio_quality_migration_skipped',
                roomId: row.id,
                previousAudioQuality: migration.previousAudioQuality,
                audioQuality: migration.audioQuality,
              })
            }
          } catch (error) {
            // A migration failure must not prevent this or other rooms from loading.
            logger.warn(`永久房间 ${row.id} 的旧版音质配置迁移失败`, {
              event: 'permanent_room.audio_quality_migration_failed',
              roomId: row.id,
              previousAudioQuality: migration.previousAudioQuality,
              audioQuality: migration.audioQuality,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        const memberIds = [state.creatorId, ...(state.adminUserIds ?? [])]
        const now = Date.now()
        for (const userId of memberIds) {
          this.insertLegacyPermanentMember.run({ roomId: row.id, userId, now })
        }

        const members = this.loadPermanentMembers(row.id, state.creatorId, new Set(state.adminUserIds ?? []))
        this.rooms.set(row.id, {
          id: row.id,
          name: state.name,
          password:
            state.passwordEncrypted !== undefined ? decryptPassword(state.passwordEncrypted) : (state.password ?? null),
          creatorId: state.creatorId,
          hostId: state.creatorId,
          adminUserIds: new Set(state.adminUserIds ?? []),
          temporaryAdminUserId: null,
          allowTemporaryAdminTrackRemoval:
            state.allowTemporaryAdminTrackRemoval ?? state.allowTemporaryAdminQueueManagement ?? false,
          allowTemporaryAdminQueueClear:
            state.allowTemporaryAdminQueueClear ?? state.allowTemporaryAdminQueueManagement ?? false,
          hidden: state.hidden ?? false,
          permanent: true,
          audioQuality: state.audioQuality,
          members,
          users: [],
          queue: (state.queue ?? []).slice(0, LIMITS.QUEUE_MAX_SIZE).map(withoutStreamUrl),
          currentTrack: state.currentTrack ? withoutStreamUrl(state.currentTrack) : null,
          playState: restorePlayState(state),
          playMode: state.playMode ?? 'loop-all',
        })
      } catch (error) {
        logger.warn(`永久房间 ${row.id} 加载失败`, {
          event: 'permanent_room.load_failed',
          roomId: row.id,
          error: error instanceof Error ? error.message : String(error),
        })
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
      allowTemporaryAdminTrackRemoval: room.allowTemporaryAdminTrackRemoval,
      allowTemporaryAdminQueueClear: room.allowTemporaryAdminQueueClear,
      audioQuality: room.audioQuality,
      queue: room.queue.map(withoutStreamUrl),
      currentTrack: room.currentTrack ? withoutStreamUrl(room.currentTrack) : null,
      playState: room.playState,
      playMode: room.playMode,
    }
    this.upsertPermanentRoom.run({ id: roomId, stateJson: JSON.stringify(state), updatedAt: Date.now() })
    for (const member of room.members) {
      this.upsertPermanentMember.run({
        roomId,
        userId: member.id,
        joinedAt: member.joinedAt,
        lastSeenAt: member.lastSeenAt ?? member.joinedAt,
      })
    }
  }

  private loadPermanentMembers(roomId: string, creatorId: string, adminUserIds: Set<string>): RoomMember[] {
    return this.selectPermanentRoomMembers.all(roomId).map((member) => ({
      id: member.user_id,
      nickname: member.nickname,
      avatarUrl: member.avatar_url,
      role: member.user_id === creatorId ? 'owner' : adminUserIds.has(member.user_id) ? 'admin' : 'member',
      isServerAdmin: config.serverAdminIds.has(member.user_id) || member.user_role === 'admin',
      isOnline: false,
      joinedAt: member.joined_at,
      lastSeenAt: member.last_seen_at,
    }))
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

  setSocketMapping(socketId: string, roomId: string, userId: string, client?: ClientInfo): void {
    // Remove from previous room's reverse index (if socket was mapped before)
    const prev = this.socketToRoom.get(socketId)
    if (prev) {
      const prevSet = this.roomToSockets.get(prev.roomId)
      if (prevSet) {
        prevSet.delete(socketId)
        if (prevSet.size === 0) this.roomToSockets.delete(prev.roomId)
      }
    }

    this.socketToRoom.set(socketId, { roomId, userId, client })

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

  getClientInfosForUser(roomId: string, userId: string): ClientInfo[] {
    const sockets = this.roomToSockets.get(roomId)
    if (!sockets) return []
    const clients: ClientInfo[] = []
    for (const socketId of sockets) {
      const mapping = this.socketToRoom.get(socketId)
      if (mapping?.roomId === roomId && mapping.userId === userId && mapping.client) {
        clients.push(mapping.client)
      }
    }
    return clients
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
