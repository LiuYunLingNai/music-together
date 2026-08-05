import { EVENTS } from '@music-together/shared'
import type { TypedServer } from '../middleware/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import { revokeRejoinTickets } from './rejoinTicketService.js'
import { toPublicRoomState } from '../utils/roomUtils.js'
import * as authService from './authService.js'

export function replaceActiveUserId(oldUserId: string, newUserId: string, io: TypedServer): void {
  for (const room of roomRepo.getAll().values()) {
    let changed = false
    const onlineUser = room.users.find((user) => user.id === oldUserId)
    if (onlineUser) {
      onlineUser.id = newUserId
      changed = true
    }
    const rosterMember = room.members.find((member) => member.id === oldUserId)
    if (rosterMember) {
      rosterMember.id = newUserId
      changed = true
    }
    if (room.creatorId === oldUserId) {
      room.creatorId = newUserId
      changed = true
    }
    if (room.hostId === oldUserId) {
      room.hostId = newUserId
      changed = true
    }
    if (room.adminUserIds.delete(oldUserId)) {
      room.adminUserIds.add(newUserId)
      changed = true
    }
    if (room.temporaryAdminUserId === oldUserId) {
      room.temporaryAdminUserId = newUserId
      changed = true
    }
    if (!changed) continue

    revokeRejoinTickets(room.id, oldUserId)
    roomRepo.persist(room.id)
    io.to(room.id).emit(EVENTS.ROOM_STATE, toPublicRoomState(room))
  }

  roomRepo.replaceUserId(oldUserId, newUserId)
  authService.replaceUserId(oldUserId, newUserId)
}
