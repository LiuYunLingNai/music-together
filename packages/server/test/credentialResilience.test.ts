import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-credential-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const authService = await import('../src/services/authService.js')
const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')
const { db } = await import('../src/repositories/database.js')

db.prepare('INSERT INTO users (id, nickname, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
  'vip-user',
  '会员用户',
  Date.now(),
  Date.now(),
  Date.now(),
)

after(() => {
  authService.cleanupRoom('membership-room')
  authService.cleanupRoom('downgrade-room')
  authService.cleanupRoom('existing-room')
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('keeps the recorded membership level when the VIP sub-request fails', async () => {
  authService.addCookie('membership-room', 'tencent', 'vip-user', 'qq-cookie', 'QQ 用户', 2, true, {
    vipLabel: '超级会员·Lv7',
    vipLevel: 7,
  })

  // 登录有效（ok: true）但会员子请求失败：vipType 回落为 0 且带 membershipUnknown
  const refreshed = await authService.refreshMissingMembershipDetails(
    'membership-room',
    'vip-user',
    async () => ({
      ok: true,
      data: { nickname: 'QQ 用户', vipType: 0, userId: 1, membershipUnknown: true },
    }),
  )

  assert.deepEqual(refreshed, [], '会员状态未知时不应算作刷新成功')
  const status = authService
    .getUserAuthStatus('vip-user', 'membership-room')
    .find((entry) => entry.platform === 'tencent')
  assert.equal(status?.vipType, 2, '必须保留原有会员等级，不能降级为非会员')
  assert.equal(status?.vipLabel, '超级会员·Lv7')
  assert.equal(status?.vipLevel, 7)
  const persisted = platformAuthRepo.loadUser('vip-user').find((entry) => entry.platform === 'tencent')
  assert.equal(persisted?.vipType, 2)
  assert.equal(persisted?.vipLevel, 7)
})

test('still applies a confirmed membership downgrade', async () => {
  // 单独的房间：refreshMissingMembershipDetails 会刷新房间内的所有平台
  authService.addCookie('downgrade-room', 'netease', 'vip-user', 'ncm-cookie', '网易用户', 2, true, {
    vipLabel: '黑胶SVIP',
    vipLevel: 3,
  })

  const refreshed = await authService.refreshMissingMembershipDetails('downgrade-room', 'vip-user', async () => ({
    ok: true,
    data: { nickname: '网易用户', vipType: 0, userId: 2 },
  }))

  assert.deepEqual(refreshed, ['netease'])
  const status = authService
    .getUserAuthStatus('vip-user', 'downgrade-room')
    .find((entry) => entry.platform === 'netease')
  assert.equal(status?.vipType, 0, '平台明确返回非会员时应当照实更新')
})

test('reports whether a user already has a credential for the platform', () => {
  assert.equal(authService.hasExistingCredential('vip-user', 'kugou', 'existing-room'), false)
  assert.equal(authService.getUserMembership('vip-user', 'kugou', 'existing-room'), null)

  authService.addCookie('existing-room', 'kugou', 'vip-user', 'kg-cookie', '酷狗用户', 1, false, {
    vipLabel: '豪华VIP',
    vipLevel: 2,
  })

  assert.equal(authService.hasExistingCredential('vip-user', 'kugou', 'existing-room'), true)
  assert.deepEqual(authService.getUserMembership('vip-user', 'kugou', 'existing-room'), {
    vipType: 1,
    vipLabel: '豪华VIP',
    vipLevel: 2,
  })
  // 不传房间时只看持久化记录；这条是 persist=false
  assert.equal(authService.hasExistingCredential('vip-user', 'kugou'), false)
})
