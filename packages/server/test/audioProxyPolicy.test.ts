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

test('defaults Kugou to forced proxy for existing installations', () => {
  assert.deepEqual(audioProxyPolicyRepo.get(), {
    kugouForceProxy: true,
  })
})

test('persists Kugou policy updates', () => {
  assert.deepEqual(audioProxyPolicyRepo.update({ kugouForceProxy: false }), {
    kugouForceProxy: false,
  })
  assert.deepEqual(audioProxyPolicyRepo.get(), {
    kugouForceProxy: false,
  })
})
