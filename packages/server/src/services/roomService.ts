import { timingSafeEqual } from 'node:crypto'
import type { AudioQuality, RoomListItem, User, UserRole } from '@music-together/shared'
import { nanoid } from 'nanoid'
import type { RoomData } from '../repositories/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { chatRepo } from '../repositories/chatRepository.js'
import { scheduleDeletion, cancelDeletionTimer } from './roomLifecycleService.js'
import { consumeRejoinTicket } from './rejoinTicketService.js'
import { estimateCurrentTime } from './syncService.js'
import { updateVoteThreshold } from './voteService.js'
import { logger } from '../utils/logger.js'
import type { TypedServer } from '../middleware/types.js'
import { userRepo } from '../repositories/userRepository.js'

// Re-export from their new homes so existing `roomService.xxx()` callers
// in controllers don't need import changes.
export { toPublicRoomState, toPublicRoomStateForOwner } from '../utils/roomUtils.js'
export { broadcastRoomList } from './roomLifecycleService.js'

// ---------------------------------------------------------------------------
// Room role invariant + conductor election
// ---------------------------------------------------------------------------

function isPermanentPrivileged(room: RoomData, userId: string): boolean {
  return userId === room.creatorId || room.adminUserIds.has(userId)
}

function setRoleIfChanged(user: User, role: UserRole): boolean {
  if (user.role === role) return false
  user.role = role
  return true
}

/**
 * 保证非空房间始终至少有一个具备管理能力的在线用户。
 *
 * - creator 在线：creator 为 owner，清除临时管理员
 * - 持久 admin 在线：保持 admin，清除临时管理员
 * - owner / 持久 admin 都不在线：授予一个在线用户临时 admin
 *
 * 临时 admin 仅存在于当前在线会话，不写入 adminUserIds；当 owner / 持久 admin
 * 回来时自动降回 member。
 */
function reconcileRoomRoles(room: RoomData): boolean {
  let changed = false

  if (room.users.length === 0) {
    if (room.temporaryAdminUserId !== null) {
      room.temporaryAdminUserId = null
      changed = true
    }
    return changed
  }

  const hasOnlinePermanentPrivileged = room.users.some((u) => isPermanentPrivileged(room, u.id))

  if (hasOnlinePermanentPrivileged) {
    if (room.temporaryAdminUserId !== null) {
      room.temporaryAdminUserId = null
      changed = true
    }
    for (const user of room.users) {
      const role: UserRole = user.id === room.creatorId ? 'owner' : room.adminUserIds.has(user.id) ? 'admin' : 'member'
      changed = setRoleIfChanged(user, role) || changed
    }
    return changed
  }

  const currentTempStillOnline = room.users.some((u) => u.id === room.temporaryAdminUserId)
  if (!room.temporaryAdminUserId || !currentTempStillOnline) {
    room.temporaryAdminUserId = room.users[0]!.id
    changed = true
  }

  for (const user of room.users) {
    changed = setRoleIfChanged(user, user.id === room.temporaryAdminUserId ? 'admin' : 'member') || changed
  }

  return changed
}

/**
 * 从在线用户中选出最高优先级的 conductor（播放主持）。
 * 优先级：owner > admin(含临时 admin) > member（按加入顺序）。
 */
