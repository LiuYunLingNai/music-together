import { describe, expect, it } from 'vitest'
import { markMemberOffline, markMemberOnline, moveTrackAfterCurrent, nextUnreadChatCount, normalizeRoomState, sortRoomMembers, updateMemberRole, type RoomStatePayload } from './room-state'

const baseRoom: RoomStatePayload = {
  id: 'room-1',
  name: 'Room',
  creatorId: 'owner',
  hostId: 'owner',
  hasPassword: false,
  hidden: false,
  permanent: false,
  audioQuality: 320,
  users: [
    { id: 'owner', nickname: 'Owner', role: 'owner', isServerAdmin: false },
    { id: 'member', nickname: 'Member', role: 'member', isServerAdmin: false },
  ],
  queue: [],
  currentTrack: null,
  playState: { isPlaying: false, currentTime: 0, serverTimestamp: 0 },
  playMode: 'sequential',
}

describe('room state compatibility', () => {
  it('fills fields omitted by older room-state payloads', () => {
    const room = normalizeRoomState(baseRoom, 1234)
    expect(room.temporaryAdminUserId).toBeNull()
    expect(room.allowTemporaryAdminTrackRemoval).toBe(false)
    expect(room.allowTemporaryAdminQueueClear).toBe(false)
    expect(room.members).toEqual(baseRoom.users.map((user) => ({ ...user, isOnline: true, joinedAt: 1234, lastSeenAt: 1234 })))
  })

  it('preserves roster history while members join, leave, and change role', () => {
    const initial = normalizeRoomState(baseRoom, 100).members
    const offline = markMemberOffline(initial, baseRoom.users[1]!, 200)
    expect(offline.find((member) => member.id === 'member')).toMatchObject({ isOnline: false, joinedAt: 100, lastSeenAt: 200 })
    const online = markMemberOnline(offline, { ...baseRoom.users[1]!, nickname: 'Renamed' }, 300)
    expect(updateMemberRole(online, 'member', 'admin').find((member) => member.id === 'member')).toMatchObject({ nickname: 'Renamed', role: 'admin', isOnline: true, joinedAt: 100 })
  })

  it('sorts online members first, then by role and nickname', () => {
    const members = normalizeRoomState(baseRoom, 100).members
    members.push({ id: 'admin', nickname: 'Admin', role: 'admin', isServerAdmin: false, isOnline: false, joinedAt: 100, lastSeenAt: 100 })
    expect(sortRoomMembers(markMemberOffline(members, baseRoom.users[0]!, 200)).map((member) => member.id)).toEqual(['member', 'owner', 'admin'])
  })
})

describe('room interaction helpers', () => {
  it('counts unread messages only while chat is closed', () => {
    expect(nextUnreadChatCount(4, false)).toBe(5)
    expect(nextUnreadChatCount(4, true)).toBe(0)
  })

  it('moves an existing queue track directly after the current track without duplicating it', () => {
    expect(moveTrackAfterCurrent(['a', 'current', 'b', 'c'], 'c', 'current')).toEqual(['a', 'current', 'c', 'b'])
    expect(moveTrackAfterCurrent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })
})
