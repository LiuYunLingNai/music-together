import crypto from 'node:crypto'
import QRCode from 'qrcode'
import type { Playlist } from '@music-together/shared'
import type { GetUserInfoResult, UserInfoData } from './authProvider.js'
import { logger } from '../utils/logger.js'
import { parseCookieString } from '../utils/cookieUtils.js'
import { parseKugouRecommendedPlaylists } from './recommendationParsers.js'

/**
 * Kugou Music authentication service.
 * Self-contained implementation extracted from MakcRe/KuGouMusicApi.
 * Handles QR code login, status polling, user info, VIP, and playlists.
 */

// ---------------------------------------------------------------------------
// Constants (from KuGouMusicApi config)
// ---------------------------------------------------------------------------

const APPID = 1005
const SRCAPPID = 2919
const CLIENTVER = 20489
const CONCEPT_APPID = 3116
const CONCEPT_CLIENTVER = 11440

const WEB_SIGNATURE_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
const ANDROID_SIGNATURE_SALT = 'OIlwieks28dk2k092lksi2UIkp'
const CONCEPT_ANDROID_SIGNATURE_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA'

type KugouEdition = 'standard' | 'concept'

export function getKugouVipQueryParams(edition: KugouEdition): Record<string, string> {
  return edition === 'concept'
    ? { busi_type: 'concept', opt_product_types: 'dvip,qvip', product_type: 'svip' }
    : { busi_type: 'concept' }
}

function kugouEditionConfig(edition: KugouEdition) {
  return edition === 'concept'
    ? { appId: CONCEPT_APPID, clientVer: CONCEPT_CLIENTVER, signatureSalt: CONCEPT_ANDROID_SIGNATURE_SALT }
    : { appId: APPID, clientVer: CLIENTVER, signatureSalt: ANDROID_SIGNATURE_SALT }
}

