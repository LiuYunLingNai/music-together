import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import type { TypedServer } from '../src/middleware/types.js'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-avatar-'))
const dataDir = path.join(testDataDir, 'data')
process.env.DATABASE_URL = `file:${path.join(dataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const express = (await import('express')).default
const sharp = (await import('sharp')).default
const { createAuthRoutes } = await import('../src/routes/auth.js')
const { userRepo } = await import('../src/repositories/userRepository.js')
const { db } = await import('../src/repositories/database.js')

const app = express()
app.use(express.json({ limit: '9mb' }))
// 模拟身份中间件：令牌里的 uid 在默认密钥下可以被任意伪造
app.use((req, _res, next) => {
  const identity = req.header('x-test-user')
  if (identity) (req as { identityUserId?: string }).identityUserId = identity
  next()
})
app.use('/api/auth', createAuthRoutes({} as TypedServer))

let baseUrl = ''
let server: ReturnType<typeof app.listen> | null = null
let pngDataUrl = ''

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  baseUrl = `http://127.0.0.1:${(server!.address() as { port: number }).port}`
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer()
  pngDataUrl = `data:image/png;base64,${png.toString('base64')}`
})

after(() => {
  server?.close()
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

function uploadAvatar(userId: string) {
  return fetch(`${baseUrl}/api/auth/me/avatar`, {
    method: 'POST',
    headers: { 'x-test-user': userId, 'content-type': 'application/json' },
    body: JSON.stringify({ image: pngDataUrl }),
  })
}

test('rejects a user id that would write the avatar outside the avatars directory', async () => {
  const forgedId = '../escaped'
  userRepo.ensure(forgedId, { nickname: '伪造' })

  const response = await uploadAvatar(forgedId)
  assert.equal(response.status, 400)
  assert.equal(existsSync(path.join(dataDir, 'escaped.webp')), false)
})

test('stores avatars for normal account ids', async () => {
  userRepo.ensure('normal-user_1', { nickname: '正常用户' })

  const response = await uploadAvatar('normal-user_1')
  assert.equal(response.status, 200)
  const body = (await response.json()) as { avatarUrl: string }
  assert.match(body.avatarUrl, /^\/uploads\/avatars\/normal-user_1\.webp\?v=\d+$/)
  assert.deepEqual(readdirSync(path.join(dataDir, 'avatars')), ['normal-user_1.webp'])
})
