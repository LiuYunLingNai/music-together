import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalCwd = process.cwd()
const originalNodeEnv = process.env.NODE_ENV
const originalIdentitySecret = process.env.IDENTITY_SECRET

afterEach(() => {
  process.chdir(originalCwd)
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalIdentitySecret === undefined) delete process.env.IDENTITY_SECRET
  else process.env.IDENTITY_SECRET = originalIdentitySecret
  vi.resetModules()
})

describe('server identity configuration compatibility', () => {
  it('starts in production without requiring an explicit identity secret', async () => {
    const isolatedCwd = mkdtempSync(join(tmpdir(), 'music-together-config-'))
    process.chdir(isolatedCwd)
    process.env.NODE_ENV = 'production'
    delete process.env.IDENTITY_SECRET
    vi.resetModules()

    try {
      const { config } = await import('./config.js')
      expect(config.identity.secret).toBe('dev-identity-secret-change-me')
    } finally {
      process.chdir(originalCwd)
      rmSync(isolatedCwd, { recursive: true, force: true })
    }
  })
})