function electConductor(room: RoomData): boolean {
  const prev = room.hostId
  const candidate =
    room.users.find((u) => u.role === 'owner') ?? room.users.find((u) => u.role === 'admin') ?? room.users[0]
  room.hostId = candidate?.id ?? room.hostId

  if (room.hostId !== prev) {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Public API — Room CRUD
// ---------------------------------------------------------------------------

export function createRoom(
  socketId: string,
  nickname: string,
  roomName?: string,
  password?: string | null,
  persistentUserId?: string,
): { room: RoomData; user: User } {
  const roomId = nanoid(6).toUpperCase()
  const userId = persistentUserId || socketId
  const persistedUser = userRepo.ensure(userId, { nickname })
  const profile = persistedUser.nickname ? persistedUser : userRepo.updateProfile(userId, { nickname })
  const user: User = {
    id: userId,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    role: 'owner',
    isServerAdmin: userRepo.isServerAdmin(userId),
  }

  const room: RoomData = {
    id: roomId,
    name: roomName?.trim() || `${nickname}的房间`,
    password: password || null,
    creatorId: userId,
    hostId: userId,
    adminUserIds: new Set(),
    temporaryAdminUserId: null,
    hidden: false,
    permanent: false,
    audioQuality: 320,
    users: [user],
    queue: [],
    currentTrack: null,
    playState: {
      isPlaying: false,
      currentTime: 0,
      serverTimestamp: Date.now(),
    },
    playMode: 'loop-all',
  }

  roomRepo.set(roomId, room)
  chatRepo.createRoom(roomId)
  roomRepo.setSocketMapping(socketId, roomId, userId)

  logger.info(`房间已创建：${room.name}（${roomId}），房主：${nickname}`, {
    event: 'room.created',
    roomId,
    roomName: room.name,
    userId,
    nickname,
    audioQuality: room.audioQuality,
    playMode: room.playMode,
    passwordProtected: room.password !== null,
  })
  return { room, user }
}

export function joinRoom(
  socketId: string,
  roomId: string,
  nickname: string,
  persistentUserId?: string,
): { room: RoomData; user: User; hostChanged: boolean; roleChanged: boolean } | null {
  const room = roomRepo.get(roomId)
  if (!room) return null

  // Cancel any pending room deletion (e.g. user refreshed and is rejoining)
  cancelDeletionTimer(roomId)

  const userId = persistentUserId || socketId
  const persistedUser = userRepo.ensure(userId, { nickname })
  const profile = persistedUser.nickname ? persistedUser : userRepo.updateProfile(userId, { nickname })
  const isCreator = userId === room.creatorId

  // Determine the permission role — purely based on identity, no grace logic
  function resolveRole(): User['role'] {
    if (isCreator) return 'owner'
    if (room!.adminUserIds.has(userId)) return 'admin'
    return 'member'
  }

  // Rejoin — update existing user entry instead of creating duplicate
  const existing = room.users.find((u) => u.id === userId)
  if (existing) {
    existing.nickname = profile.nickname
    existing.avatarUrl = profile.avatarUrl
    existing.role = resolveRole()
    existing.isServerAdmin = userRepo.isServerAdmin(userId)
    roomRepo.setSocketMapping(socketId, roomId, userId)
    const roleChanged = reconcileRoomRoles(room)
    const hostChanged = electConductor(room)
    return { room, user: existing, hostChanged, roleChanged }
  }

  // New user entry
  const role = resolveRole()
  const user: User = {
    id: userId,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    role,
    isServerAdmin: userRepo.isServerAdmin(userId),
  }
  room.users.push(user)
  roomRepo.setSocketMapping(socketId, roomId, userId)

  // Reconcile roles first so owner/admin returning clears any temporary admin.
  const roleChanged = reconcileRoomRoles(room)
  // Re-elect conductor (owner joining takes priority over current conductor)
  const hostChanged = electConductor(room)

  logger.info(`用户“${nickname}”加入房间 ${roomId}`, {
    event: 'room.user_joined',
    roomId,
    userId,
    nickname,
    role,
    onlineUsers: room.users.length,
    conductorId: room.hostId,
  })
  return { room, user, hostChanged, roleChanged }
}

export function leaveRoom(
  socketId: string,
  io?: TypedServer,
): {
  roomId: string
  user: User
  room: RoomData | null
  hostChanged: boolean
  roleChanged: boolean
  voteUpdated: boolean
  staleSocketOnly: boolean
} | null {
  const mapping = roomRepo.getSocketMapping(socketId)
  if (!mapping) return null

  const { roomId, userId } = mapping
  const room = roomRepo.get(roomId)
  if (!room) return null

  const user = room.users.find((u) => u.id === userId)
  if (!user) return null

  // Race condition guard: if the user has another active socket in this room
  // (e.g. page refresh — new socket joined before old socket disconnected),
  // only clean up the stale mapping without removing the user from the room.
  if (roomRepo.hasOtherSocketForUser(roomId, userId, socketId)) {
    roomRepo.deleteSocketMapping(socketId)
    logger.debug('忽略用户旧连接的断开事件（已有新连接）', { roomId, userId, socketId })
    return { roomId, user, room, hostChanged: false, roleChanged: false, voteUpdated: false, staleSocketOnly: true }
  }

  room.users = room.users.filter((u) => u.id !== userId)
  roomRepo.deleteSocketMapping(socketId)

  // An empty room has no conductor to advance the queue. Freeze the
  // server-authoritative position as soon as the last user
  // leaves so permanent rooms do not keep accumulating playback time while
  // nobody is listening. Persist before scheduling cleanup because permanent
  // rooms return early from scheduleDeletion().
  if (room.users.length === 0) {
    reconcileRoomRoles(room)
    if (room.playState.isPlaying) {
      room.playState = {
        isPlaying: false,
        currentTime: estimateCurrentTime(roomId),
        serverTimestamp: Date.now(),
      }
      roomRepo.persist(roomId)
      logger.info(`房间 ${roomId} 已无人在线，播放已自动暂停`, {
        event: 'player.auto_paused_empty_room',
        roomId,
        currentTime: room.playState.currentTime,
      })
    }
    scheduleDeletion(roomId, io)
    return { roomId, user, room, hostChanged: false, roleChanged: false, voteUpdated: false, staleSocketOnly: false }
  }

  // Keep at least one online admin-capable user before electing conductor.
  const roleChanged = reconcileRoomRoles(room)
  // Re-elect conductor immediately — no grace period
  const hostChanged = electConductor(room)

  // Update active vote threshold so it doesn't become impossible to pass
  const voteUpdated = updateVoteThreshold(roomId, room.users.length, user.id)

  logger.info(`用户“${user.nickname}”离开房间 ${roomId}`, {
    event: 'room.user_left',
    roomId,
    userId: user.id,
    nickname: user.nickname,
    role: user.role,
    onlineUsers: room.users.length,
    conductorChanged: hostChanged,
    roleChanged,
  })
  return { roomId, user, room, hostChanged, roleChanged, voteUpdated, staleSocketOnly: false }
}

// ---------------------------------------------------------------------------
// Public API — Read / Settings / Roles
// ---------------------------------------------------------------------------

export function getRoom(roomId: string): RoomData | undefined {
  return roomRepo.get(roomId)
}

export function listPublicRooms(): RoomListItem[] {
  return roomRepo.getPublicLobbyList()
}

export function updateSettings(
  roomId: string,
  settings: {
    name?: string
    password?: string | null
    audioQuality?: AudioQuality
    hidden?: boolean
    permanent?: boolean
  },
): void {
  const room = roomRepo.get(roomId)
  if (!room) return

  if (settings.name !== undefined) {
    room.name = settings.name
  }

  // password: string -> set password; null -> remove password; undefined -> no change
  if (settings.password !== undefined) {
    room.password = settings.password
  }

  if (settings.audioQuality !== undefined) {
    room.audioQuality = settings.audioQuality
  }

  if (settings.hidden !== undefined) {
    room.hidden = settings.hidden
  }

  if (settings.permanent !== undefined) {
    room.permanent = settings.permanent
  }

  roomRepo.persist(roomId)
  if (room.permanent) {
    chatRepo.persistRoom(roomId)
  }
}

export function setUserRole(
  roomId: string,
  targetUserId: string,
  role: 'admin' | 'member',
): { success: boolean; roleChanged: boolean; hostChanged: boolean } {
  const room = roomRepo.get(roomId)
  if (!room) return { success: false, roleChanged: false, hostChanged: false }
  const user = room.users.find((u) => u.id === targetUserId)
  if (!user) return { success: false, roleChanged: false, hostChanged: false }
  // Cannot change owner's role
  if (user.role === 'owner') return { success: false, roleChanged: false, hostChanged: false }

  const directRoleChanged = setRoleIfChanged(user, role)
  // Sync persistent admin set
  if (role === 'admin') {
    room.adminUserIds.add(targetUserId)
  } else {
    room.adminUserIds.delete(targetUserId)
  }
  const reconciledRoleChanged = reconcileRoomRoles(room)
  // Re-elect conductor (admin promotion/demotion may change priority)
  const hostChanged = electConductor(room)
  roomRepo.persist(roomId)
  return { success: true, roleChanged: directRoleChanged || reconciledRoleChanged, hostChanged }
}

export function getUserBySocket(socketId: string): User | null {
  const mapping = roomRepo.getSocketMapping(socketId)
  if (!mapping) return null
  const room = roomRepo.get(mapping.roomId)
  if (!room) return null
  return room.users.find((u) => u.id === mapping.userId) ?? null
}

export function getRoomBySocket(socketId: string): { roomId: string; room: RoomData } | null {
  const mapping = roomRepo.getSocketMapping(socketId)
  if (!mapping) return null
  const room = roomRepo.get(mapping.roomId)
  if (!room) return null
  return { roomId: mapping.roomId, room }
}

// ---------------------------------------------------------------------------
// Join validation (business logic extracted from roomController)
// ---------------------------------------------------------------------------

/** Constant-time string comparison to mitigate timing attacks */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface JoinValidationResult {
  valid: boolean
  errorCode?: string
  errorMessage?: string
  /** Whether this is a rejoin (user already in room or same socket mapping) — skip join notification */
  isRejoin: boolean
  /** Whether password should be bypassed (rejoin, creator, or persistent admin) */
  skipPassword: boolean
}

/**
 * Validate a join request: check room existence, password, rejoin scenarios.
 * Pure business logic — no socket operations.
 */
export function validateJoinRequest(
  roomId: string,
  socketId: string,
  identityUserId: string,
  password?: string,
  rejoinToken?: string,
): JoinValidationResult {
  const room = roomRepo.get(roomId)
  if (!room) {
    return {
      valid: false,
      errorCode: 'ROOM_NOT_FOUND',
      errorMessage: '房间不存在',
      isRejoin: false,
      skipPassword: false,
    }
  }

  const existingMapping = roomRepo.getSocketMapping(socketId)
  const effectiveUserId = identityUserId
  const alreadyInRoom = room.users.some((u) => u.id === effectiveUserId)
  const isCreator = effectiveUserId === room.creatorId
  const isPersistentAdmin = room.adminUserIds.has(effectiveUserId)
  const isServerAdmin = userRepo.isServerAdmin(effectiveUserId)
  const hasValidRejoinTicket =
    typeof rejoinToken === 'string' && rejoinToken.length > 0
      ? consumeRejoinTicket(rejoinToken, roomId, effectiveUserId)
      : false

  // Password bypass: same socket mapping, already in room, creator, or persistent admin
  const skipPassword =
    hasValidRejoinTicket ||
    existingMapping?.roomId === roomId ||
    alreadyInRoom ||
    isCreator ||
    isPersistentAdmin ||
    isServerAdmin
  // Notification skip: only when user is literally still in the room
  const isRejoin = existingMapping?.roomId === roomId || alreadyInRoom

  if (!skipPassword && room.password !== null) {
    if (!password || !safeCompare(password, room.password)) {
      return { valid: false, errorCode: 'WRONG_PASSWORD', errorMessage: '密码错误', isRejoin, skipPassword }
    }
  }

  // Auto-leave check: if the socket is mapped to a different room, the caller
  // should call leaveRoom before proceeding. We just flag the scenario here.

  return { valid: true, isRejoin, skipPassword }
}
