import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'music-together-audio-proxy-policy-'))
process.env.DATABASE_URL = `file:${path.join(testDataDir, 'test.db')}`
process.env.LOG_LEVEL = 'silent'

const { db } = await import('../src/repositories/database.js')
const { audioProxyPolicyRepo } = await import('../src/repositories/audioProxyPolicyRepository.js')

after(() => {
  db.close()
  rmSync(testDataDir, { recursive: true, force: true })
})

test('defaults both providers to forced proxy for existing installations', () => {
  assert.deepEqual(audioProxyPolicyRepo.get(), {
    bilibiliForceProxy: true,
    kugouForceProxy: true,
  })
})

test('persists partial policy updates without overwriting the other provider', () => {
  assert.deepEqual(audioProxyPolicyRepo.update({ bilibiliForceProxy: false }), {
    bilibiliForceProxy: false,
    kugouForceProxy: true,
  })
  assert.deepEqual(audioProxyPolicyRepo.update({ kugouForceProxy: false }), {
    bilibiliForceProxy: false,
    kugouForceProxy: false,
  })
  assert.deepEqual(audioProxyPolicyRepo.get(), {
    bilibiliForceProxy: false,
    kugouForceProxy: false,
  })
})
