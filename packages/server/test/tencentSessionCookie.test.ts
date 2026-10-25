import assert from 'node:assert/strict'
import test, { after } from 'node:test'

const tencentAuth = await import('../src/services/tencentAuthService.js')

const originalFetch = globalThis.fetch

after(() => {
  globalThis.fetch = originalFetch
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response): string[] {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    return handler(url, init)
  }) as typeof fetch
  return calls
}

const SESSION_COOKIE = 'uin=o010086; p_skey=pskey-value; skey=skey-value; pt4_token=token-value'

test('rejects a session cookie without p_skey before touching the network', async () => {
  const calls = stubFetch(() => {
    throw new Error('network must not be used')
  })

  const result = await tencentAuth.loginWithSessionCookie('uin=o010086; qm_keyst=abc')

  assert.equal(result, null)
  assert.deepEqual(calls, [])
})

test('exchanges a browser session cookie for a refreshable credential', async () => {
  let authorizeCookieHeader = ''
  const calls = stubFetch((url, init) => {
    if (url.startsWith('https://graph.qq.com/oauth2.0/authorize')) {
      const headers = (init?.headers ?? {}) as Record<string, string>
      authorizeCookieHeader = headers.Cookie ?? ''
      return new Response(null, {
        status: 302,
        headers: { location: 'https://y.qq.com/portal/wx_redirect.html?code=AUTH_CODE_123&state=state' },
      })
    }

    if (url.startsWith('https://u.y.qq.com/')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        req: { module: string; method: string; param: { code: string } }
      }
      assert.equal(body.req.module, 'QQConnectLogin.LoginServer')
      assert.equal(body.req.method, 'QQLogin')
      assert.equal(body.req.param.code, 'AUTH_CODE_123')
      return new Response(
        JSON.stringify({
          code: 0,
          req: {
            code: 0,
            data: {
              musicid: 10086,
              musickey: 'W_Xtest-key',
              refresh_token: 'refresh-token',
              refresh_key: 'refresh-key',
              access_token: 'access-token',
              openid: 'openid-value',
              unionid: 'unionid-value',
              expired_at: 1767225600,
              str_musicid: '10086',
              loginType: 1,
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    throw new Error(`unexpected fetch: ${url}`)
  })

  const result = await tencentAuth.loginWithSessionCookie(SESSION_COOKIE)

  assert.ok(result, 'should return a credential cookie')
  // 关键：换出来的凭证必须可自动续期，否则就退化成「粘贴一次只能撑几小时」
  assert.equal(tencentAuth.isRefreshableCredential(result), true)

  const credential = tencentAuth.parseTencentCredential(result)
  assert.equal(credential?.musicid, 10086)
  assert.equal(credential?.musickey, 'W_Xtest-key')
  assert.equal(credential?.refreshToken, 'refresh-token')
  assert.equal(credential?.refreshKey, 'refresh-key')

  // authorize 必须收到完整会话 Cookie，graph.qq.com 会同时校验 p_skey 与来源会话
  assert.ok(authorizeCookieHeader.includes('p_skey=pskey-value'))
  assert.ok(authorizeCookieHeader.includes('pt4_token=token-value'))
  assert.ok(
    calls.some((url) => url.startsWith('https://graph.qq.com/oauth2.0/authorize')),
    'should call the QQ Connect authorize endpoint',
  )
})

test('returns null when the authorize step yields no code', async () => {
  stubFetch(() => new Response(null, { status: 302 }))

  const result = await tencentAuth.loginWithSessionCookie(SESSION_COOKIE)

  assert.equal(result, null)
})

test('returns null instead of throwing when the network fails', async () => {
  stubFetch(() => {
    throw new Error('socket hang up')
  })

  const result = await tencentAuth.loginWithSessionCookie(SESSION_COOKIE)

  assert.equal(result, null)
})
