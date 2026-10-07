import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { EVENTS, QR_STATUS } from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../src/middleware/types.js'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-membership-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`

const authService = await import('../src/services/authService.js')
const { db } = await import('../src/repositories/database.js')
const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')
const { roomRepo } = await import('../src/repositories/roomRepository.js')
const roomService = await import('../src/services/roomService.js')
const { AUTH_PROVIDERS } = await import('../src/services/authProvider.js')
const { registerAuthController } = await import('../src/controllers/authController.js')
const { registerPlaylistController } = await import('../src/controllers/playlistController.js')

db.prepare('INSERT INTO users (id, nickname, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
  'refresh-user',
  '测试用户',
  Date.now(),
  Date.now(),
  Date.now(),
)

after(() => {
  authService.cleanupRoom('logout-room')
  authService.cleanupRoom('retained-room')
  authService.cleanupRoom('refresh-room')
  authService.cleanupRoom('concept-refresh-room')
  authService.cleanupRoom('standard-refresh-room')
  authService.cleanupRoom('bilibili-refresh-room')
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('room logout invalidates late membership updates without revoking other rooms', async () => {
  authService.addCookie('logout-room', 'netease', 'refresh-user', 'same-cookie', '原用户', 1)
  authService.addCookie('retained-room', 'netease', 'refresh-user', 'retained-cookie', '原用户', 1, false)
  const originalVersion = authService.getAuthorizationVersion('refresh-user', 'netease', 'logout-room')
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const refresh = authService.refreshMissingMembershipDetails('logout-room', 'refresh-user', async () => {
    await pending
    return { ok: true, data: { nickname: '过期响应', vipType: 1, vipLabel: 'VIP', userId: 123 } }
  })
  authService.removeCookie('logout-room', 'netease', 'refresh-user')
  assert.notEqual(authService.getAuthorizationVersion('refresh-user', 'netease', 'logout-room'), originalVersion)
  assert.equal(authService.getUserCookie('refresh-user', 'netease', 'retained-room'), 'retained-cookie')
  assert.equal(platformAuthRepo.loadUser('refresh-user').some((entry) => entry.platform === 'netease'), false)
  // A fresh login may reuse the same cookie; an old refresh must not overwrite it.
  authService.addCookie('logout-room', 'netease', 'refresh-user', 'same-cookie', '重新登录', 1)
  release()
  assert.deepEqual(await refresh, [])
  assert.equal(authService.getUserAuthStatus('refresh-user', 'logout-room')[0]?.nickname, '重新登录')
  assert.equal(platformAuthRepo.loadUser('refresh-user').find((entry) => entry.platform === 'netease')?.nickname, '重新登录')
})

test('a refresh in a retained room cannot restore persisted authorization after logout elsewhere', async () => {
  authService.addCookie('logout-room', 'netease', 'refresh-user', 'active-cookie', '原用户', 1)
  authService.addCookie('retained-room', 'netease', 'refresh-user', 'retained-cookie', '保留贡献', 1, false)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const refresh = authService.refreshMissingMembershipDetails('retained-room', 'refresh-user', async () => {
    await pending
    return { ok: true, data: { nickname: '晚到结果', vipType: 1, vipLabel: 'VIP', userId: 123 } }
  })
  authService.removeCookie('logout-room', 'netease', 'refresh-user')
  release()
  assert.deepEqual(await refresh, [])
  assert.equal(platformAuthRepo.loadUser('refresh-user').some((entry) => entry.platform === 'netease'), false)
  assert.equal(authService.getUserCookie('refresh-user', 'netease', 'retained-room'), 'retained-cookie')
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

for (const method of ['manual', 'qr'] as const) {
  test(`${method} login arriving after logout is discarded, and a fresh login still succeeds`, async () => {
    const id = `auth-race-${method}`
    const { room } = roomService.createRoom(id, '测试用户', '登录竞态', null, 'refresh-user')
    const handlers = new Map<string, (data: unknown) => void | Promise<void>>()
    const emitted: { event: string; data: { success?: boolean } }[] = []
    const socket = { id, connected: true, data: { identityUserId: 'refresh-user' },
      on: (event: string, handler: (data: unknown) => void | Promise<void>) => handlers.set(event, handler),
      emit: (event: string, data: { success?: boolean }) => emitted.push({ event, data }),
    } as unknown as TypedSocket
    const io = { to: () => ({ emit() {} }) } as unknown as TypedServer
    const original = AUTH_PROVIDERS.netease
    let release!: () => void
    let started!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const began = new Promise<void>((resolve) => { started = resolve })
    const info = { ok: true as const, data: { nickname: '正常登录', vipType: 1, vipLabel: 'VIP', userId: 123 } }
    AUTH_PROVIDERS.netease = { ...original,
      generateQrCode: async () => ({ key: 'race-key', qrimg: 'test-image' }),
      getUserInfo: async () => { if (method === 'manual') { started(); await held } return info },
      checkQrStatus: async () => { started(); await held; return { status: QR_STATUS.SUCCESS, message: '成功', cookie: 'fresh-cookie' } },
    }
    try {
      registerAuthController(io, socket)
      if (method === 'qr') await handlers.get(EVENTS.AUTH_REQUEST_QR)!({ platform: 'netease' })
      const pending = handlers.get(method === 'manual' ? EVENTS.AUTH_SET_COOKIE : EVENTS.AUTH_CHECK_QR)!(
        method === 'manual' ? { platform: 'netease', cookie: 'fresh-cookie' } : { platform: 'netease', key: 'race-key' })
      await began
      await handlers.get(EVENTS.AUTH_LOGOUT)!({ platform: 'netease' })
      release()
      await pending
      assert.equal(authService.getUserCookie('refresh-user', 'netease', room.id), null)
      assert.equal(platformAuthRepo.loadUser('refresh-user').some((entry) => entry.platform === 'netease'), false)
      assert.equal(emitted.some((entry) => entry.event === EVENTS.AUTH_SET_COOKIE_RESULT && entry.data.success), false)
      AUTH_PROVIDERS.netease.getUserInfo = async () => info
      await handlers.get(EVENTS.AUTH_SET_COOKIE)!({ platform: 'netease', cookie: 'fresh-cookie' })
      assert.equal(authService.getUserCookie('refresh-user', 'netease', room.id), 'fresh-cookie')
      assert.equal(emitted.some((entry) => entry.event === EVENTS.AUTH_SET_COOKIE_RESULT && entry.data.success), true)
    } finally {
      AUTH_PROVIDERS.netease = original
      authService.cleanupRoom(room.id)
      roomRepo.delete(room.id)
    }
  })
}

test('an old account playlist result is not emitted after logout and re-login', async () => {
  const id = 'playlist-race'
  const { room } = roomService.createRoom(id, '测试用户', '歌单竞态', null, 'refresh-user')
  authService.addCookie(room.id, 'netease', 'refresh-user', 'old-account', '旧账号', 1)
  const handlers = new Map<string, (data: unknown) => void | Promise<void>>()
  const emitted: unknown[] = []
  const socket = { id, connected: true, data: { identityUserId: 'refresh-user' },
    on: (event: string, handler: (data: unknown) => void | Promise<void>) => handlers.set(event, handler),
    emit: (_event: string, data: unknown) => emitted.push(data),
  } as unknown as TypedSocket
  const original = AUTH_PROVIDERS.netease
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  AUTH_PROVIDERS.netease = { ...original, getUserPlaylists: async () => { await held; return [] } }
  try {
    registerPlaylistController({} as TypedServer, socket)
    const pending = handlers.get(EVENTS.PLAYLIST_GET_MY)!({ platform: 'netease' })
    authService.removeCookie(room.id, 'netease', 'refresh-user')
    authService.addCookie(room.id, 'netease', 'refresh-user', 'new-account', '新账号', 1)
    release()
    await pending
    assert.deepEqual(emitted, [])
    await handlers.get(EVENTS.PLAYLIST_GET_MY)!({ platform: 'netease' })
    assert.deepEqual(emitted, [{ platform: 'netease', playlists: [] }])
  } finally {
    AUTH_PROVIDERS.netease = original
    authService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})
