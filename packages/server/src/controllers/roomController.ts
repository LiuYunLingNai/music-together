import {
  ERROR_CODE,
  EVENTS,
  roomCreateSchema,
  roomJoinSchema,
  roomSettingsSchema,
  setRoleSchema,
} from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../middleware/types.js'
import { createWithOwnerOnly } from '../middleware/withControl.js'
import { createWithRoom } from '../middleware/withRoom.js'
import { cleanupSocketRateLimit } from '../middleware/socketRateLimiter.js'
import { roomRepo } from '../repositories/roomRepository.js'
import type { RoomData } from '../repositories/types.js'
import { userRepo } from '../repositories/userRepository.js'
import * as chatService from '../services/chatService.js'
import * as authService from '../services/authService.js'
import * as playerService from '../services/playerService.js'
import { issueRejoinTicket, revokeRejoinTickets } from '../services/rejoinTicketService.js'
import * as roomService from '../services/roomService.js'
import { getClientInfo } from '../services/clientInfoService.js'
import * as voteService from '../services/voteService.js'
import { executeVoteAction } from '../services/voteActionService.js'
import { logger } from '../utils/logger.js'

async function reconcileAndBroadcastVote(io: TypedServer, roomId: string, room: RoomData): Promise<void> {
  const result = voteService.reconcileVote(
    roomId,
    room.users.map((user) => user.id),
    room.hostId,
  )
  if (!result) return
  if (!result.decided) {
    io.to(roomId).emit(EVENTS.VOTE_STARTED, voteService.toVoteState(result.vote))
    return
  }

  const claimedVote = voteService.claimVote(roomId, result.vote.id)
  if (!claimedVote) return
  const executed = result.passed ? await executeVoteAction(io, roomId, claimedVote.action, claimedVote.payload) : false
  io.to(roomId).emit(EVENTS.VOTE_RESULT, {
    passed: result.passed && executed,
    action: claimedVote.action,
    reason: result.passed && !executed ? 'action_failed' : result.reason,
  })
}

