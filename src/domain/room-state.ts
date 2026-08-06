import type { RoomMember, RoomState, User, UserRole } from './types'

type CompatibilityFields = 'temporaryAdminUserId' | 'allowTemporaryAdminTrackRemoval' | 'allowTemporaryAdminQueueClear' | 'members'
export type RoomStatePayload = Omit<RoomState, CompatibilityFields> & Partial<Pick<RoomState, CompatibilityFields>>

const roleOrder: Record<UserRole, number> = { owner: 0, admin: 1, member: 2 }

export function normalizeRoomState(room: RoomStatePayload, now = Date.now()): RoomState {
  const members = room.members?.length
    ? room.members
    : room.users.map((user) => ({ ...user, isOnline: true, joinedAt: now, lastSeenAt: now }))
  return {
    ...room,
    temporaryAdminUserId: room.temporaryAdminUserId ?? null,
    allowTemporaryAdminTrackRemoval: room.allowTemporaryAdminTrackRemoval ?? false,
    allowTemporaryAdminQueueClear: room.allowTemporaryAdminQueueClear ?? false,
    members,
  }
}

export function markMemberOnline(members: RoomMember[], user: User, now = Date.now()): RoomMember[] {
  const existing = members.some((candidate) => candidate.id === user.id)
  if (!existing) return [...members, { ...user, isOnline: true, joinedAt: now, lastSeenAt: now }]
  return members.map((candidate) => candidate.id === user.id
    ? { ...candidate, ...user, isOnline: true, lastSeenAt: now }
    : candidate)
}

export function markMemberOffline(members: RoomMember[], user: User, now = Date.now()): RoomMember[] {
  return members.map((candidate) => candidate.id === user.id
    ? { ...candidate, ...user, isOnline: false, lastSeenAt: now }
    : candidate)
}

export function updateMemberRole(members: RoomMember[], userId: string, role: UserRole): RoomMember[] {
  return members.map((member) => member.id === userId ? { ...member, role } : member)
}

export function sortRoomMembers(members: RoomMember[]): RoomMember[] {
  return [...members].sort((a, b) => Number(b.isOnline) - Number(a.isOnline)
    || roleOrder[a.role] - roleOrder[b.role]
    || a.nickname.localeCompare(b.nickname))
}

export function nextUnreadChatCount(current: number, chatOpen: boolean): number {
  return chatOpen ? 0 : current + 1
}

export function moveTrackAfterCurrent(queueIds: string[], trackId: string, currentTrackId?: string): string[] {
  const from = queueIds.indexOf(trackId)
  if (from < 0 || trackId === currentTrackId) return queueIds
  const next = [...queueIds]
  const currentIndex = currentTrackId ? next.indexOf(currentTrackId) : -1
  next.splice(from, 1)
  if (currentIndex < 0) {
    next.unshift(trackId)
    return next
  }
  const adjustedCurrentIndex = from < currentIndex ? currentIndex - 1 : currentIndex
  next.splice(adjustedCurrentIndex + 1, 0, trackId)
  return next
}