const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/g
bjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+
UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE
5E221wf/4WLFxwAtRQIDAQAB
-----END PUBLIC KEY-----`

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function md5(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex')
}

function signatureWebParams(params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .map((key) => `${key}=${params[key]}`)
    .sort()
    .join('')
  return md5(`${WEB_SIGNATURE_SALT}${sorted}${WEB_SIGNATURE_SALT}`)
}

function signatureAndroidParams(
  params: Record<string, unknown>,
  data?: string,
  edition: KugouEdition = 'standard',
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => {
      const val = params[key]
      return `${key}=${typeof val === 'object' ? JSON.stringify(val) : val}`
    })
    .join('')
  const { signatureSalt } = kugouEditionConfig(edition)
  return md5(`${signatureSalt}${sorted}${data || ''}${signatureSalt}`)
}

function recommendationRequestKey(clienttime: number, edition: KugouEdition): string {
  const { appId, clientVer, signatureSalt } = kugouEditionConfig(edition)
  return md5(`${appId}${signatureSalt}${clientVer}${clienttime}`)
}

/**
 * RSA encrypt with NO_PADDING (required by Kugou user_detail API).
 * Input is padded to 128 bytes before encryption.
 */
function rsaEncrypt(data: string | Record<string, unknown>): string {
  const str = typeof data === 'object' ? JSON.stringify(data) : data
  const buffer = Buffer.from(str)
  const padded = Buffer.concat([buffer, Buffer.alloc(128 - buffer.length)])
  return crypto.publicEncrypt({ key: RSA_PUBLIC_KEY, padding: crypto.constants.RSA_NO_PADDING }, padded).toString('hex')
}

function randomString(len = 16): string {
  const chars = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let result = ''
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function getGuid(): string {
  const s = () => ((65536 * (1 + Math.random())) | 0).toString(16).substring(1)
  return `${s()}${s()}-${s()}-${s()}-${s()}-${s()}${s()}${s()}`
}

function calculateMid(str: string): string {
  let bigInt = BigInt(0)
  const base = BigInt(16)
  const digest = md5(str)
  const len = digest.length
  for (let i = 0; i < len; i++) {
    const charValue = BigInt(parseInt(digest.charAt(i), 16))
    const power = base ** BigInt(len - 1 - i)
    bigInt += charValue * power
  }
  return bigInt.toString()
}

const GUID = md5(getGuid())
const MID = calculateMid(GUID)

/**
 * Return the process-scoped device MID used by Kugou requests.
 * Playback requests must reuse the same device identity as login/auth calls;
 * generating a per-track MID causes Kugou's tracker API to reject valid VIP
 * credentials.
 */
export function getDeviceMid(): string {
  return MID
}

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

interface KugouRequestConfig {
  baseURL: string
  url: string
  method?: 'GET' | 'POST'
  params: Record<string, unknown>
  data?: Record<string, unknown>
  encryptType: 'web' | 'android'
  cookie?: Record<string, string>
  headers?: Record<string, string>
  edition?: KugouEdition
}

/** Kugou API response (loosely typed — external API). */
interface KugouApiResponse {
  status?: number
  error_code?: number
  data?: Record<string, unknown>
  [key: string]: unknown
}

async function kugouRequest(config: KugouRequestConfig): Promise<KugouApiResponse> {
  const edition = config.edition ?? 'standard'
  const editionConfig = kugouEditionConfig(edition)
  const clienttime = Math.floor(Date.now() / 1000)
  const dfid = config.cookie?.dfid || '-'
  const method = config.method || 'GET'

  const defaultParams: Record<string, unknown> = {
    dfid,
    mid: MID,
    uuid: '-',
    appid: editionConfig.appId,
    clientver: editionConfig.clientVer,
    clienttime,
  }

  if (config.cookie?.token) defaultParams['token'] = config.cookie.token
  if (config.cookie?.userid && config.cookie.userid !== '0') {
    defaultParams['userid'] = config.cookie.userid
  }

  const merged = { ...defaultParams, ...config.params }

  // Stringify POST body (needed for Android signature)
  const bodyStr = config.data ? JSON.stringify(config.data) : ''

  // Compute signature
  if (config.encryptType === 'web') {
    merged['signature'] = signatureWebParams(merged)
  } else {
    merged['signature'] = signatureAndroidParams(merged, bodyStr, edition)
  }

  const qs = Object.entries(merged)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')

  const fullUrl = `${config.baseURL}${config.url}?${qs}`

  const headers: Record<string, string> = {
    'User-Agent':
      edition === 'concept'
        ? 'Android16-1070-11440-130-0-LOGIN-wifi'
        : 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
    dfid,
    clienttime: String(clienttime),
    mid: MID,
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    ...config.headers,
  }

  const fetchOpts: RequestInit = { method, headers }
  if (method === 'POST' && bodyStr) {
    headers['Content-Type'] = 'application/json'
    fetchOpts.body = bodyStr
  }

  const res = await fetch(fullUrl, fetchOpts)

  if (!res.ok) {
    throw new Error(`Kugou API HTTP ${res.status} ${res.statusText}: ${config.url}`)
  }

  let body: KugouApiResponse
  try {
    body = (await res.json()) as KugouApiResponse
  } catch {
    throw new Error(`Kugou API JSON parse failed: ${config.url} (HTTP ${res.status})`)
  }

  return body
}

export function parseKugouRecommendationSongs(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    const songs = value.filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const song = item as Record<string, unknown>
      const audioInfo = song.audio_info as Record<string, unknown> | undefined
      return Boolean(song.hash || song.audio_id || audioInfo?.hash)
    })
    if (songs.length > 0) return songs
    for (const item of value) {
      const nested = parseKugouRecommendationSongs(item)
      if (nested.length > 0) return nested
    }
    return []
  }

  const record = value as Record<string, unknown>
  for (const key of ['song_list', 'songs', 'info', 'list', 'recommend_list', 'data']) {
    const nested = parseKugouRecommendationSongs(record[key])
    if (nested.length > 0) return nested
  }
  return []
}

/**
 * The special recommendation feed sometimes omits songcount or returns zero
 * even though the collection is playable. Resolve a small first page through
 * the native detail endpoint so cards can show a useful count. If the detail
 * endpoint still cannot provide one, keep the playable collection with zero
 * so the client can hide only the unavailable count.
 */
async function hydrateRecommendedPlaylistCounts(
  playlists: Playlist[],
  cookie: string,
  edition: KugouEdition,
): Promise<Playlist[]> {
  const candidates = playlists.slice(0, 20)
  if (candidates.length === 0) return []

  const hydrated = [...candidates]
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const index = nextIndex++
      const playlist = candidates[index]
      if (!playlist) return

      if (playlist.trackCount > 0) continue

      const result =
        edition === 'concept'
          ? await getConceptPlaylistTracks(playlist.id, 1, 1, cookie)
          : await getPlaylistTracks(playlist.id, 1, 1, cookie)
      if (result.total > 0) hydrated[index] = { ...playlist, trackCount: result.total }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker()))
  return hydrated
}

async function getRecommendedPlaylistsForEdition(
  cookie: string,
  limit = 20,
  edition: KugouEdition = 'standard',
): Promise<Playlist[]> {
  const cookieObj = parseCookieString(cookie)
  const clienttime = Math.floor(Date.now() / 1000)
  const size = Math.max(1, Math.min(50, Math.floor(limit)))
  const { appId, clientVer } = kugouEditionConfig(edition)
  const source = edition === 'concept' ? 'kugou_concept' : 'kugou'

  const body = await kugouRequest({
    baseURL: 'https://gateway.kugou.com',
    url: '/v2/special_recommend',
    method: 'POST',
    params: { clienttime },
    data: {
      appid: appId,
      mid: MID,
      clientver: clientVer,
      platform: 'android',
      clienttime,
      userid: cookieObj.userid || 0,
      module_id: 1,
      page: 1,
      pagesize: size,
      key: recommendationRequestKey(clienttime, edition),
      special_recommend: {
        withtag: 1,
        withsong: 1,
        sort: 1,
        ugc: 1,
        is_selected: 0,
        withrecommend: 1,
        area_code: 1,
        categoryid: 0,
      },
      req_multi: 1,
      retrun_min: 5,
      return_special_falg: 1,
    },
    encryptType: 'android',
    cookie: cookieObj,
    headers: { 'x-router': 'specialrec.service.kugou.com' },
    edition,
  })

  if (body.status !== undefined && Number(body.status) !== 1) {
    throw new Error(`Kugou recommendation playlists returned status ${body.status}`)
  }
  if (body.error_code !== undefined && Number(body.error_code) !== 0) {
    throw new Error(`Kugou recommendation playlists returned error ${body.error_code}`)
  }
  const playlists = parseKugouRecommendedPlaylists(body, source).slice(0, size)
  return hydrateRecommendedPlaylistCounts(playlists, cookie, edition)
}

export async function getRecommendedPlaylists(cookie: string, limit = 20): Promise<Playlist[]> {
  return getRecommendedPlaylistsForEdition(cookie, limit)
}

export async function getConceptRecommendedPlaylists(cookie: string, limit = 20): Promise<Playlist[]> {
  return getRecommendedPlaylistsForEdition(cookie, limit, 'concept')
}

async function getRecommendationSongsForEdition(
  cookie: string,
  limit = 20,
  edition: KugouEdition = 'standard',
): Promise<Record<string, unknown>[]> {
  const cookieObj = parseCookieString(cookie)
  const body = await kugouRequest({
    baseURL: 'https://gateway.kugou.com',
    url: '/everyday_song_recommend',
    method: 'POST',
    params: {},
    data: {
      platform: 'android',
      userid: cookieObj.userid || '0',
    },
    encryptType: 'android',
    cookie: cookieObj,
    headers: { 'x-router': 'everydayrec.service.kugou.com' },
    edition,
  })
  const songs = parseKugouRecommendationSongs(body.data)
  if (songs.length === 0) throw new Error('Kugou recommendation feed returned no songs')
  return songs.slice(0, limit)
}

export async function getRecommendationSongs(cookie: string, limit = 20): Promise<Record<string, unknown>[]> {
  return getRecommendationSongsForEdition(cookie, limit)
}

export async function getConceptRecommendationSongs(cookie: string, limit = 20): Promise<Record<string, unknown>[]> {
  return getRecommendationSongsForEdition(cookie, limit, 'concept')
}

function shuffleItems<T>(items: readonly T[]): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!]
  }
  return shuffled
}

/**
 * Build a Concept Edition roaming candidate pool. Daily recommendations are
 * always placed first; a random recommended-playlist page is appended so the
 * caller can continue after the daily pool has already been played.
 */
export async function getConceptRoamingSongs(cookie: string, limit = 50): Promise<Record<string, unknown>[]> {
  const poolSize = Math.max(1, Math.min(50, Math.floor(limit)))
  const dailyLimit = Math.max(1, Math.floor(poolSize / 2))
  let dailySongs: Record<string, unknown>[] = []

  try {
    dailySongs = await getConceptRecommendationSongs(cookie, dailyLimit)
  } catch (error) {
    logger.warn('Kugou Concept daily recommendation failed; trying recommended playlists', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const playlists = shuffleItems(await getConceptRecommendedPlaylists(cookie, 20))
    for (const playlist of playlists.slice(0, 5)) {
      const pageSize = Math.max(1, poolSize - dailySongs.length)
      const pageCount = Math.max(1, Math.ceil(playlist.trackCount / pageSize))
      const page = Math.floor(Math.random() * pageCount) + 1
      const result = await getConceptPlaylistTracks(playlist.id, page, pageSize, cookie)
      if (result.songs.length > 0) return [...dailySongs, ...result.songs].slice(0, poolSize)
    }
  } catch (error) {
    logger.warn('Kugou Concept recommended-playlist roaming failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return dailySongs.length > 0 ? dailySongs : getConceptRecommendationSongs(cookie, poolSize)
}

// ---------------------------------------------------------------------------
// QR Code Login
// ---------------------------------------------------------------------------

async function generateQrCodeForEdition(edition: KugouEdition): Promise<{ key: string; qrimg: string } | null> {
  try {
    const { appId } = kugouEditionConfig(edition)
    const body = await kugouRequest({
      baseURL: 'https://login-user.kugou.com',
      url: '/v2/qrcode',
      params: {
        // KuGou's QR-key endpoint expects the shared mobile client ID while
        // the QR payload and subsequent poll identify the target edition.
        appid: edition === 'concept' ? 1001 : APPID,
        type: 1,
        plat: 4,
        qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${appId}&`,
        srcappid: SRCAPPID,
      },
      encryptType: 'web',
      edition,
    })

    const qrData = body?.data as Record<string, unknown> | undefined
    const key = qrData?.qrcode as string | undefined
    if (!key) {
      logger.error('Kugou QR: failed to get qrcode key', body)
      return null
    }

    const qrUrl = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${key}`
    const qrimg = await QRCode.toDataURL(qrUrl, { width: 280, margin: 2 })

    logger.info('酷狗音乐登录二维码已生成')
    return { key, qrimg }
  } catch (err) {
    logger.error('Kugou QR generation failed', err)
    return null
  }
}

export async function generateQrCode(): Promise<{ key: string; qrimg: string } | null> {
  return generateQrCodeForEdition('standard')
}

const STATUS_MAP: Record<number, number> = {
  0: 800,
  1: 801,
  2: 802,
  4: 803,
}

const STATUS_MESSAGES: Record<number, string> = {
  800: '二维码已过期，请重新获取',
  801: '等待扫码',
  802: '已扫码，等待确认',
  803: '登录成功',
}

async function checkQrStatusForEdition(
  key: string,
  edition: KugouEdition,
): Promise<{
  status: number
  message: string
  cookie?: string
}> {
  try {
    const body = await kugouRequest({
      baseURL: 'https://login-user.kugou.com',
      url: '/v2/get_userinfo_qrcode',
      params: {
        plat: 4,
        appid: kugouEditionConfig(edition).appId,
        srcappid: SRCAPPID,
        qrcode: key,
      },
      encryptType: 'web',
      edition,
    })

    const d = body?.data as Record<string, unknown> | undefined
    const rawStatus = Number(d?.status ?? 0)
    const status = STATUS_MAP[rawStatus] ?? 800
    const message = STATUS_MESSAGES[status] ?? `未知状态 (${rawStatus})`

    if (status === 803 && d?.token && d?.userid) {
      const token = String(d.token)
      const userid = String(d.userid)
      const cookie = `token=${token};userid=${userid}`
      return { status, message, cookie }
    }

    return { status, message }
  } catch (err) {
    logger.error('Kugou QR check failed', err)
    return { status: 800, message: '检查状态失败' }
  }
}

export async function checkQrStatus(key: string): Promise<{ status: number; message: string; cookie?: string }> {
  return checkQrStatusForEdition(key, 'standard')
}

// ---------------------------------------------------------------------------
// User Detail (nickname via RSA-encrypted request)
// ---------------------------------------------------------------------------

/**
 * Fetch user nickname from Kugou's user center API.
 * Requires RSA-encrypted auth payload.
 */
async function fetchUserDetail(cookie: Record<string, string>, edition: KugouEdition): Promise<{ nickname: string | null; avatarUrl?: string }> {
  try {
    const token = cookie['token']
    const userid = Number(cookie['userid'] || '0')
    if (!token || !userid) return { nickname: null }

    const clienttime = Math.floor(Date.now() / 1000)
    const pk = rsaEncrypt({ token, clienttime }).toUpperCase()

    const body = await kugouRequest({
      baseURL: 'https://gateway.kugou.com',
      url: '/v3/get_my_info',
      method: 'POST',
      params: { plat: 1 },
      data: {
        visit_time: clienttime,
        usertype: 1,
        p: pk,
        userid,
      },
      encryptType: 'android',
      cookie,
      headers: { 'x-router': 'usercenter.kugou.com' },
      edition,
    })

    const d = body?.data as Record<string, unknown> | undefined
    const nickname = String(d?.nick_name || d?.nickname || d?.userName || '')
    const avatarUrl = d?.pic ? String(d.pic).replace(/^http:\/\//, 'https://') : undefined
    if (nickname) {
      logger.debug('已获取酷狗用户资料', { nickname })
    } else {
      logger.warn('Kugou user detail: no nickname found in response', { keys: Object.keys(d || {}) })
    }
    return { nickname: nickname || null, avatarUrl }
  } catch (err) {
    logger.warn('Kugou fetchUserDetail failed (non-critical)', err as Record<string, unknown>)
    return { nickname: null }
  }
}

// ---------------------------------------------------------------------------
// User Info & VIP
// ---------------------------------------------------------------------------

// UserInfoData 和 GetUserInfoResult 从 authProvider.ts 统一导入

export function formatKugouVipLabel(vipType: number, vipLevel?: number): string | undefined {
  if (vipType <= 0) return undefined
  const tier = vipType >= 2 ? 'SVIP' : 'VIP'
  return vipLevel ? `${tier}·Lv${vipLevel}` : tier
}

function parseKugouExpiry(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!text) return 0
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}+08:00`)
  }
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function hasActiveKugouExpiry(data: Record<string, unknown>, fields: string[], now: number): boolean {
  return fields.some((field) => parseKugouExpiry(data[field]) > now)
}

