import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-admin-setup-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
delete process.env.SERVER_ADMIN_IDS

const { userRepo } = await import('../src/repositories/userRepository.js')
const { createInitialAdmin, isSetupNeeded } = await import('../src/services/adminSetupService.js')
const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('setup is needed on a fresh server without admins', () => {
  assert.equal(isSetupNeeded(), true)
})

test('rejects reserved account ids during setup', () => {
  const reserved = createInitialAdmin({ accountId: 'root', nickname: 'X', passwordHash: 'h' })
  assert.deepEqual(reserved, { success: false, reason: 'reserved_id' })
  assert.equal(isSetupNeeded(), true)
})

test('rejects an account id colliding with an existing user', () => {
  userRepo.ensure('plain-user', { nickname: '访客' })
  const conflict = createInitialAdmin({ accountId: 'PLAIN-USER', nickname: 'X', passwordHash: 'h' })
  assert.deepEqual(conflict, { success: false, reason: 'account_conflict' })
  assert.equal(isSetupNeeded(), true)
})

test('creates the first admin with role admin and blocks further setup', () => {
  const created = createInitialAdmin({ accountId: 'first-admin', nickname: '首个管理员', passwordHash: 'hashed-secret' })
  assert.equal(created.success, true)
  if (!created.success) return
  assert.equal(created.user.id, 'first-admin')
  assert.equal(created.user.role, 'admin')
  assert.equal(created.user.passwordHash, 'hashed-secret')
  assert.equal(userRepo.isServerAdmin('first-admin'), true)

  assert.equal(isSetupNeeded(), false)
  const second = createInitialAdmin({ accountId: 'second-admin', nickname: 'Later', passwordHash: 'other' })
  assert.deepEqual(second, { success: false, reason: 'already_initialized' })
})
