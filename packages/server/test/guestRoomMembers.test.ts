import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-guest-members-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`

const roomService = await import('../src/services/roomService.js')
const { userRepo } = await import('../src/repositories/userRepository.js')
const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

/** Give a user a password so `isGuest` reports false (a real account). */
function makeAccount(userId: string) {
  userRepo.ensure(userId)
  userRepo.setPasswordHash(userId, 'hashed-password-placeholder')
}

test('a guest member joins the online list but is excluded from the persistent roster', () => {
  const { room } = roomService.createRoom('owner-sock', 'Owner', 'Guest room', null, 'owner-acct')
  roomService.updateSettings(room.id, { permanent: true })

  const joined = roomService.joinRoom('guest-sock', room.id, 'Guest', 'guest-user')
  assert.ok(joined)

  // Online: guest is present in room.users
  assert.ok(joined.room.users.some((u) => u.id === 'guest-user'))
  // Roster: guest is NOT persisted to room.members
  assert.equal(joined.room.members.some((m) => m.id === 'guest-user'), false)
  // Owner remains in the roster
  assert.ok(joined.room.members.some((m) => m.id === 'owner-acct'))
})

test('an account member (has password) is persisted to the roster', () => {
  makeAccount('acct-user')
  const { room } = roomService.createRoom('owner-sock-2', 'Owner', 'Account room', null, 'owner-acct-2')

  const joined = roomService.joinRoom('acct-sock', room.id, 'Account', 'acct-user')
  assert.ok(joined)
  assert.ok(joined.room.users.some((u) => u.id === 'acct-user'))
  assert.ok(joined.room.members.some((m) => m.id === 'acct-user'))
})

test('a guest who is a persistent admin is retained in the roster', () => {
  const { room } = roomService.createRoom('owner-sock-3', 'Owner', 'Admin room', null, 'owner-acct-3')
  // Promote the guest to a persistent admin before joining.
  room.adminUserIds.add('guest-admin')

  const joined = roomService.joinRoom('guest-admin-sock', room.id, 'GuestAdmin', 'guest-admin')
  assert.ok(joined)
  assert.equal(userRepo.isGuest('guest-admin'), true)
  assert.ok(joined.room.members.some((m) => m.id === 'guest-admin'))
  assert.equal(joined.room.members.find((m) => m.id === 'guest-admin')?.role, 'admin')
})

test('a departing guest disappears entirely (online-only, never in the roster)', () => {
  const { room } = roomService.createRoom('owner-sock-4', 'Owner', 'Leave room', null, 'owner-acct-4')
  roomService.updateSettings(room.id, { permanent: true })

  roomService.joinRoom('leaver-sock', room.id, 'Leaver', 'leaver-guest')
  assert.ok(room.users.some((u) => u.id === 'leaver-guest'))

  roomService.leaveRoom('leaver-sock')
  assert.equal(room.users.some((u) => u.id === 'leaver-guest'), false)
  assert.equal(room.members.some((m) => m.id === 'leaver-guest'), false)
})