export function parseKugouMembership(
  vipData: Record<string, unknown>,
  includeBusinessMemberships = true,
  now = Date.now(),
): {
  vipType: 0 | 1 | 2
  vipLabel?: string
  vipLevel?: number
} {
  const nestedVipInfo =
    vipData.vipinfo && typeof vipData.vipinfo === 'object'
      ? (vipData.vipinfo as Record<string, unknown>)
      : vipData.vip_info && typeof vipData.vip_info === 'object'
        ? (vipData.vip_info as Record<string, unknown>)
        : {}
  const membershipSources = [nestedVipInfo, vipData]
  const businessMemberships = includeBusinessMemberships
    ? membershipSources.flatMap((source) =>
        Array.isArray(source.busi_vip)
          ? source.busi_vip.filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === 'object' && Number((item as Record<string, unknown>).is_vip) === 1,
            )
          : [],
      )
    : []
  const hasBusinessVip = businessMemberships.length > 0
  const hasPaidBusinessSvip = businessMemberships.some(
    (item) =>
      String(item.product_type ?? '').toLowerCase() === 'svip' &&
      (Number(item.is_paid_vip) === 1 || Number(item.purchased_type) > 0 || Number(item.purchased_ios_type) > 0),
  )
  const hasRegularVipExpiry = membershipSources.some((source) =>
    hasActiveKugouExpiry(source, ['vip_end_time', 'vip_y_endtime', 'm_end_time', 'm_y_endtime', 'vip_clearday'], now),
  )
  const hasSvipExpiry = membershipSources.some((source) =>
    hasActiveKugouExpiry(source, ['su_vip_end_time', 'su_vip_y_endtime', 'su_vip_clearday'], now),
  )
  const hasProviderVip = membershipSources.some((source) => Number(source.is_vip) === 1) || hasRegularVipExpiry
  const isVip = hasProviderVip || hasBusinessVip
  const isSvip =
    membershipSources.some(
      (source) => Number(source.is_svip) === 1 || Number(source.svip_type) > 0 || Number(source.super_vip_type) > 0,
    ) ||
    hasSvipExpiry ||
    hasPaidBusinessSvip
  const vipType = isSvip ? 2 : isVip ? 1 : 0
  const rawVipLevel =
    membershipSources
      .map((source) => Number(source.vip_level ?? source.svip_level ?? source.level ?? 0))
      .find((level) => Number.isInteger(level) && level > 0) ?? 0
  const vipLevel = vipType > 0 && Number.isInteger(rawVipLevel) && rawVipLevel > 0 ? rawVipLevel : undefined
  const vipLabel =
    hasBusinessVip && !hasProviderVip && !hasPaidBusinessSvip ? '畅听VIP' : formatKugouVipLabel(vipType, vipLevel)
  return { vipType, vipLabel, vipLevel }
}

