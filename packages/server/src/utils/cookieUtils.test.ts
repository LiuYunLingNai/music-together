import { describe, expect, it } from 'vitest'
import { getCookieValue, parseCookieString } from './cookieUtils.js'

describe('cookieUtils', () => {
  it('preserves values containing equals signs', () => {
    expect(parseCookieString('token=abc==; uin=123')).toEqual({ token: 'abc==', uin: '123' })
  })

  it('ignores malformed pairs and preserves empty values', () => {
    expect(parseCookieString('invalid; empty=; valid=yes')).toEqual({ empty: '', valid: 'yes' })
  })

  it('extracts an exact cookie key', () => {
    const cookie = 'qqmusic_uin=wrong; uin=123456; qm_keyst=abc=='

    expect(getCookieValue(cookie, 'uin')).toBe('123456')
    expect(getCookieValue(cookie, 'qm_keyst')).toBe('abc==')
    expect(getCookieValue(cookie, 'missing')).toBeNull()
  })
})
