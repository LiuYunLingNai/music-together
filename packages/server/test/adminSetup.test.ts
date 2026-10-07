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

test('initialized setup rejects before hashing, and recovery limits cannot be bypassed by changing identity', async () => {
  const express = (await import('express')).default
  const bcrypt = (await import('bcryptjs')).default
  const { createAdminSetupRoutes } = await import('../src/routes/adminSetup.js')
  const { createAuthRoutes } = await import('../src/routes/auth.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.identityUserId = req.header('x-test-user')
    next()
  })
  app.use('/admin', createAdminSetupRoutes())
  app.use('/auth', createAuthRoutes({ getSocketsInRoom: () => [] } as Parameters<typeof createAuthRoutes>[0]))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => { if (server.listening) resolve(); else server.once('listening', resolve) })
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const originalHash = bcrypt.hash
  let hashes = 0
  bcrypt.hash = (() => { hashes++; throw new Error('unexpected password work') }) as typeof bcrypt.hash
  try {
    const response = await fetch(`${baseUrl}/admin/setup`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'second-admin', nickname: 'X', password: 'valid-password' }) })
    assert.equal(response.status, 409)
    assert.equal(hashes, 0)
    for (let index = 0; index < 11; index++) {
      const recover = await fetch(`${baseUrl}/auth/identity/recover`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': `rotating-identity-${index}` },
        body: JSON.stringify({ accountId: 'missing-user', password: 'password' }) })
      assert.equal(recover.status, index < 10 ? 401 : 429)
    }
  } finally {
    bcrypt.hash = originalHash
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
