import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-offline-members-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`

const roomService = await import('../src/services/roomService.js')
const { db } = await import('../src/repositories/database.js')
const { InMemoryRoomRepository, roomRepo } = await import('../src/repositories/roomRepository.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('keeps offline members in a permanent room roster after reload', () => {
  const { room } = roomService.createRoom('owner-socket', 'Owner', 'Roster room', null, 'owner-id')
  roomService.updateSettings(room.id, { permanent: true })

  const joined = roomService.joinRoom('member-socket', room.id, 'Member', 'member-id')
  assert.ok(joined)
  assert.equal(joined.room.members.length, 2)
  assert.equal(joined.room.members.find((member) => member.id === 'member-id')?.isOnline, true)

  roomService.leaveRoom('member-socket')
  const offlineMember = room.members.find((member) => member.id === 'member-id')
  assert.deepEqual(
    offlineMember && {
      id: offlineMember.id,
      role: offlineMember.role,
      isOnline: offlineMember.isOnline,
      hasLastSeenAt: offlineMember.lastSeenAt !== null,
    },
    { id: 'member-id', role: 'member', isOnline: false, hasLastSeenAt: true },
  )

  const persistedCount = db
    .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM permanent_room_members WHERE room_id = ?')
    .get(room.id)
  assert.equal(persistedCount?.count, 2)

  const restoredRepo = new InMemoryRoomRepository()
  const restoredRoom = restoredRepo.get(room.id)
  assert.equal(restoredRoom?.users.length, 0)
  assert.deepEqual(
    restoredRoom?.members.map((member) => ({ id: member.id, isOnline: member.isOnline })),
    [
      { id: 'owner-id', isOnline: false },
      { id: 'member-id', isOnline: false },
    ],
  )

  roomRepo.delete(room.id)
})

test('updates the roster role when an online member becomes temporary admin', () => {
  const { room } = roomService.createRoom('owner-socket', 'Owner', 'Role sync room', null, 'owner-role-id')
  const joined = roomService.joinRoom('member-socket', room.id, 'Member', 'member-role-id')
  assert.ok(joined)

  const left = roomService.leaveRoom('owner-socket')
  assert.ok(left)
  assert.equal(left.roleChanged, true)
  assert.equal(room.users.find((user) => user.id === 'member-role-id')?.role, 'admin')
  assert.equal(room.members.find((member) => member.id === 'member-role-id')?.role, 'admin')

  roomRepo.delete(room.id)
})