export function getKugouMembershipResponseData(body: KugouApiResponse): Record<string, unknown> | null {
  const data = body?.data
  if (
    body?.status === 0 ||
    (typeof body?.error_code === 'number' && body.error_code !== 0) ||
    !data ||
    typeof data !== 'object' ||
    data.errmsg ||
    data.error_msg
  ) {
    return null
  }
  return data
}

export function isKugouInvalidParamsResponse(body: KugouApiResponse): boolean {
  const data = body?.data
  const message = String(
    body?.message ?? body?.error_msg ?? (data && typeof data === 'object' ? (data.errmsg ?? data.error_msg) : '') ?? '',
  ).toLowerCase()
  return Number(body?.error_code) === 20017 || message.includes('params invalid')
}

export function getKugouMembershipRequestEditions(edition: KugouEdition): KugouEdition[] {
  return edition === 'concept' ? ['concept', 'standard'] : ['standard', 'concept']
}

/**
 * Validate a Kugou cookie (token+userid) and get VIP info + nickname.
 */
async function getUserInfoForEdition(cookie: string, edition: KugouEdition): Promise<GetUserInfoResult> {
  // 使用共享的 parseCookieString（已从 cookieUtils 导入）
  try {
    const cookieObj = parseCookieString(cookie)
    const token = cookieObj['token']
    const userid = cookieObj['userid']

    if (!token || !userid) {
      logger.warn('Kugou getUserInfo: missing token or userid in cookie')
      return { ok: false, reason: 'expired' }
    }

    // Fetch VIP info
    let body: KugouApiResponse | null = null
    let vipData: Record<string, unknown> | null = null
    for (const requestEdition of getKugouMembershipRequestEditions(edition)) {
      body = await kugouRequest({
        baseURL: 'https://kugouvip.kugou.com',
        url: '/v1/get_union_vip',
        params: getKugouVipQueryParams(edition),
        encryptType: 'android',
        cookie: { token, userid },
        edition: requestEdition,
      })
      vipData = getKugouMembershipResponseData(body)
      if (vipData || !isKugouInvalidParamsResponse(body)) break
      logger.info('Kugou membership request did not match the credential edition; retrying', {
        accountEdition: edition,
        requestEdition,
      })
    }

    if (!vipData) {
      logger.warn('Kugou getUserInfo: invalid VIP response', {
        edition,
        status: body?.status,
        errorCode: body?.error_code,
        message: body?.message ?? body?.error_msg,
        dataMessage:
          body?.data && typeof body.data === 'object' ? (body.data.errmsg ?? body.data.error_msg) : undefined,
      })
      return { ok: false, reason: 'error' }
    }

    const membership = parseKugouMembership(vipData, edition === 'concept')

    // Fetch nickname and avatar (non-blocking — fallback to userid if failed)
    const detail = await fetchUserDetail({ token, userid }, edition)

    return {
      ok: true,
      data: {
        nickname: detail.nickname || `酷狗用户${userid}`,
        avatarUrl: detail.avatarUrl,
        ...membership,
        userId: Number(userid),
      },
    }
  } catch (err) {
    logger.error('Kugou getUserInfo failed (transient error)', err)
    return { ok: false, reason: 'error' }
  }
}

