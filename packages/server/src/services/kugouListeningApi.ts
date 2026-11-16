import { createHash, publicEncrypt, constants } from 'node:crypto'
import { parseCookieString } from '../utils/cookieUtils.js'
import { getDeviceMid } from './kugouAuthService.js'

// Protocol reference: MakcRe/KuGouMusicApi, module/user_grade_info.js and util/crypto.js.
// This endpoint tracks account duration; it does not claim rewards or submit listening history.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB
-----END PUBLIC KEY-----`
const APP_ID = '3116'
const CLIENT_VERSION = '10597'
const APP_KEY = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'
const md5 = (value: string) => createHash('md5').update(value).digest('hex')

function encrypt(value: object): string {
  const bytes = Buffer.from(JSON.stringify(value))
  if (bytes.length > 128) throw new Error('Kugou listening payload is too long')
  const padded = Buffer.alloc(128)
  bytes.copy(padded)
  return publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_NO_PADDING }, padded).toString('hex').toUpperCase()
}

export function kugouListeningAccount(cookie: string): string | null {
  const { token, userid } = parseCookieString(cookie)
  return token && /^[1-9]\d*$/.test(userid ?? '') && Number.isSafeInteger(Number(userid)) ? userid : null
}

export function createKugouListeningApi(fetcher: typeof fetch = fetch) {
  async function request(cookie: string, increment?: { baseline: number; seconds: number }): Promise<number> {
    const account = kugouListeningAccount(cookie)
    if (!account) throw new Error('Kugou listening requires an account')
    const credentials = parseCookieString(cookie)
    const clienttime = Math.floor(Date.now() / 1000)
    const data: Record<string, unknown> = {
      mid: credentials.mid || getDeviceMid(),
      type: 1,
      uuid: credentials.uuid || '-',
      userid: Number(account),
      appid: APP_ID,
      clientver: CLIENT_VERSION,
      clienttime,
      key: md5(`${APP_ID}${APP_KEY}${CLIENT_VERSION}${clienttime}`),
    }
    if (increment) {
      data.d_sec = increment.baseline
      data.diff_sec = increment.seconds
      data.y_type = 0
      data.m_type = 0
      data.p = encrypt({ token: credentials.token, md5: md5(`${increment.baseline}${increment.seconds}00`) })
    } else {
      data.p = encrypt({ clienttime, userid: Number(account) })
    }
    const url = new URL('https://userinfo.user.kugou.com/v2/get_grade_info')
    url.searchParams.set('dfid', credentials.dfid || '-')
    const response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'text/plain; charset=ISO-8859-1',
        'User-Agent': `Android15-1070-${CLIENT_VERSION}-201-0-get_user_grade_info-wifi`,
        'KG-THash': createHash('md5').update(String(Math.random())).digest('hex').slice(0, 7),
        'KG-Rec': '1',
        'KG-RC': '1',
      },
      body: JSON.stringify(data),
    })
    // Never include response bodies, URLs containing credentials, or fetch errors in logs.
    if (!response.ok) throw new Error('Kugou listening HTTP failure')
    const body = (await response.json()) as { status?: number; error_code?: number; data?: { d_sec?: unknown } }
    if (body.status !== 1 || (body.error_code != null && body.error_code !== 0)) {
      throw new Error('Kugou listening was rejected')
    }
    const value = body.data?.d_sec
    const seconds =
      typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      if (increment) return increment.baseline // Acknowledgement can precede updated statistics.
      throw new Error('Kugou listening baseline is unavailable')
    }
    return seconds
  }
  return {
    query: (cookie: string) => request(cookie),
    submit: (cookie: string, baseline: number, seconds: number) => request(cookie, { baseline, seconds }),
  }
}
