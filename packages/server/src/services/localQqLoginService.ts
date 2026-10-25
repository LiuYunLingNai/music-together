/**
 * 本机 QQ 客户端「一键登录」
 *
 * QQ 网页登录（ptlogin）在 Windows 上会优先走本机已登录的 QQ 客户端：
 * 前端 `c_login_2.js` 向 `https://localhost.ptlogin2.qq.com:4301` 发 JSONP 请求，
 * 由 QQ NT 客户端直接返回本机已登录的账号列表，点一下头像即可拿到登录票据。
 *
 * 本服务在服务端复刻这条链路，因此**首次登录也无需扫码**：
 *
 *   1. `pt_get_uins`          → 本机已登录账号列表（uin / 昵称）
 *   2. `pt_get_st`            → `clientkey`（Set-Cookie）+ `keyindex`
 *   3. `hash33(clientkey)`    → 作为 `pt_local_tk`
 *   4. `ssl.ptlogin2.qq.com/jump` → 302 的 Location 中带 `ptsigx`
 *   5. 跟随该 Location（`check_sig`）→ 下发 `p_skey` / `p_uin` / `pt4_token`
 *   6. 交给 `loginWithSessionCookie` 完成「授权码 → musickey」兑换
 *
 * 前提：服务端与 QQ NT 客户端运行在同一台 Windows 机器上，且客户端已登录。
 * 不满足时 `listLocalAccounts()` 返回空列表，前端自动回退到扫码。
 */

import { loginWithSessionCookie } from './tencentAuthService.js'
import { logger } from '../utils/logger.js'

/** ptlogin 网页端使用的 APPID（非 QQ 互联 client_id） */
const PT_APPID = '716027609'
/** QQ 音乐在 QQ 互联的 client_id / pt_3rd_aid */
const PT_3RD_AID = '100497308'
const DAID = '383'
/** 登录成功后的落地地址，check_sig 需要它来决定给哪个域下发票据 */
const S_URL = 'https://graph.qq.com/oauth2.0/login_jump'

/** QQ 客户端按 https 端口顺序提供本机服务，逐个尝试 */
const LOCAL_PORTS = [4301, 4303, 4305, 4307, 4309]

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'

const LOCAL_TIMEOUT_MS = 3_000
const REMOTE_TIMEOUT_MS = 10_000
/** check_sig 之后最多再跟几跳重定向去收集 p_skey */
const MAX_SIG_HOPS = 4

export interface LocalQqAccount {
  uin: string
  nickname: string
  avatarUrl: string
}

export interface LocalQqAccountProbe {
  /** 当前环境是否具备本机一键登录能力（Windows 且客户端在跑） */
  available: boolean
  accounts: LocalQqAccount[]
  /** 不可用时的原因，便于前端提示 */
  message?: string
}

/**
 * 腾讯 hash33 —— 与 ptlogin 前端 `str.hash33` 完全一致。
 * 必须保留 32 位有符号语义，否则大整数会算错。
 */
function hash33(str: string, initialHash = 0): number {
  let hash = initialHash
  for (let i = 0; i < str.length; i++) {
    hash += (hash << 5) + str.charCodeAt(i)
    hash |= 0
  }
  return hash & 0x7fffffff
}

/** 模拟 ptlogin 页面发出的 JSONP 请求头，缺一个都可能被本机服务判 400 */
function localHeaders(cookie: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=${PT_APPID}`,
    Origin: 'https://xui.ptlogin2.qq.com',
    'Sec-Fetch-Dest': 'script',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'same-site',
    ...(cookie ? { Cookie: cookie } : {}),
  }
}

/**
 * 合并 Set-Cookie。
 *
 * 注意：同一批响应里常见「同名 cookie 分别写给 `.qq.com` 和 `ptlogin2.qq.com`」，
 * 其中一份是空值的清除指令。若把空值也写回 jar，会把刚拿到的 `p_skey` 抹掉，
 * 因此这里只接受非空值、忽略清除指令。
 */
function absorbCookies(jar: Map<string, string>, res: Response): void {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const kv = raw.split(';')[0] ?? ''
    const idx = kv.indexOf('=')
    if (idx <= 0) continue
    const key = kv.slice(0, idx).trim()
    const value = kv.slice(idx + 1).trim()
    if (key && value) jar.set(key, value)
  }
}

function jarToString(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function avatarUrlOf(uin: string): string {
  return `https://q1.qlogo.cn/g?b=sdk&nk=${encodeURIComponent(uin)}&s=140`
}