export async function getUserInfo(cookie: string): Promise<GetUserInfoResult> {
  return getUserInfoForEdition(cookie, 'standard')
}

// ---------------------------------------------------------------------------
// User Playlists
// ---------------------------------------------------------------------------

/**
 * Fetch user's playlist list from Kugou.
 */
async function getUserPlaylistsForEdition(cookie: string, edition: KugouEdition): Promise<Playlist[]> {
  try {
    const cookieObj = parseCookieString(cookie)
    const token = cookieObj['token']
    const userid = cookieObj['userid']

    if (!token || !userid) {
      logger.warn('Kugou getUserPlaylists: missing token or userid')
      return []
    }

    const body = await kugouRequest({
      baseURL: 'https://gateway.kugou.com',
      url: '/v7/get_all_list',
      method: 'POST',
      params: { plat: 1, userid: Number(userid), token },
      data: {
        userid: Number(userid),
        token,
        total_ver: 979,
        type: 2,
        page: 1,
        pagesize: 100,
      },
      encryptType: 'android',
      cookie: { token, userid },
      headers: { 'x-router': 'cloudlist.service.kugou.com' },
      edition,
    })

    const d = body?.data as Record<string, unknown> | undefined
    const lists = d?.info
    if (!Array.isArray(lists)) {
      logger.warn('Kugou getUserPlaylists: unexpected response', { keys: Object.keys(d || {}) })
      return []
    }

    const mapped: Playlist[] = lists.map((p: Record<string, unknown>) => ({
      id: String(p.global_collection_id || p.listid || p.dirid || ''),
      name: String(p.name || ''),
      cover: String(p.pic || p.img || ''),
      trackCount: Number(p.count ?? p.total ?? 0),
      source: edition === 'concept' ? 'kugou_concept' : 'kugou',
    }))

    logger.info(`已获取酷狗用户的 ${mapped.length} 个歌单`, { platform: 'kugou', userId: userid, count: mapped.length })
    return mapped
  } catch (err) {
    logger.error('Kugou getUserPlaylists failed', err)
    return []
  }
}

