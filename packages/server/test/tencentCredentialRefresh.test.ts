import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-tencent-refresh-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const { db } = await import('../src/repositories/database.js')
const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')
const authService = await import('../src/services/authService.js')
const tencentAuth = await import('../src/services/tencentAuthService.js')
const { refreshDueTencentCredentials, TENCENT_CREDENTIAL_REFRESH_INTERVAL_MS } =
  await import('../src/services/tencentCredentialRefreshService.js')

const now = 1_800_000_000_000
for (const userId of ['qq-refresh-success', 'qq-refresh-failure']) {
  db.prepare('INSERT INTO users (id, nickname, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    userId,
    now,
    now,
    now,
  )
}

function credential(musicid: number, musickey: string) {
  return tencentAuth.buildTencentCredentialCookie('', {
    musicid,
    musickey,
    refresh_token: `refresh-token-${musicid}`,
    refresh_key: `refresh-key-${musicid}`,
    loginType: 2,
  })
}

const successCookie = credential(101, 'old-success-key')
const failureCookie = credential(202, 'old-failure-key')
for (const [userId, cookie] of [
  ['qq-refresh-success', successCookie],
  ['qq-refresh-failure', failureCookie],
] as const) {
  platformAuthRepo.save({
    userId,
    platform: 'tencent',
    cookie,
    nickname: userId,
    vipType: 1,
    credentialRefreshAttemptedAt: now - TENCENT_CREDENTIAL_REFRESH_INTERVAL_MS,
  })
  authService.restoreUserCookies('refresh-room', userId)
}

after(() => {
  authService.cleanupRoom('refresh-room')
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('refreshes due credentials every 24 hours and updates active room copies', async () => {
  const summary = await refreshDueTencentCredentials(now, async (cookie) => {
    if (cookie === failureCookie) throw new Error('provider unavailable')
    return tencentAuth.buildTencentCredentialCookie(cookie, {
      musicid: 101,
      musickey: 'new-success-key',
      refresh_token: 'rotated-refresh-token',
      refresh_key: 'rotated-refresh-key',
      loginType: 2,
    })
  })

  assert.deepEqual(summary, { checked: 2, refreshed: 1, failed: 1, skipped: 0 })
  const persistedSuccess = platformAuthRepo.loadUser('qq-refresh-success')[0]
  const persistedFailure = platformAuthRepo.loadUser('qq-refresh-failure')[0]
  assert.equal(tencentAuth.parseTencentCredential(persistedSuccess.cookie)?.musickey, 'new-success-key')
  assert.equal(tencentAuth.parseTencentCredential(persistedSuccess.cookie)?.refreshToken, 'rotated-refresh-token')
  assert.equal(persistedSuccess.credentialRefreshAttemptedAt, now)
  assert.equal(persistedFailure.cookie, failureCookie)
  assert.equal(persistedFailure.credentialRefreshAttemptedAt, now)
  assert.equal(
    tencentAuth.parseTencentCredential(authService.getUserCookie('qq-refresh-success', 'tencent', 'refresh-room')!)
      ?.musickey,
    'new-success-key',
  )
  assert.equal(authService.getUserCookie('qq-refresh-failure', 'tencent', 'refresh-room'), failureCookie)

  assert.equal(platformAuthRepo.loadDueTencent(now - 1).length, 0)
  assert.equal(platformAuthRepo.loadDueTencent(now).length, 2)
})
