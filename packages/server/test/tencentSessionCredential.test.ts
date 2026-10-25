import assert from 'node:assert/strict'
import test from 'node:test'

const tencentAuth = await import('../src/services/tencentAuthService.js')

// 手机浏览器登录 y.qq.com 后 DevTools 里能看到的真实形态：
// qm_keyst 可读（非 HttpOnly），uin 带 o 前缀。
const MOBILE_COOKIE =
  'uin=o0012345678; qm_keyst=Q_H_L_abc123; qqmusic_key=Q_H_L_abc123; login_type=1; _qpsvr_localtk=0.123'

test('buildSessionCredentialCookie normalizes a qm_keyst only cookie', () => {
  const normalized = tencentAuth.buildSessionCredentialCookie(MOBILE_COOKIE)
  assert.ok(normalized, '应当接受只有 qm_keyst 的 Cookie')

  const credential = tencentAuth.parseTencentCredential(normalized!)
  assert.ok(credential)
  assert.equal(credential!.musicid, 12345678)
  assert.equal(credential!.musickey, 'Q_H_L_abc123')
  assert.equal(credential!.loginType, 1)
  assert.equal(credential!.strMusicid, '12345678')
})

test('session credential is usable but not refreshable', () => {
  const normalized = tencentAuth.buildSessionCredentialCookie(MOBILE_COOKIE)!
  assert.equal(tencentAuth.isRefreshableCredential(normalized), false)
  assert.equal(tencentAuth.isSessionCredential(normalized), true)
})

test('qqmusic_key alone is accepted as the playback key', () => {
  const normalized = tencentAuth.buildSessionCredentialCookie('uin=123456; qqmusic_key=W_X_key')
  assert.ok(normalized)
  const credential = tencentAuth.parseTencentCredential(normalized!)
  assert.equal(credential!.musickey, 'W_X_key')
  // W_X 前缀代表微信登录
  assert.equal(credential!.loginType, 1)
})

test('musicid cookie without uin still resolves', () => {
  const normalized = tencentAuth.buildSessionCredentialCookie('musicid=998877; qm_keyst=key')
  assert.ok(normalized)
  assert.equal(tencentAuth.parseTencentCredential(normalized!)!.musicid, 998877)
})

test('rejects cookie without any playback key', () => {
  assert.equal(tencentAuth.buildSessionCredentialCookie('uin=o0012345678; skey=abc'), null)
})

test('rejects cookie without a usable uin', () => {
  assert.equal(tencentAuth.buildSessionCredentialCookie('qm_keyst=key'), null)
  assert.equal(tencentAuth.buildSessionCredentialCookie('uin=o0; qm_keyst=key'), null)
})

test('keeps unrelated cookies so other QQ APIs still work', () => {
  const normalized = tencentAuth.buildSessionCredentialCookie(MOBILE_COOKIE)!
  assert.match(normalized, /_qpsvr_localtk=0\.123/)
})