export async function getUserPlaylists(cookie: string): Promise<Playlist[]> {
  return getUserPlaylistsForEdition(cookie, 'standard')
}

export const conceptAuthProvider = {
  generateQrCode: () => generateQrCodeForEdition('concept'),
  checkQrStatus: (key: string) => checkQrStatusForEdition(key, 'concept'),
  getUserInfo: (cookie: string) => getUserInfoForEdition(cookie, 'concept'),
  getUserPlaylists: (cookie: string) => getUserPlaylistsForEdition(cookie, 'concept'),
}

function shanghaiDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

/**
 * Manually claim the official daily Concept Edition listening benefit.
 * This deliberately does not call the reference project's simulated ad/listen
 * reporting endpoints: Kugou alone decides account eligibility and limits.
 */
export async function claimConceptDailyVip(cookie: string): Promise<{ ok: boolean; message: string }> {
  try {
    const cookieObj = parseCookieString(cookie)
    const token = cookieObj['token']
    const userid = cookieObj['userid']
    if (!token || !userid) return { ok: false, message: '概念版登录已失效，请重新登录' }

    const claim = await kugouRequest({
      baseURL: 'https://gateway.kugou.com',
      url: '/youth/v1/recharge/receive_vip_listen_song',
      method: 'POST',
      params: { source_id: 90139, receive_day: shanghaiDateKey() },
      encryptType: 'android',
      cookie: { token, userid },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      edition: 'concept',
    })

    if (claim.status !== 1) {
      return { ok: false, message: String(claim.message || claim.error_msg || '当前账号暂不符合领取条件') }
    }

    // Kugou's official flow upgrades the claimed daily listening benefit to
    // Concept Edition VIP. This is only reached after the user clicked the
    // manual claim button above; the platform still enforces its own limits.
    const upgrade = await kugouRequest({
      baseURL: 'https://gateway.kugou.com',
      url: '/youth/v1/listen_song/upgrade_vip_reward',
      method: 'POST',
      params: { kugouid: Number(userid), ad_type: 1 },
      encryptType: 'android',
      cookie: { token, userid },
      edition: 'concept',
    })

    if (upgrade.status === 1) return { ok: true, message: '已领取并升级今日概念版 VIP 权益' }
    return {
      ok: false,
      message: String(upgrade.message || upgrade.error_msg || '今日权益已领取，但升级畅听 VIP 失败'),
    }
  } catch (err) {
    logger.error('Kugou Concept daily VIP claim failed', err)
    return { ok: false, message: '领取失败，请稍后重试或前往酷狗客户端领取' }
  }
}

