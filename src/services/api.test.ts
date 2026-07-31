import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapIdentity, logoutIdentity, recoverIdentity, requestJson, updateAccountId } from './api'

describe('bootstrapIdentity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.desktop
  })

  it('accepts the server 204 No Content response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 204,
      headers: { 'X-Identity-UserId': 'desktop-user', 'X-Identity-Expires-At': '123456' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(bootstrapIdentity('https://music.example')).resolves.toEqual({
      userId: 'desktop-user',
      expiresAt: 123456,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://music.example/api/auth/identity/bootstrap',
      { method: 'POST', credentials: 'include' },
    )
  })

  it('uses the Electron identity bridge when available', async () => {
    const bootstrap = vi.fn().mockResolvedValue({ userId: 'electron-user' })
    window.desktop = { bootstrapIdentity: bootstrap } as unknown as Window['desktop']
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(bootstrapIdentity('https://music.example')).resolves.toEqual({ userId: 'electron-user' })

    expect(bootstrap).toHaveBeenCalledWith('https://music.example')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('requestJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.desktop
  })

  it('accepts 204 and empty successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(requestJson<void>('https://music.example', '/api/admin/users/a', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('reports plain-text reverse-proxy errors without trying to parse JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream unavailable', { status: 502 })))
    await expect(requestJson('https://music.example', '/api/test')).rejects.toThrow('upstream unavailable')
  })

  it('routes identity changes through the Electron cookie bridge', async () => {
    const recover = vi.fn().mockResolvedValue({ userId: 'saved-account', expiresAt: 123 })
    const logout = vi.fn().mockResolvedValue({ userId: 'new-guest', expiresAt: 456 })
    const updateId = vi.fn().mockResolvedValue({ id: 'renamed-account', nickname: 'QA', hasPassword: false, role: 'user' })
    window.desktop = { recoverIdentity: recover, logoutIdentity: logout, updateAccountId: updateId } as unknown as Window['desktop']
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(recoverIdentity('https://music.example', '  saved-account  ', 'secret')).resolves.toEqual({ userId: 'saved-account', expiresAt: 123 })
    await expect(logoutIdentity('https://music.example')).resolves.toEqual({ userId: 'new-guest', expiresAt: 456 })
    await expect(updateAccountId('https://music.example', '  renamed-account  ')).resolves.toMatchObject({ id: 'renamed-account' })
    expect(recover).toHaveBeenCalledWith('https://music.example', 'saved-account', 'secret')
    expect(logout).toHaveBeenCalledWith('https://music.example')
    expect(updateId).toHaveBeenCalledWith('https://music.example', 'renamed-account', undefined)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
