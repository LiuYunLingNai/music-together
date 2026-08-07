import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTencentCredentialCookie,
  formatTencentVipLabel,
  isRefreshableCredential,
  parseTencentCredential,
  parseTencentMembership,
  refreshCredential,
} from '../src/services/tencentAuthService.js'

test('parses QQ Music super membership and progression level', () => {
  assert.deepEqual(
    parseTencentMembership({
      identity: { svip: 1, level: 6 },
    }),
    {
      vipType: 2,
      vipLabel: '超级会员·Lv6',
      vipLevel: 6,
    },
  )
})

test('ignores top-level svip and parses identity vip as green diamond VIP', () => {
  assert.deepEqual(parseTencentMembership({ svip: 1, identity: { vip: 1, level: 3 } }), {
    vipType: 1,
    vipLabel: '绿钻VIP·Lv3',
    vipLevel: 3,
  })
})

test('supports identity LMFlag and ignores top-level flags for non-members', () => {
  assert.deepEqual(parseTencentMembership({ identity: { LMFlag: 1, level: 3 } }), {
    vipType: 1,
    vipLabel: '绿钻VIP·Lv3',
    vipLevel: 3,
  })
  assert.deepEqual(parseTencentMembership({ vip: 1, svip: 1, identity: { level: 6 } }), {
    vipType: 0,
    vipLabel: undefined,
    vipLevel: undefined,
  })
  assert.equal(formatTencentVipLabel(0, 6), undefined)
})

test('refreshes and rotates a complete QQ Music credential', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, any> | undefined
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        code: 0,
        req: {
          code: 0,
          data: {
            code: 0,
            musicid: 123456,
            musickey: 'new-music-key',
            refresh_token: 'new-refresh-token',
            refresh_key: 'new-refresh-key',
            access_token: 'new-access-token',
            loginType: 2,
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const originalCookie = buildTencentCredentialCookie('', {
      musicid: 123456,
      musickey: 'old-music-key',
      refresh_token: 'old-refresh-token',
      refresh_key: 'old-refresh-key',
      access_token: 'old-access-token',
      loginType: 2,
    })
    assert.equal(isRefreshableCredential(originalCookie), true)

    const refreshedCookie = await refreshCredential(originalCookie)
    assert.equal(requestBody?.req?.module, 'music.login.LoginServer')
    assert.equal(requestBody?.req?.method, 'Login')
    assert.equal(requestBody?.req?.param?.refresh_token, 'old-refresh-token')
    assert.equal(requestBody?.req?.param?.refresh_key, 'old-refresh-key')
    assert.equal(requestBody?.req?.param?.loginMode, 2)
    assert.equal(requestBody?.comm?.uin, 123456)
    assert.equal(requestBody?.comm?.tmeLoginType, 2)
    assert.deepEqual(parseTencentCredential(refreshedCookie), {
      musicid: 123456,
      musickey: 'new-music-key',
      openid: '',
      refreshToken: 'new-refresh-token',
      accessToken: 'new-access-token',
      expiredAt: 0,
      unionid: '',
      strMusicid: '123456',
      refreshKey: 'new-refresh-key',
      musickeyCreateTime: 0,
      keyExpiresIn: 0,
      loginType: 2,
      refreshVersion: 1,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects legacy QQ Music cookies without complete refresh fields', async () => {
  const legacyCookie = 'uin=123456; qm_keyst=old-key; o_refresh_token=old-refresh-token'
  assert.equal(isRefreshableCredential(legacyCookie), false)
  await assert.rejects(refreshCredential(legacyCookie), /重新扫码登录/)
})