export function registerRoomController(io: TypedServer, socket: TypedSocket) {
  const withRoom = createWithRoom(io)
  const withOwnerOnly = createWithOwnerOnly(io)

  // ---- Room list (不需要在房间内) ----
  socket.on(EVENTS.ROOM_LIST, () => {
    try {
      socket.emit(EVENTS.ROOM_LIST_UPDATE, roomService.listPublicRooms())
    } catch (err) {
      logger.error('ROOM_LIST handler error', err, { socketId: socket.id })
    }
  })

  // ---- Create room (含可选密码) ----
  socket.on(EVENTS.ROOM_CREATE, (raw) => {
    try {
      const parsed = roomCreateSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }
      const { nickname, roomName, password } = parsed.data

      // Auto-leave any previous room before creating a new one
      handleLeave(io, socket, 'auto-leave before create', true)

      const { room, user } = roomService.createRoom(
        socket.id,
        nickname.trim(),
        roomName,
        password,
        socket.data.identityUserId,
        getClientInfo(socket.handshake.headers),
      )

      socket.leave('lobby')
      socket.join(room.id)
      authService.restoreUserCookies(room.id, user.id)
      void refreshRestoredMembershipDetails(io, socket, room.id, user.id)
      socket.emit(EVENTS.ROOM_CREATED, { roomId: room.id, userId: user.id })
      // 创建者是 owner，发送含密码的完整状态
      socket.emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(room))
      const rejoin = issueRejoinTicket(room.id, user.id)
      socket.emit(EVENTS.ROOM_REJOIN_TOKEN, { roomId: room.id, token: rejoin.token, expiresAt: rejoin.expiresAt })

      // 广播房间列表给大厅用户
      roomService.broadcastRoomList(io)
    } catch (err) {
      logger.error('ROOM_CREATE handler error', err, { socketId: socket.id })
      socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INTERNAL, message: '服务器内部错误' })
    }
  })

  // ---- Join room (含密码校验) ----
  socket.on(EVENTS.ROOM_JOIN, async (raw) => {
    try {
      const parsed = roomJoinSchema.safeParse(raw)
      if (!parsed.success) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }
      const { roomId, nickname, password, rejoinToken } = parsed.data

      // Validate join request (password, rejoin scenarios) — pure business logic
      const validation = roomService.validateJoinRequest(
        roomId,
        socket.id,
        socket.data.identityUserId,
        password,
        rejoinToken,
      )
      if (!validation.valid) {
        socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE[validation.errorCode as keyof typeof ERROR_CODE] ?? ERROR_CODE.JOIN_FAILED,
          message: validation.errorMessage ?? '加入房间失败',
        })
        return
      }

      // Auto-leave any previous room (different from target) before joining
      const existingMapping = roomRepo.getSocketMapping(socket.id)
      if (existingMapping && existingMapping.roomId !== roomId) {
        handleLeave(io, socket, 'auto-leave before join', true)
      }

      const result = roomService.joinRoom(
        socket.id,
        roomId,
        nickname.trim(),
        socket.data.identityUserId,
        getClientInfo(socket.handshake.headers),
      )
      if (!result) {
        socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.JOIN_FAILED, message: '加入房间失败' })
        return
      }

      const { room: updatedRoom, user, hostChanged, roleChanged } = result
      const rejoin = issueRejoinTicket(roomId, user.id)

      socket.leave('lobby')
      authService.restoreUserCookies(roomId, user.id)

      // Legacy persisted accounts may still carry a coarse membership tier.
      // Refresh it before resolving the permanent room stream so an SVIP
      // account does not get its first URL capped at the old VIP quality.
      await refreshRestoredMembershipDetails(io, socket, roomId, user.id)
      if (!socket.connected) return

      // Permanent rooms can retain a short-lived URL while empty. Refresh it
      // on demand before exposing room state, with service-level throttling.
      await playerService.refreshStreamUrlForJoin(roomId)
      if (!socket.connected) return
      socket.join(roomId)

      // Send history before ROOM_STATE. The lobby navigates as soon as it receives
      // ROOM_STATE, which creates a brief gap before the room listeners mount.
      socket.emit(EVENTS.CHAT_HISTORY, chatService.getHistory(roomId))

      // Resume playback before sending the initial room state. PLAYER_PLAY may
      // arrive before the room page mounts its player listener, so ROOM_STATE
      // must already describe the resumed state for client-side recovery.
      playerService.preparePlaybackForJoiningRoom(roomId, updatedRoom)

      // Send full room state
      // Owner 收到含密码版本，其他成员收到不含密码版本
      const isOwner = user.role === 'owner'
      const stateForJoiner = isOwner
        ? roomService.toPublicRoomStateForOwner(updatedRoom)
        : roomService.toPublicRoomState(updatedRoom)
      socket.emit(EVENTS.ROOM_STATE, stateForJoiner)

      // Broadcast role/conductor changes and rejoin updates so the roster's
      // current device label stays in sync when a member reconnects elsewhere.
      if (hostChanged || roleChanged || validation.isRejoin) {
        socket.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(updatedRoom))
      }
      socket.emit(EVENTS.ROOM_REJOIN_TOKEN, { roomId, token: rejoin.token, expiresAt: rejoin.expiresAt })
      socket.emit(EVENTS.AUTH_MY_STATUS, authService.getUserAuthStatus(user.id, roomId))
      io.to(roomId).emit(EVENTS.AUTH_STATUS_UPDATE, authService.getAllPlatformStatus(roomId))

      // Sync playback state to the joining client (auto-resume, auto-play)
      playerService.syncPlaybackToSocket(io, socket, roomId, updatedRoom).catch((err) => {
        logger.error('syncPlaybackToSocket failed', err, { roomId })
      })

      await reconcileAndBroadcastVote(io, roomId, updatedRoom)

      // Send active vote state if one is in progress
      const activeVote = voteService.getActiveVote(roomId)
      if (activeVote) {
        socket.emit(EVENTS.VOTE_STARTED, voteService.toVoteState(activeVote))
      }

      // Notify others (skip for rejoin — they already know the user is in the room)
      if (!validation.isRejoin) {
        socket.to(roomId).emit(EVENTS.ROOM_USER_JOINED, user)
        // System message for user joined (server-authoritative)
        const joinMsg = chatService.createSystemMessage(roomId, `${user.nickname} 加入了房间`)
        io.to(roomId).emit(EVENTS.CHAT_MESSAGE, joinMsg)
      }

      // 更新大厅房间列表（人数变了）
      roomService.broadcastRoomList(io)
    } catch (err) {
      logger.error('ROOM_JOIN handler error', err, { socketId: socket.id })
      socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.INTERNAL, message: '服务器内部错误' })
    }
  })

  // ---- Leave room (explicit user action) ----
  socket.on(EVENTS.ROOM_LEAVE, () => {
    try {
      logger.debug('收到用户主动离开房间请求', { socketId: socket.id })
      handleLeave(io, socket, undefined, true)
    } catch (err) {
      logger.error('ROOM_LEAVE handler error', err, { socketId: socket.id })
    }
  })

  // ---- Room settings (房主可管理全部设置，管理员仅可调整音质) ----
  socket.on(
    EVENTS.ROOM_SETTINGS,
    withRoom((ctx, raw) => {
      const parsed = roomSettingsSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }

      const changedFields = Object.keys(parsed.data).filter(
        (key) => parsed.data[key as keyof typeof parsed.data] !== undefined,
      )
      const canManageAllSettings = ctx.user.role === 'owner' || userRepo.isServerAdmin(ctx.user.id)
      const canAdjustAudioQuality =
        ctx.user.role === 'admin' && changedFields.length === 1 && changedFields[0] === 'audioQuality'
      if (!canManageAllSettings && !canAdjustAudioQuality) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.NO_PERMISSION,
          message: '只有房主可以修改房间设置，管理员仅可调整音质',
        })
        return
      }

      roomService.updateSettings(ctx.roomId, {
        name: parsed.data.name,
        password: parsed.data.password,
        audioQuality: parsed.data.audioQuality,
        hidden: parsed.data.hidden,
        permanent: parsed.data.permanent,
        allowTemporaryAdminTrackRemoval: parsed.data.allowTemporaryAdminTrackRemoval,
        allowTemporaryAdminQueueClear: parsed.data.allowTemporaryAdminQueueClear,
      })

      const updatedRoom = roomRepo.get(ctx.roomId)
      if (!updatedRoom) return

      // 仅房主或服务器管理员操作时向操作者返回密码明文。
      const baseSettings = {
        name: updatedRoom.name,
        hasPassword: updatedRoom.password !== null,
        hidden: updatedRoom.hidden,
        permanent: updatedRoom.permanent,
        allowTemporaryAdminTrackRemoval: updatedRoom.allowTemporaryAdminTrackRemoval,
        allowTemporaryAdminQueueClear: updatedRoom.allowTemporaryAdminQueueClear,
        audioQuality: updatedRoom.audioQuality,
      }
      if (canManageAllSettings) {
        ctx.socket.emit(EVENTS.ROOM_SETTINGS, {
          ...baseSettings,
          password: updatedRoom.password ?? null,
        })
        ctx.socket.to(ctx.roomId).emit(EVENTS.ROOM_SETTINGS, baseSettings)
      } else {
        io.to(ctx.roomId).emit(EVENTS.ROOM_SETTINGS, baseSettings)
      }

      logger.info(`房间 ${ctx.roomId} 的设置已更新`, {
        event: 'room.settings_updated',
        roomId: ctx.roomId,
        operatorId: ctx.user.id,
        operator: ctx.user.nickname,
        operatorIsServerAdmin: userRepo.isServerAdmin(ctx.user.id),
        roomName: updatedRoom.name,
        audioQuality: updatedRoom.audioQuality,
        passwordProtected: updatedRoom.password !== null,
        hidden: updatedRoom.hidden,
        permanent: updatedRoom.permanent,
        allowTemporaryAdminTrackRemoval: updatedRoom.allowTemporaryAdminTrackRemoval,
        allowTemporaryAdminQueueClear: updatedRoom.allowTemporaryAdminQueueClear,
        changedFields,
      })

      // 密码变更也要刷新大厅列表
      roomService.broadcastRoomList(io)
    }),
  )

  // ---- Set user role (仅房主) ----
  socket.on(
    EVENTS.ROOM_SET_ROLE,
    withOwnerOnly((ctx, raw) => {
      const parsed = setRoleSchema.safeParse(raw)
      if (!parsed.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.INVALID_INPUT,
          message: parsed.error.issues[0]?.message ?? '输入格式错误',
        })
        return
      }

      const { userId, role } = parsed.data
      const result = roomService.setUserRole(ctx.roomId, userId, role)
      if (!result.success) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, { code: ERROR_CODE.SET_ROLE_FAILED, message: '无法设置该用户的角色' })
        return
      }

      io.to(ctx.roomId).emit(EVENTS.ROOM_ROLE_CHANGED, { userId, role })
      if (result.hostChanged || result.roleChanged) {
        // Owner must keep receiving the password-bearing state; other members
        // (including temporary admins) only receive the public state.
        ctx.socket.emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(ctx.room))
        ctx.socket.to(ctx.roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(ctx.room))
      }
      logger.info(`房间 ${ctx.roomId} 的用户角色已调整为 ${role}`, {
        event: 'room.role_changed',
        roomId: ctx.roomId,
        operatorId: ctx.user.id,
        operator: ctx.user.nickname,
        operatorIsServerAdmin: userRepo.isServerAdmin(ctx.user.id),
        targetUserId: userId,
        role,
        conductorChanged: result.hostChanged,
      })
    }),
  )

  // ---- Disconnect ----
  socket.on('disconnect', (reason) => {
    try {
      logger.debug('客户端连接已断开', { socketId: socket.id, reason })
      handleLeave(io, socket)
      // Safety net: always clean up socket mapping, RTT data, and rate limiter.
      // handleLeave only cleans up if the socket was in a room, but
      // NTP_PING can store RTT even for sockets that never joined a room.
      roomRepo.deleteSocketMapping(socket.id)
      cleanupSocketRateLimit(socket)
    } catch (err) {
      logger.error('disconnect handler error', err, { socketId: socket.id })
    }
  })
}

