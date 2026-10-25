import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { EVENTS } from '@music-together/shared'
import type { MusicSource } from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../src/middleware/types.js'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-quick-login-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`

const authService = await import('../src/services/authService.js')
const { db } = await import('../src/repositories/database.js')
const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')
const { roomRepo } = await import('../src/repositories/roomRepository.js')
const roomService = await import('../src/services/roomService.js')
const { AUTH_PROVIDERS } = await import('../src/services/authProvider.js')
const { registerAuthController } = await import('../src/controllers/authController.js')

const USER_ID = 'quick-login-user'
const ROOM_ID = 'quick-login-room'

db.prepare('INSERT INTO users (id, nickname, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
  USER_ID,
  '测试用户',
  Date.now(),
  Date.now(),
  Date.now(),
)
roomService.createRoom(ROOM_ID, '测试用户', '快捷登录房间', null, USER_ID)

after(() => {
  authService.cleanupRoom(ROOM_ID)
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

interface Harness {
  emitted: { event: string; data: Record<string, unknown> }[]
  quickLogin: (platform: MusicSource) => Promise<void>
  requestQr: (platform: MusicSource) => Promise<void>
}

/** 每个 socket 只消费一次认证限流额度，所以每个动作使用独立 socket。 */
function createHarness(socketId: string): Harness {
  const handlers = new Map<string, (data: unknown) => void | Promise<void>>()
  const emitted: { event: string; data: Record<string, unknown> }[] = []
  const socket = {
    id: socketId,
    connected: true,
    data: { identityUserId: USER_ID },
    on: (event: string, handler: (data: unknown) => void | Promise<void>) => handlers.set(event, handler),
    emit: (event: string, data: Record<string, unknown>) => emitted.push({ event, data }),
  } as unknown as TypedSocket
  const io = { to: () => ({ emit() {} }) } as unknown as TypedServer

  roomRepo.setSocketMapping(socketId, ROOM_ID, USER_ID)
  registerAuthController(io, socket)

  const invoke = async (event: string, payload: unknown) => {
    const handler = handlers.get(event)
    assert.ok(handler, `${event} handler should be registered`)
    await handler!(payload)
  }

  return {
    emitted,
    quickLogin: (platform) => invoke(EVENTS.AUTH_QUICK_LOGIN, { platform }),
    requestQr: (platform) => invoke(EVENTS.AUTH_REQUEST_QR, { platform }),
  }
}

function resultOf(harness: Harness, event: string) {
  return harness.emitted.find((item) => item.event === event)?.data
}

function myStatus(platform: MusicSource) {
  return authService.getUserAuthStatus(USER_ID, ROOM_ID).find((item) => item.platform === platform)
}

test('QR generation carries the saved account so the dialog can offer quick login', async () => {
  authService.addCookie(ROOM_ID, 'netease', USER_ID, 'saved-cookie', '已保存用户', 1, true, {
    vipLabel: 'VIP',
    vipLevel: 3,
  })

  const original = AUTH_PROVIDERS.netease
  AUTH_PROVIDERS.netease = {
    ...original,
    generateQrCode: async () => ({ key: 'qr-key', qrimg: 'data:image/png;base64,test' }),
  }

  try {
    const harness = createHarness('quick-login-qr')
    await harness.requestQr('netease')

    const generated = resultOf(harness, EVENTS.AUTH_QR_GENERATED)
    assert.ok(generated, 'AUTH_QR_GENERATED should be emitted')
    assert.equal((generated.savedAccount as { nickname?: string } | undefined)?.nickname, '已保存用户')
    // 只下发展示字段，凭据绝不出现在事件载荷里
    assert.equal(JSON.stringify(generated).includes('saved-cookie'), false)
  } finally {
    AUTH_PROVIDERS.netease = original
  }
})

test('quick login restores a saved account without scanning', async () => {
  authService.addCookie(ROOM_ID, 'netease', USER_ID, 'saved-cookie', '已保存用户', 1, true, {
    vipLabel: 'VIP',
    vipLevel: 3,
  })
  // 模拟内存池丢失（换设备 / 服务重启），此时只剩服务端持久化记录
  authService.cleanupRoom(ROOM_ID)
  assert.equal(myStatus('netease')?.loggedIn, false)

  const original = AUTH_PROVIDERS.netease
  AUTH_PROVIDERS.netease = {
    ...original,
    getUserInfo: async () => ({
      ok: true as const,
      data: { nickname: '已保存用户', vipType: 1, vipLabel: 'VIP', vipLevel: 3, userId: 123 },
    }),
  }

  try {
    const harness = createHarness('quick-login-restore')
    await harness.quickLogin('netease')

    const result = resultOf(harness, EVENTS.AUTH_QUICK_LOGIN_RESULT)
    assert.equal(result?.success, true)
    assert.equal(result?.nickname, '已保存用户')

    const restored = myStatus('netease')
    assert.equal(restored?.loggedIn, true)
    assert.equal(restored?.nickname, '已保存用户')
    assert.equal(restored?.vipLabel, 'VIP')
  } finally {
    AUTH_PROVIDERS.netease = original
  }
})

test('quick login reports not_found when nothing is saved', async () => {
  const harness = createHarness('quick-login-missing')
  await harness.quickLogin('bilibili')

  const result = resultOf(harness, EVENTS.AUTH_QUICK_LOGIN_RESULT)
  assert.equal(result?.success, false)
  assert.equal(result?.reason, 'not_found')
  assert.equal(
    platformAuthRepo.loadUser(USER_ID).some((entry) => entry.platform === 'bilibili'),
    false,
  )
})

test('expired saved account asks the user to scan again but keeps the record', async () => {
  authService.addCookie(ROOM_ID, 'kugou', USER_ID, 'stale-cookie', '过期用户', 0, true)
  authService.cleanupRoom(ROOM_ID)

  const original = AUTH_PROVIDERS.kugou
  AUTH_PROVIDERS.kugou = { ...original, getUserInfo: async () => ({ ok: false as const, reason: 'expired' }) }

  try {
    const harness = createHarness('quick-login-expired')
    await harness.quickLogin('kugou')

    const result = resultOf(harness, EVENTS.AUTH_QUICK_LOGIN_RESULT)
    assert.equal(result?.success, false)
    assert.equal(result?.reason, 'reauth_required')
    // 记录保留，用户可以扫码覆盖，而不是静默丢失账号
    assert.equal(
      platformAuthRepo.loadUser(USER_ID).some((entry) => entry.platform === 'kugou'),
      true,
    )
    assert.equal(myStatus('kugou')?.loggedIn, false)
  } finally {
    AUTH_PROVIDERS.kugou = original
  }
})
