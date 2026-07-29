import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-membership-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`

const authService = await import('../src/services/authService.js')
const { db } = await import('../src/repositories/database.js')
const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')

db.prepare('INSERT INTO users (id, nickname, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
  'refresh-user',
  '测试用户',
  Date.now(),
  Date.now(),
  Date.now(),
)

after(() => {
  authService.cleanupRoom('refresh-room')
  authService.cleanupRoom('concept-refresh-room')
  authService.cleanupRoom('standard-refresh-room')
  authService.cleanupRoom('bilibili-refresh-room')
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('refreshes and persists missing membership details from a restored account', async () => {
  authService.addCookie('refresh-room', 'netease', 'refresh-user', 'old-cookie', '旧昵称', 110, true)

  const refreshed = await authService.refreshMissingMembershipDetails(
    'refresh-room',
    'refresh-user',
    async (platform, cookie) => {
      assert.equal(platform, 'netease')
      assert.equal(cookie, 'old-cookie')
      return {
        ok: true,
        data: {
          nickname: '新昵称',
          vipType: 1,
          vipLabel: 'VIP·伍',
          vipLevel: 5,
          userId: 123,
        },
      }
    },
  )

  assert.deepEqual(refreshed, ['netease'])
  assert.deepEqual(authService.getUserAuthStatus('refresh-user', 'refresh-room')[0], {
    platform: 'netease',
    loggedIn: true,
    nickname: '新昵称',
    vipType: 1,
    vipLabel: 'VIP·伍',
    vipLevel: 5,
  })
  const persisted = platformAuthRepo.loadUser('refresh-user').find((entry) => entry.platform === 'netease')
  assert.equal(persisted?.vipLabel, 'VIP·伍')
  assert.equal(persisted?.vipLevel, 5)
})

test('keeps restored account data when membership refresh temporarily fails', async () => {
  authService.addCookie('refresh-room', 'tencent', 'refresh-user', 'qq-cookie', 'QQ 用户', 1, true)
  let attempts = 0

  const refreshed = await authService.refreshMissingMembershipDetails('refresh-room', 'refresh-user', async () => {
    attempts++
    return { ok: false, reason: 'error' }
  })

  assert.deepEqual(refreshed, [])
  assert.equal(attempts, 2)
  const status = authService
    .getUserAuthStatus('refresh-user', 'refresh-room')
    .find((entry) => entry.platform === 'tencent')
  assert.equal(status?.loggedIn, true)
  assert.equal(status?.vipType, 1)
  assert.equal(status?.vipLabel, undefined)
})

test('refreshes a restored Concept Edition account even when its stored tier is zero', async () => {
  authService.addCookie(
    'concept-refresh-room',
    'kugou_concept',
    'refresh-user',
    'concept-cookie',
    '概念版用户',
    0,
    true,
  )

  const refreshed = await authService.refreshMissingMembershipDetails(
    'concept-refresh-room',
    'refresh-user',
    async (platform, cookie) => {
      assert.equal(platform, 'kugou_concept')
      assert.equal(cookie, 'concept-cookie')
      return {
        ok: true,
        data: {
          nickname: '概念版用户',
          vipType: 1,
          vipLabel: 'VIP',
          userId: 123,
        },
      }
    },
  )

  assert.deepEqual(refreshed, ['kugou_concept'])
  const status = authService
    .getUserAuthStatus('refresh-user', 'concept-refresh-room')
    .find((entry) => entry.platform === 'kugou_concept')
  assert.equal(status?.vipType, 1)
  assert.equal(status?.vipLabel, 'VIP')
})

test('revalidates a detailed standard Kugou account and persists an expired membership', async () => {
  authService.addCookie('standard-refresh-room', 'kugou', 'refresh-user', 'standard-cookie', '酷狗用户', 2, true, {
    vipLabel: 'SVIP·Lv5',
    vipLevel: 5,
  })
  let attempts = 0

  const refreshed = await authService.refreshMissingMembershipDetails(
    'standard-refresh-room',
    'refresh-user',
    async (platform, cookie) => {
      attempts++
      assert.equal(platform, 'kugou')
      assert.equal(cookie, 'standard-cookie')
      return {
        ok: true,
        data: { nickname: '酷狗用户', vipType: 0, userId: 123 },
      }
    },
  )

  assert.deepEqual(refreshed, ['kugou'])
  const status = authService
    .getUserAuthStatus('refresh-user', 'standard-refresh-room')
    .find((entry) => entry.platform === 'kugou')
  assert.equal(status?.vipType, 0)
  assert.equal(status?.vipLabel, undefined)

  const repeated = await authService.refreshMissingMembershipDetails(
    'standard-refresh-room',
    'refresh-user',
    async () => {
      attempts++
      return { ok: false, reason: 'error' }
    },
  )
  assert.deepEqual(repeated, [])
  assert.equal(attempts, 1)
})

test('refreshes a restored Bilibili account to distinguish annual membership', async () => {
  authService.addCookie('bilibili-refresh-room', 'bilibili', 'refresh-user', 'bilibili-cookie', 'B站用户', 1, true, {
    vipLabel: 'VIP · 年度大会员',
  })

  const refreshed = await authService.refreshMissingMembershipDetails(
    'bilibili-refresh-room',
    'refresh-user',
    async (platform, cookie) => {
      assert.equal(platform, 'bilibili')
      assert.equal(cookie, 'bilibili-cookie')
      return {
        ok: true,
        data: { nickname: 'B站用户', vipType: 2, vipLabel: '年度大会员', userId: 123 },
      }
    },
  )

  assert.deepEqual(refreshed, ['bilibili'])
  const status = authService
    .getUserAuthStatus('refresh-user', 'bilibili-refresh-room')
    .find((entry) => entry.platform === 'bilibili')
  assert.equal(status?.vipType, 2)
  assert.equal(status?.vipLabel, '年度大会员')
})