async function refreshRestoredMembershipDetails(
  io: TypedServer,
  socket: TypedSocket,
  roomId: string,
  userId: string,
): Promise<void> {
  try {
    const updatedPlatforms = await authService.refreshMissingMembershipDetails(roomId, userId)
    if (updatedPlatforms.length === 0) return
    io.to(roomId).emit(EVENTS.AUTH_STATUS_UPDATE, authService.getAllPlatformStatus(roomId))
    const mapping = roomRepo.getSocketMapping(socket.id)
    if (mapping?.roomId === roomId && mapping.userId === userId) {
      socket.emit(EVENTS.AUTH_MY_STATUS, authService.getUserAuthStatus(userId, roomId))
    }
  } catch (error) {
    logger.warn('自动刷新恢复账号的会员详情失败', {
      event: 'auth.membership_refresh_failed',
      roomId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------------------
// Unified leave handler (previously duplicated as autoLeaveCurrentRoom + handleLeave)
// ---------------------------------------------------------------------------

/**
 * Leave the current room (if any), notify other users, and update lobby.
 * Used by ROOM_LEAVE, disconnect, and auto-leave before create/join.
 */
function handleLeave(io: TypedServer, socket: TypedSocket, reason?: string, revokeTicket = false): void {
  const result = roomService.leaveRoom(socket.id, io)
  if (!result) return

  const { roomId, user, room, hostChanged, roleChanged, voteUpdated, staleSocketOnly } = result
  if (revokeTicket) {
    revokeRejoinTickets(roomId, user.id)
  }
  socket.leave(roomId)
  socket.join('lobby')

  // Stale socket cleanup (e.g. page refresh) should only remove this socket
  // from the Socket.IO room; the user remains present via another socket.
  if (staleSocketOnly) {
    if (room) io.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
    return
  }

  io.to(roomId).emit(EVENTS.ROOM_USER_LEFT, user)

  // Always persist the leave event. When the last user leaves there is nobody
  // to receive it live, but it must still appear in history after a rejoin.
  if (room) {
    const leaveMsg = chatService.createSystemMessage(roomId, `${user.nickname} 离开了房间`)
    if (room.users.length > 0) {
      io.to(roomId).emit(EVENTS.CHAT_MESSAGE, leaveMsg)
    }
  }

  // 角色或主持变更时广播完整状态，确保所有客户端更新 hostId / 权限
  // owner 收到含密码版本，其他成员不含密码
  if ((hostChanged || roleChanged) && room && room.users.length > 0) {
    const newOwner = room.users.find((u) => u.role === 'owner')
    const ownerSocketId = newOwner ? roomRepo.getSocketIdForUser(roomId, newOwner.id) : null
    if (ownerSocketId) {
      io.to(ownerSocketId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomStateForOwner(room))
      io.to(roomId).except(ownerSocketId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
    } else {
      io.to(roomId).emit(EVENTS.ROOM_STATE, roomService.toPublicRoomState(room))
    }
  }

  // Broadcast updated vote state after threshold recalculation
  if (voteUpdated) {
    if (room) void reconcileAndBroadcastVote(io, roomId, room)
  }

  // 更新大厅房间列表
  roomService.broadcastRoomList(io)

  if (reason) {
    logger.debug('连接因切换操作离开原房间', { roomId, socketId: socket.id, reason })
  }
}
