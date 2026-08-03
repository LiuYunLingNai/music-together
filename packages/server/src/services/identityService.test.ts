import type { Request, Response } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getIdentityFromCookieHeader,
  IDENTITY_COOKIE_NAME,
  issueIdentityCookie,
  verifyIdentityToken,
} from './identityService.js'

function issue(userId = 'user-1', secure = false): { token: string; cookie: string } {
  let cookie = ''
  const req = {
    secure,
    headers: {},
  } as Request
  const res = {
    setHeader: vi.fn((_name: string, value: string) => {
      cookie = value
    }),
  } as unknown as Response

  issueIdentityCookie(req, res, userId)
  const token = decodeURIComponent(cookie.match(new RegExp(`${IDENTITY_COOKIE_NAME}=([^;]+)`))?.[1] ?? '')
  return { token, cookie }
}

afterEach(() => vi.useRealTimers())

describe('identityService', () => {
  it('issues and verifies signed identity cookies', () => {
    const { token, cookie } = issue('persistent-user')

    expect(verifyIdentityToken(token, 'http')).toMatchObject({ uid: 'persistent-user', ver: 1 })
    expect(getIdentityFromCookieHeader(cookie)).toEqual({ userId: 'persistent-user' })
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('rejects tampered signatures', () => {
    const { token } = issue()
    const [payload, signature] = token.split('.')

    expect(verifyIdentityToken(`${payload}.${signature.slice(0, -1)}x`, 'socket')).toBeNull()
  })

  it('does not force Secure cookies in the development configuration', () => {
    const { cookie } = issue('user-1', true)

    expect(cookie).not.toContain('; Secure')
  })

  it('rejects expired tokens', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { token } = issue()
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))

    expect(verifyIdentityToken(token, 'http')).toBeNull()
  })
})
