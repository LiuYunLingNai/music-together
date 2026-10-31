import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { EVENTS, QR_STATUS } from '@music-together/shared'
import type { TypedServer, TypedSocket } from '../src/middleware/types.js'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-auth-resilience-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const authService = await import('../src/services/authService.js')
const roomService = await import('../src/services/roomService.js')
const { AUTH_PROVIDERS } = await import('../src/services/authProvider.js')
const { registerAuthController } = await import('../src/controllers/authController.js')
const { roomRepo } = await import('../src/repositories/roomRepository.js')
const { platformAuthRepo } = await import('../src/repositories/platformAuthRepository.js')
const { db } = await import('../src/repositories/database.js')

for (const [id, nickname] of [
  ['auth-user', '测试用户'],
  ['fresh-user', '新用户'],
] as const) {
  db.prepare('INSERT INTO users (id, nickname, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    nickname,
    Date.now(),
    Date.now(),
    Date.now(),
  )
}

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

interface Emitted {
  event: string
  data: { success?: boolean; status?: number; message?: string; reason?: string }
}

function createHarness(socketId: string, userId = 'auth-user') {
  const handlers = new Map<string, (data: unknown) => void | Promise<void>>()
  const emitted: Emitted[] = []
  const socket = {
    id: socketId,
    connected: true,
    data: { identityUserId: userId },
    on: (event: string, handler: (data: unknown) => void | Promise<void>) => handlers.set(event, handler),
    emit: (event: string, data: Emitted['data']) => emitted.push({ event, data }),
  } as unknown as TypedSocket
  const io = { to: () => ({ emit() {} }) } as unknown as TypedServer
  registerAuthController(io, socket)
  return { handlers, emitted, socket }
}

test('a transient QR check failure does not tell the client the code expired', async () => {
  const { room } = roomService.createRoom('qr-transient', '测试用户', '扫码抖动', null, 'auth-user')
  const { handlers, emitted } = createHarness('qr-transient')
  const original = AUTH_PROVIDERS.netease
  let checks = 0
  AUTH_PROVIDERS.netease = {
    ...original,
    generateQrCode: async () => ({ key: 'transient-key', qrimg: 'test-image' }),
    // 第一次查询超时，第二次用户已确认
    checkQrStatus: async () => {
      checks += 1
      if (checks === 1) return { status: QR_STATUS.EXPIRED, message: '检查状态失败', transient: true }
      return { status: QR_STATUS.WAITING_SCAN, message: '等待扫码' }
    },
  }
  try {
    await handlers.get(EVENTS.AUTH_REQUEST_QR)!({ platform: 'netease' })
    emitted.length = 0

    await handlers.get(EVENTS.AUTH_CHECK_QR)!({ platform: 'netease', key: 'transient-key' })
    assert.equal(
      emitted.some((entry) => entry.event === EVENTS.AUTH_QR_STATUS),
      false,
      '临时失败时不应下发任何状态，否则客户端收到 800 就停止轮询',
    )

    // 下一轮轮询照常工作
    await handlers.get(EVENTS.AUTH_CHECK_QR)!({ platform: 'netease', key: 'transient-key' })
    const statuses = emitted.filter((entry) => entry.event === EVENTS.AUTH_QR_STATUS)
    assert.equal(statuses.length, 1)
    assert.equal(statuses[0]?.data.status, QR_STATUS.WAITING_SCAN)
    assert.equal(checks, 2)
  } finally {
    AUTH_PROVIDERS.netease = original
    authService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})

test('a real expiry is still reported to the client', async () => {
  const { room } = roomService.createRoom('qr-expired', '测试用户', '扫码过期', null, 'auth-user')
  const { handlers, emitted } = createHarness('qr-expired')
  const original = AUTH_PROVIDERS.netease
  AUTH_PROVIDERS.netease = {
    ...original,
    generateQrCode: async () => ({ key: 'expired-key', qrimg: 'test-image' }),
    checkQrStatus: async () => ({ status: QR_STATUS.EXPIRED, message: '二维码已过期，请重新获取' }),
  }
  try {
    await handlers.get(EVENTS.AUTH_REQUEST_QR)!({ platform: 'netease' })
    emitted.length = 0
    await handlers.get(EVENTS.AUTH_CHECK_QR)!({ platform: 'netease', key: 'expired-key' })

    const statuses = emitted.filter((entry) => entry.event === EVENTS.AUTH_QR_STATUS)
    assert.equal(statuses.length, 1)
    assert.equal(statuses[0]?.data.status, QR_STATUS.EXPIRED)
  } finally {
    AUTH_PROVIDERS.netease = original
    authService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})

test('an unverifiable cookie does not replace an existing valid credential', async () => {
  const { room } = roomService.createRoom('cookie-keep', '测试用户', '凭据覆盖', null, 'auth-user')
  const { handlers, emitted } = createHarness('cookie-keep')
  const original = AUTH_PROVIDERS.kugou
  try {
    // 设备 B 已经写入了有效凭据
    authService.addCookie(room.id, 'kugou', 'auth-user', 'new-token', '酷狗用户', 1, true, {
      vipLabel: '豪华VIP',
      vipLevel: 3,
    })

    // 设备 A 重发旧 token，验证失败（非 expired）
    AUTH_PROVIDERS.kugou = { ...original, getUserInfo: async () => ({ ok: false, reason: 'error' }) }
    await handlers.get(EVENTS.AUTH_SET_COOKIE)!({ platform: 'kugou', cookie: 'stale-token' })

    assert.equal(
      authService.getUserCookie('auth-user', 'kugou', room.id),
      'new-token',
      '验证失败的旧 Cookie 不能顶掉已有的有效凭据',
    )
    const status = authService.getUserAuthStatus('auth-user', room.id).find((entry) => entry.platform === 'kugou')
    assert.equal(status?.nickname, '酷狗用户')
    assert.equal(status?.vipType, 1)
    const persisted = platformAuthRepo.loadUser('auth-user').find((entry) => entry.platform === 'kugou')
    assert.equal(persisted?.cookie, 'new-token')

    const result = emitted.find((entry) => entry.event === EVENTS.AUTH_SET_COOKIE_RESULT)
    assert.equal(result?.data.success, false)
  } finally {
    AUTH_PROVIDERS.kugou = original
    authService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})

test('an unverifiable cookie is still saved when the user has no credential yet', async () => {
  // 独立账号：上一个用例已经给 auth-user 持久化了酷狗凭据
  const { room } = roomService.createRoom('cookie-first', '新用户', '首次登录', null, 'fresh-user')
  const { handlers, emitted } = createHarness('cookie-first', 'fresh-user')
  const original = AUTH_PROVIDERS.kugou
  try {
    AUTH_PROVIDERS.kugou = { ...original, getUserInfo: async () => ({ ok: false, reason: 'error' }) }
    await handlers.get(EVENTS.AUTH_SET_COOKIE)!({ platform: 'kugou', cookie: 'only-token', persist: false })

    assert.equal(authService.getUserCookie('fresh-user', 'kugou', room.id), 'only-token')
    const result = emitted.find((entry) => entry.event === EVENTS.AUTH_SET_COOKIE_RESULT)
    assert.equal(result?.data.success, true)
  } finally {
    AUTH_PROVIDERS.kugou = original
    authService.cleanupRoom(room.id)
    roomRepo.delete(room.id)
  }
})
