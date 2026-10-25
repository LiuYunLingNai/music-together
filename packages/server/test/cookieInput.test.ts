import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCookieInput, parseCookieString } from '../src/utils/cookieUtils.js'

describe('normalizeCookieInput', () => {
  it('passes a plain cookie string through unchanged', () => {
    const raw = 'uin=o03445487890; skey=abc123; p_skey=def456'
    assert.equal(normalizeCookieInput(raw), raw)
  })

  it('extracts the cookie header from a Copy as cURL command', () => {
    const curl = `curl 'https://y.qq.com/portal/playlist' \\
  -H 'accept: */*' \\
  -H 'cookie: uin=o03445487890; skey=abc123; p_skey=def456' \\
  -H 'user-agent: Mozilla/5.0'`
    const cookie = normalizeCookieInput(curl)
    assert.equal(cookie, 'uin=o03445487890; skey=abc123; p_skey=def456')
    assert.equal(parseCookieString(cookie).p_skey, 'def456')
  })

  it('extracts the cookie from the -b flag', () => {
    const curl = `curl 'https://y.qq.com/' -b 'uin=o1; p_skey=xyz'`
    assert.equal(normalizeCookieInput(curl), 'uin=o1; p_skey=xyz')
  })

  it('strips a leading "Cookie:" label', () => {
    assert.equal(normalizeCookieInput('Cookie: uin=o1; skey=s'), 'uin=o1; skey=s')
  })

  it('returns an empty string for blank input', () => {
    assert.equal(normalizeCookieInput('   '), '')
  })

  it('keeps HttpOnly session keys intact end to end', () => {
    const curl = `curl 'https://y.qq.com/' --header 'cookie: uin=o03445487890; skey=abc; p_skey=def; qm_keyst=ghi'`
    const parsed = parseCookieString(normalizeCookieInput(curl))
    assert.deepEqual(
      { uin: parsed.uin, skey: parsed.skey, p_skey: parsed.p_skey, qm_keyst: parsed.qm_keyst },
      { uin: 'o03445487890', skey: 'abc', p_skey: 'def', qm_keyst: 'ghi' },
    )
  })
})
