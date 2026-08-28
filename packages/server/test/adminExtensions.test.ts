import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import type { TypedServer } from '../src/middleware/types.js'

// 环境变量必须在导入任何仓储/服务模块之前设置
const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-admin-ext-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.MUSIC_TOGETHER_BACKUP_DIR = path.join(testDataDir, 'backups')
process.env.SERVER_ADMIN_IDS = 'admin-test'

const express = (await import('express')).default
const { createAdminRoutes } = await import('../src/routes/admin.js')
const { userRepo } = await import('../src/repositories/userRepository.js')
const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')
const { db } = await import('../src/repositories/database.js')

// 管理接口测试只覆盖 HTTP 层：io 的方法桩不会真正广播
const fakeIo = {
  to: () => ({ emit: () => {} }),
  emit: () => {},
  getSocketsInRoom: () => [],
} as unknown as TypedServer

const app = express()
app.use(express.json())
// 用测试头模拟身份中间件写入的管理员身份
app.use((req, _res, next) => {
  const identity = req.header('x-test-user')
  if (identity) (req as { identityUserId?: string }).identityUserId = identity
  next()
})
app.use('/api/admin', createAdminRoutes(fakeIo))

let baseUrl = ''
let server: ReturnType<typeof app.listen> | null = null

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server!.address()
  baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`
})

after(() => {
  server?.close()
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

function adminRequest(method: string, urlPath: string, body?: unknown, identity = 'admin-test') {
  return fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: identity ? { 'x-test-user': identity, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

test('overview aggregates version, users and rooms in one response', async () => {
  const response = await adminRequest('GET', '/api/admin/overview')
  assert.equal(response.status, 200)
  const data = (await response.json()) as { version: string; healthy: boolean; users: { id: string }[]; rooms: unknown[] }
  assert.equal(typeof data.version, 'string')
  assert.equal(data.healthy, true)
  assert.ok(Array.isArray(data.users))
  assert.ok(Array.isArray(data.rooms))
})

test('rejects callers without server admin identity', async () => {
  const anonymous = await adminRequest('GET', '/api/admin/overview', undefined, '')
  assert.equal(anonymous.status, 403)
  const nonAdmin = await adminRequest('GET', '/api/admin/overview', undefined, 'plain-user')
  assert.equal(nonAdmin.status, 403)
})

test('room detail and kick return 404 for unknown rooms', async () => {
  const detail = await adminRequest('GET', '/api/admin/rooms/NOPE')
  assert.equal(detail.status, 404)
  const kick = await adminRequest('POST', '/api/admin/rooms/NOPE/kick/u1')
  assert.equal(kick.status, 404)
})

test('backup list reflects the backup directory and supports deletion', async () => {
  const backupDir = process.env.MUSIC_TOGETHER_BACKUP_DIR!
  const backupName = 'music-together-2026-01-01_00-00-00'
  mkdirSync(path.join(backupDir, backupName), { recursive: true })
  writeFileSync(
    path.join(backupDir, backupName, 'manifest.json'),
    JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', database: 'data.db', environmentFileIncluded: true }),
  )

  const listResponse = await adminRequest('GET', '/api/admin/backups')
  assert.equal(listResponse.status, 200)
  const listData = (await listResponse.json()) as { backups: { name: string; createdAt: string; includesEnvFile: boolean }[]; running: boolean }
  const entry = listData.backups.find((item) => item.name === backupName)
  assert.ok(entry, 'backup entry should be listed')
  assert.equal(entry!.createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(entry!.includesEnvFile, true)
  assert.equal(listData.running, false)

  const invalidDelete = await adminRequest('DELETE', '/api/admin/backups/..%2Fevil')
  assert.equal(invalidDelete.status, 400)

  const missingDelete = await adminRequest('DELETE', '/api/admin/backups/music-together-1999-01-01_00-00-00')
  assert.equal(missingDelete.status, 404)

  const deleteResponse = await adminRequest('DELETE', `/api/admin/backups/${backupName}`)
  assert.equal(deleteResponse.status, 204)
  assert.equal(existsSync(path.join(backupDir, backupName)), false)
})

test('platform auths expose metadata without cookies and support revocation', async () => {
  userRepo.ensure('target-user', { nickname: '测试用户' })
  platformAuthRepo.save({
    userId: 'target-user',
    platform: 'netease',
    cookie: 'MUSIC_U=super-secret-value',
    nickname: '网易云昵称',
    vipType: 11,
    vipLabel: '黑胶VIP',
  })

  const listResponse = await adminRequest('GET', '/api/admin/users/target-user/platform-auths')
  assert.equal(listResponse.status, 200)
  const rawBody = await listResponse.text()
  assert.ok(!rawBody.includes('super-secret-value'), 'cookie must never leak to admin responses')
  const listData = JSON.parse(rawBody) as {
    auths: { platform: string; nickname: string; vipLabel: string | null }[]
  }
  assert.equal(listData.auths.length, 1)
  assert.equal(listData.auths[0]!.platform, 'netease')
  assert.equal(listData.auths[0]!.vipLabel, '黑胶VIP')

  const invalidPlatform = await adminRequest('DELETE', '/api/admin/users/target-user/platform-auths/spotify')
  assert.equal(invalidPlatform.status, 400)

  const revokeResponse = await adminRequest('DELETE', '/api/admin/users/target-user/platform-auths/netease')
  assert.equal(revokeResponse.status, 204)

  const emptyList = await adminRequest('GET', '/api/admin/users/target-user/platform-auths')
  const emptyData = (await emptyList.json()) as { auths: unknown[] }
  assert.deepEqual(emptyData.auths, [])

  const revokeAgain = await adminRequest('DELETE', '/api/admin/users/target-user/platform-auths/netease')
  assert.equal(revokeAgain.status, 404)

  const unknownUser = await adminRequest('GET', '/api/admin/users/ghost-user/platform-auths')
  assert.equal(unknownUser.status, 404)
})