// ---------------------------------------------------------------------------
// Playlist Tracks (via global_collection_id)
// ---------------------------------------------------------------------------

export interface KugouPlaylistTrack {
  hash: string
  filename: string
  album_name?: string
  duration?: number
  privilege?: number
  [key: string]: unknown
}

/**
 * Fetch tracks from a kugou user playlist by global_collection_id.
 * Paginated — pass page (1-based) and pagesize.
 * Returns raw song objects for musicProvider to convert.
 */
async function getPlaylistTracksForEdition(
  playlistId: string,
  page = 1,
  pagesize = 300,
  cookie?: string | null,
  edition: KugouEdition = 'standard',
): Promise<{ songs: KugouPlaylistTrack[]; total: number }> {
  try {
    const cookieObj = cookie ? parseCookieString(cookie) : {}

    const body = await kugouRequest({
      baseURL: 'https://gateway.kugou.com',
      url: '/pubsongs/v2/get_other_list_file_nofilt',
      method: 'GET',
      params: {
        area_code: 1,
        begin_idx: (page - 1) * pagesize,
        plat: 1,
        type: 1,
        mode: 1,
        personal_switch: 1,
        extend_fields: 'abtags,hot_cmt,popularization',
        pagesize,
        global_collection_id: playlistId,
      },
      encryptType: 'android',
      cookie: cookieObj,
      edition,
    })

    const d = body?.data as Record<string, unknown> | undefined
    const songs = (d?.songs ?? d?.info) as KugouPlaylistTrack[] | undefined
    const total = Number(d?.count ?? d?.total ?? 0)

    if (!Array.isArray(songs) || songs.length === 0) {
      logger.warn('Kugou getPlaylistTracks: no songs found', {
        playlistId,
        total,
        keys: Object.keys(d || {}),
      })
      return { songs: [], total }
    }

    return { songs, total }
  } catch (err) {
    logger.error('Kugou getPlaylistTracks failed', err)
    return { songs: [], total: 0 }
  }
}

export async function getPlaylistTracks(
  playlistId: string,
  page = 1,
  pagesize = 300,
  cookie?: string | null,
): Promise<{ songs: KugouPlaylistTrack[]; total: number }> {
  return getPlaylistTracksForEdition(playlistId, page, pagesize, cookie)
}

export async function getConceptPlaylistTracks(
  playlistId: string,
  page = 1,
  pagesize = 300,
  cookie?: string | null,
): Promise<{ songs: KugouPlaylistTrack[]; total: number }> {
  return getPlaylistTracksForEdition(playlistId, page, pagesize, cookie, 'concept')
}

// parseCookieString 已移至 utils/cookieUtils.ts 统一管理
