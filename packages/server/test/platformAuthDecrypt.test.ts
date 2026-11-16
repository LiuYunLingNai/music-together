import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-platform-auth-decrypt-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')
const { userRepo } = await import('../src/repositories/userRepository.js')
const { db } = await import('../src/repositories/database.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

function corrupt(userId: string, platform: string) {
  db.prepare('UPDATE platform_auth SET cookie_encrypted = ? WHERE user_id = ? AND platform = ?').run(
    'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA',
    userId,
    platform,
  )
}

test('undecryptable rows are skipped, counted, and not re-selected by the refresh scan', () => {
  userRepo.ensure('decrypt-user')
  platformAuthRepo.save({ userId: 'decrypt-user', platform: 'tencent', cookie: 'ok-cookie', nickname: 'n', vipType: 1 })
  platformAuthRepo.save({ userId: 'decrypt-user', platform: 'netease', cookie: 'bad-cookie', nickname: 'n', vipType: 0 })
  corrupt('decrypt-user', 'netease')

  assert.deepEqual(
    platformAuthRepo.loadUser('decrypt-user').map((entry) => entry.platform),
    ['tencent'],
  )
  assert.deepEqual(platformAuthRepo.auditDecryptability(), { total: 2, undecryptable: 1 })

  assert.equal(platformAuthRepo.loadDue('netease', Date.now() + 1000).length, 0)
  const row = db
    .prepare('SELECT credential_refresh_attempted_at AS at FROM platform_auth WHERE user_id = ? AND platform = ?')
    .get('decrypt-user', 'netease') as { at: number | null }
  assert.ok(row.at, 'unreadable row gets an attempt timestamp so it is not re-selected every cycle')

  platformAuthRepo.save({ userId: 'decrypt-user', platform: 'netease', cookie: 'fresh', nickname: 'n', vipType: 0 })
  assert.equal(platformAuthRepo.loadUser('decrypt-user').find((entry) => entry.platform === 'netease')?.cookie, 'fresh')
})

test('renaming a user keeps the full platform account state', () => {
  userRepo.ensure('rename-auth-before')
  platformAuthRepo.save({
    userId: 'rename-auth-before',
    platform: 'netease',
    cookie: 'c',
    nickname: 'n',
    vipType: 11,
    vipLabel: 'SVIP',
    vipLevel: 7,
    avatarUrl: 'https://avatar/x.jpg',
    shareWithRoom: false,
    reportListening: true,
  })
  assert.equal(userRepo.rename('rename-auth-before', 'rename-auth-after').success, true)
  const moved = platformAuthRepo.loadUser('rename-auth-after')[0]
  assert.equal(moved.vipLabel, 'SVIP')
  assert.equal(moved.vipLevel, 7)
  assert.equal(moved.avatarUrl, 'https://avatar/x.jpg')
  assert.equal(moved.shareWithRoom, false)
  assert.equal(moved.reportListening, true)
})
