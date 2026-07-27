/**
 * Room Lifecycle Service
 *
 * Manages timers (room deletion) and debounced lobby broadcasts.
 * Extracted from roomService to separate lifecycle/timer concerns from CRUD logic
 * and eliminate the circular dependency (roomService -> playerController -> roomService).
 *
 * Dependency direction:
 *   roomService -> roomLifecycleService -> (repos, playerService, voteService, authService)
 *   roomLifecycleService does NOT depend on roomService (no circular risk).
 *
 * Note: Role grace period has been removed. Owner role is permanent (based on creatorId),
 * admin is persisted via adminUserIds, temporary admin is assigned when no permanent
 * privileged user is online, and conductor (hostId) is auto-elected by electConductor()
 * in roomService whenever users join/leave.
 */

import type { RoomListItem } from '@music-together/shared'
import { EVENTS } from '@music-together/shared'
import { config } from '../config.js'
import type { TypedServer } from '../middleware/types.js'
import { chatRepo } from '../repositories/chatRepository.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { logger } from '../utils/logger.js'
import { cleanupRoom as cleanupAuthRoom } from './authService.js'
import { cleanupRoom as cleanupPlayerRoom } from './playerService.js'
import { cleanupRoom as cleanupVoteRoom } from './voteService.js'
import { cleanupRoomRejoinTickets } from './rejoinTicketService.js'

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** 宽限期定时器：房间变空后延迟删除，给断线用户重连的窗口 */
const roomDeletionTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 防抖广播：100ms trailing debounce */
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
let pendingIO: TypedServer | null = null

// ---------------------------------------------------------------------------
// Room deletion timer
// ---------------------------------------------------------------------------

export function scheduleDeletion(roomId: string, io?: TypedServer): void {
  // Prevent duplicate timers if called multiple times for the same room
  cancelDeletionTimer(roomId)

  logger.info(`房间 ${roomId} 已空置，将在 ${config.room.gracePeriodMs / 1000} 秒后删除`, {
    event: 'room.deletion_scheduled',
    roomId,
    gracePeriodMs: config.room.gracePeriodMs,
  })
  const timer = setTimeout(() => {
    const r = roomRepo.get(roomId)
    if (r && r.users.length === 0) {
      roomRepo.delete(roomId)
      chatRepo.deleteRoom(roomId)
      cleanupPlayerRoom(roomId)
      cleanupVoteRoom(roomId)
      cleanupAuthRoom(roomId)
      cleanupRoomRejoinTickets(roomId)
      roomDeletionTimers.delete(roomId)
      logger.info(`空置房间 ${roomId} 已删除`, { event: 'room.deleted', roomId })
      // Notify lobby users that the room is gone
      if (io) broadcastRoomList(io)
    }
  }, config.room.gracePeriodMs)
  roomDeletionTimers.set(roomId, timer)
}

export function cancelDeletionTimer(roomId: string): void {
  const timer = roomDeletionTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    roomDeletionTimers.delete(roomId)
    logger.info(`用户重新加入，已取消删除房间 ${roomId}`, { event: 'room.deletion_cancelled', roomId })
  }
}

/** Immediately dissolve a room and notify every connected member. */
export function destroyRoom(roomId: string, io: TypedServer): boolean {
  const room = roomRepo.get(roomId)
  if (!room) return false

  cancelDeletionTimer(roomId)
  for (const socket of io.getSocketsInRoom(roomId)) {
    roomRepo.deleteSocketMapping(socket.id)
    socket.leave(roomId)
    socket.join('lobby')
    socket.emit(EVENTS.ROOM_ERROR, { code: 'ROOM_NOT_FOUND', message: '房间已被服务器管理员解散' })
  }

  roomRepo.delete(roomId)
  chatRepo.deleteRoom(roomId)
  cleanupPlayerRoom(roomId)
  cleanupVoteRoom(roomId)
  cleanupAuthRoom(roomId)
  cleanupRoomRejoinTickets(roomId)
  broadcastRoomList(io)
  logger.info(`房间 ${roomId} 已被服务器管理员解散`, { event: 'room.dissolved', roomId })
  return true
}

// ---------------------------------------------------------------------------
// Debounced lobby broadcast
// ---------------------------------------------------------------------------

/**
 * 向 lobby 频道广播房间列表变更（100ms trailing 防抖）。
 * 多次快速调用（如 create+join、多人同时 leave）会合并为一次广播，
 * 避免重复执行 getAllAsList() 遍历和序列化。
 */
export function broadcastRoomList(io: TypedServer): void {
  pendingIO = io
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    if (pendingIO) {
      const rooms: RoomListItem[] = roomRepo.getAllAsList()
      pendingIO.to('lobby').emit(EVENTS.ROOM_LIST_UPDATE, rooms)
    }
  }, 100)
}

// ---------------------------------------------------------------------------
// Shutdown cleanup — clear all module-level timers
// ---------------------------------------------------------------------------

/** Clear all timers managed by this module. Call during graceful shutdown. */
export function clearAllTimers(): void {
  // Room deletion timers
  for (const timer of roomDeletionTimers.values()) clearTimeout(timer)
  roomDeletionTimers.clear()

  // Broadcast debounce timer
  if (broadcastTimer) {
    clearTimeout(broadcastTimer)
    broadcastTimer = null
  }
  pendingIO = null

  logger.debug('房间生命周期定时器已全部清理')
}