/** 从 `var var_sso_uin_list=[...];` 这类 JSONP 响应里抠出账号数组 */
export function parseUinList(body: string): Array<{ uin: string; nickname: string }> {
  const match = body.match(/var_sso_uin_list\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (!match?.[1]) return []
  try {
    const parsed = JSON.parse(match[1]) as Array<{ uin?: number | string; nickname?: string }>
    return parsed
      .map((item) => ({
        uin: String(item.uin ?? '').trim(),
        nickname: (item.nickname ?? '').trim(),
      }))
      .filter((item) => /^\d{5,12}$/.test(item.uin))
  } catch {
    return []
  }
}

/** 从 `var var_sso_get_st_uin={uin: 1, keyindex: 19};` 里抠出 keyindex */
export function parseKeyIndex(body: string): string | null {
  return body.match(/keyindex\s*:\s*(\d+)/)?.[1] ?? null
}

async function fetchLocal(
  port: number,
  action: string,
  cookie: string,
): Promise<Response> {
  return fetch(`https://localhost.ptlogin2.qq.com:${port}/${action}`, {
    headers: localHeaders(cookie),
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  })
}

/** 依次尝试各端口，返回第一个成功响应的文本（可顺带并入响应 Cookie） */
async function requestLocal(
  action: string,
  cookie: string,
  jar?: Map<string, string>,
): Promise<string | null> {
  for (const port of LOCAL_PORTS) {
    try {
      const res = await fetchLocal(port, action, cookie)
      if (!res.ok) continue
      const text = await res.text()
      if (text) {
        if (jar) absorbCookies(jar, res)
        return text
      }
    } catch {
      // 端口未监听 / 超时 —— 换下一个
    }
  }
  return null
}

/**
 * 探测本机已登录的 QQ 账号。
 *
 * 只有在「Windows + QQ NT 客户端已登录」时才可能返回非空列表；
 * 其余情况返回 `available: false`，调用方应回退到扫码登录。
 */
export async function listLocalAccounts(): Promise<LocalQqAccountProbe> {
  if (process.platform !== 'win32') {
    return { available: false, accounts: [], message: '本机一键登录仅支持 Windows 客户端' }
  }

  const token = String(Math.random())
  const jar = new Map<string, string>([['pt_local_token', token]])
  const action =
    `pt_get_uins?callback=ptui_getuins_CB&r=${Math.random()}` +
    `&pt_local_tk=${token}&pt_aid=${PT_APPID}&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}` +
    `&u1=${encodeURIComponent(S_URL)}`

  const body = await requestLocal(action, jarToString(jar), jar)
  if (!body) {
    return { available: false, accounts: [], message: '未检测到本机已登录的 QQ 客户端' }
  }

  const accounts = parseUinList(body).map((item) => ({
    ...item,
    avatarUrl: avatarUrlOf(item.uin),
  }))

  logger.info('本机 QQ 一键登录账号探测完成', {
    event: 'auth.local_qq_probe',
    count: accounts.length,
  })

  return { available: accounts.length > 0, accounts }
}

/**
 * 用本机客户端指定 uin 完成登录，返回可刷新的 QQ 音乐凭证。
 *
 * 返回 `null` 表示该账号无法完成兑换（客户端未登录、票据被风控等），
 * 调用方应提示用户改用扫码。
 */
export async function loginWithLocalAccount(uin: string): Promise<string | null> {
  if (process.platform !== 'win32') return null
  if (!/^\d{5,12}$/.test(uin)) return null

  const token = String(Math.random())
  const jar = new Map<string, string>([['pt_local_token', token]])
  const cookieString = () => jarToString(jar)

  // 1) 先确认账号确实在本机列表里，同时让客户端建立本次会话
  const listAction =
    `pt_get_uins?callback=ptui_getuins_CB&r=${Math.random()}` +
    `&pt_local_tk=${token}&pt_aid=${PT_APPID}&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}` +
    `&u1=${encodeURIComponent(S_URL)}`
  const listBody = await requestLocal(listAction, cookieString(), jar)
  if (!listBody) return null
  const known = parseUinList(listBody).some((item) => item.uin === uin)
  if (!known) {
    logger.warn('本机 QQ 账号列表中不存在该 uin', { event: 'auth.local_qq_unknown_uin', uin })
    return null
  }

  // 2) 点「头像」：换取 clientkey（Set-Cookie）与 keyindex
  const stAction =
    `pt_get_st?clientuin=${uin}&callback=ptui_getst_CB&r=${Math.random()}` +
    `&pt_local_tk=${token}&pt_aid=${PT_APPID}&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}`
  let stBody: string | null = null
  let stPort: number | null = null
  for (const port of LOCAL_PORTS) {
    try {
      const res = await fetchLocal(port, stAction, cookieString())
      if (!res.ok) continue
      stBody = await res.text()
      absorbCookies(jar, res)
      stPort = port
      break
    } catch {
      // 换下一个端口
    }
  }
  if (!stBody || stPort === null) return null

  const keyindex = parseKeyIndex(stBody)
  const clientkey = jar.get('clientkey')
  if (!keyindex || !clientkey) {
    logger.warn('本机 QQ 一键登录未取到 clientkey/keyindex', {
      event: 'auth.local_qq_st_missing',
      hasKeyindex: Boolean(keyindex),
      hasClientkey: Boolean(clientkey),
    })
    return null
  }

  // 3) jump：把 hash33(clientkey) 作为 pt_local_tk，换出带 ptsigx 的跳转地址
  const jumpUrl =
    `https://ssl.ptlogin2.qq.com/jump?clientuin=${uin}&keyindex=${keyindex}` +
    `&pt_aid=${PT_APPID}&daid=${DAID}&u1=${encodeURIComponent(S_URL)}` +
    `&pt_local_tk=${hash33(clientkey)}&pt_3rd_aid=${PT_3RD_AID}`

  const jumpRes = await fetch(jumpUrl, {
    headers: localHeaders(cookieString()),
    redirect: 'manual',
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
  })
  absorbCookies(jar, jumpRes)

  let sigLocation = jumpRes.headers.get('location') ?? ''
  if (!/ptsigx=/.test(sigLocation)) {
    // 部分参数组合下 jump 返回 200 + `application/javascript` 正文，
    // 用 `location.href = "…check_sig?…"` 自己跳转（QQ 音乐客户端抓包里就是这种），
    // 此时没有 Location 头，需要从正文里把地址捞出来。
    const body = await jumpRes.text().catch(() => '')
    const fromBody = body.match(/https?:\/\/[^"'\s\\]*check_sig\?[^"'\s\\]*/)
    if (fromBody) sigLocation = fromBody[0].replace(/&amp;/g, '&')
  }

  if (!/ptsigx=/.test(sigLocation)) {
    logger.warn('本机 QQ 一键登录未取得 ptsigx', {
      event: 'auth.local_qq_no_ptsigx',
      status: jumpRes.status,
    })
    return null
  }

  // 4) 原样跟随 check_sig 拿 p_skey（逐跳，直到出现 p_skey 或无重定向）
  let next: string | null = sigLocation
  for (let hop = 0; next && hop < MAX_SIG_HOPS; hop++) {
    const res: Response = await fetch(next, {
      headers: localHeaders(cookieString()),
      redirect: 'manual',
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    })
    absorbCookies(jar, res)
    if (jar.has('p_skey')) break
    next = res.headers.get('location') || null
  }

  if (!jar.get('p_skey')) {
    logger.warn('本机 QQ 一键登录未取得 p_skey', { event: 'auth.local_qq_no_pskey' })
    return null
  }

  // 5) 复用既有「会话 Cookie 登录」完成 musickey 兑换
  const credential = await loginWithSessionCookie(cookieString())
  if (!credential) return null

  logger.info('本机 QQ 一键登录成功', { event: 'auth.local_qq_succeeded', uin })
  return credential
}
