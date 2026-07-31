import QRCode from 'qrcode'
import type { Playlist } from '@music-together/shared'
import type { GetUserInfoResult } from './authProvider.js'
import { logger } from '../utils/logger.js'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
const BILIBILI_REFERER = 'https://www.bilibili.com/'

interface BilibiliResponse<T> {
  code?: number
  message?: string
  data?: T
}

interface BilibiliQrData {
  url?: string
  qrcode_key?: string
  code?: number
  message?: string
}

interface BilibiliNavData {
  isLogin?: boolean
  mid?: number
  uname?: string
  vipStatus?: number
  vipType?: number
}

interface BilibiliFavoriteFolder {
  id?: number | string
  title?: string
  media_count?: number
  cover?: string
  intro?: string
  upper?: { name?: string }
}

export interface BilibiliFavoriteVideo {
  bvid: string
  title: string
  author: string
  duration: number
  cover: string
}

export type BilibiliRecommendedVideo = BilibiliFavoriteVideo

export function parseBilibiliMembership(
  vipStatus: number | undefined,
  providerVipType: number | undefined,
): { vipType: 0 | 1 | 2; vipLabel?: string } {
  if (!vipStatus) return { vipType: 0, vipLabel: undefined }
  const annual = providerVipType === 2
  return {
    vipType: annual ? 2 : 1,
    vipLabel: annual ? '年度大会员' : '大会员',
  }
}

function requestHeaders(cookie?: string): HeadersInit {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': USER_AGENT,
    Referer: BILIBILI_REFERER,
    ...(cookie ? { Cookie: cookie } : {}),
  }
}

function cookiePairsFromResponse(response: globalThis.Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
  return values
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter((value): value is string => Boolean(value?.includes('=')))
}

function mergeCookiePairs(pairs: string[]): string {
  const cookies = new Map<string, string>()
  for (const pair of pairs) {
    const index = pair.indexOf('=')
    if (index > 0) cookies.set(pair.slice(0, index), pair)
  }
  return [...cookies.values()].join('; ')
}

const BILIBILI_AUTH_COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']

function cookiePairsFromLoginUrl(loginUrl: string): string[] {
  const pairs: string[] = []
  const visited = new Set<string>()

  const visit = (value: string, depth: number) => {
    if (depth > 3 || visited.has(value)) return
    visited.add(value)
    try {
      const params = new URL(value).searchParams
      for (const name of BILIBILI_AUTH_COOKIE_NAMES) {
        const cookieValue = params.get(name)
        if (cookieValue) pairs.push(`${name}=${encodeURIComponent(cookieValue)}`)
      }
      // Some Bilibili responses place the completed login URL inside a
      // `gourl`/redirect parameter rather than directly in the outer URL.
      for (const [, parameterValue] of params) {
        const decoded = decodeURIComponent(parameterValue)
        if (/SESSDATA=|(?:https?:)?\/\//.test(decoded)) visit(decoded, depth + 1)
      }
    } catch {
      // A non-URL query value is not a nested login URL.
    }
  }

  visit(loginUrl, 0)
  return pairs
}

async function collectLoginCookies(loginUrl: string): Promise<string[]> {
  const cookiePairs = cookiePairsFromLoginUrl(loginUrl)
  let currentUrl = loginUrl

  // Bilibili sets the final SESSDATA/DedeUserID cookies during the redirect
  // chain after QR confirmation. Following it manually retains every header.
  for (let redirectCount = 0; redirectCount < 6; redirectCount += 1) {
    const response = await fetch(currentUrl, { headers: requestHeaders(), redirect: 'manual' })
    cookiePairs.push(...cookiePairsFromResponse(response))
    if (response.status < 300 || response.status >= 400) break

    const location = response.headers.get('location')
    if (!location) break
    const nextUrl = new URL(location, currentUrl)
    cookiePairs.push(...cookiePairsFromLoginUrl(nextUrl.toString()))
    if (nextUrl.protocol !== 'https:' || !/(^|\.)bilibili\.com$/.test(nextUrl.hostname)) break
    currentUrl = nextUrl.toString()
  }

  return cookiePairs
}

export async function generateQrCode(): Promise<{ key: string; qrimg: string } | null> {
  try {
    const response = await fetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json()) as BilibiliResponse<BilibiliQrData>
    const key = body.data?.qrcode_key
    const url = body.data?.url
    if (!response.ok || body.code !== 0 || !key || !url) return null

    return { key, qrimg: await QRCode.toDataURL(url, { margin: 1, width: 320 }) }
  } catch (err) {
    logger.error('Bilibili QR generation failed', err)
    return null
  }
}

export async function checkQrStatus(key: string): Promise<{ status: number; message: string; cookie?: string }> {
  try {
    const response = await fetch(
      `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`,
      { headers: requestHeaders(), signal: AbortSignal.timeout(10_000) },
    )
    const body = (await response.json()) as BilibiliResponse<BilibiliQrData>
    const status = body.data?.code

    if (!response.ok || typeof status !== 'number') return { status: 800, message: '检查扫码状态失败' }
    if (status === 0) {
      const redirectCookiePairs = body.data?.url ? await collectLoginCookies(body.data.url) : []
      const cookie = mergeCookiePairs([...cookiePairsFromResponse(response), ...redirectCookiePairs])
      if (cookie) {
        logger.debug('Bilibili QR credentials extracted', {
          cookieNames: cookie
            .split(/;\s*/)
            .map((pair) => pair.split('=', 1)[0])
            .filter(Boolean),
        })
      }
      return cookie
        ? { status: 803, message: '登录成功', cookie }
        : { status: 800, message: '登录成功但未获取到凭据，请重试' }
    }
    if (status === 86101) return { status: 801, message: '等待扫码' }
    if (status === 86090) return { status: 802, message: '已扫码，请在手机上确认' }
    if (status === 86038) return { status: 800, message: '二维码已过期，请重新获取' }
    return { status: 800, message: body.data?.message || body.message || '二维码状态异常' }
  } catch (err) {
    logger.error('Bilibili QR status check failed', err)
    return { status: 800, message: '检查扫码状态失败' }
  }
}

export async function getUserInfo(cookie: string): Promise<GetUserInfoResult> {
  try {
    const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: requestHeaders(cookie),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json()) as BilibiliResponse<BilibiliNavData>
    const user = body.data
    if (!response.ok || body.code !== 0 || !user?.isLogin || !user.mid) return { ok: false, reason: 'expired' }

    const membership = parseBilibiliMembership(user.vipStatus, user.vipType)
    return {
      ok: true,
      data: {
        nickname: user.uname || 'B站用户',
        ...membership,
        userId: user.mid,
      },
    }
  } catch (err) {
    logger.error('Bilibili getUserInfo failed', err)
    return { ok: false, reason: 'error' }
  }
}

export async function getUserPlaylists(cookie: string): Promise<Playlist[]> {
  try {
    const userInfo = await getUserInfo(cookie)
    if (!userInfo.ok) return []

    const response = await fetch(
      `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${userInfo.data.userId}`,
      { headers: requestHeaders(cookie), signal: AbortSignal.timeout(10_000) },
    )
    const body = (await response.json()) as BilibiliResponse<{ list?: BilibiliFavoriteFolder[] }>
    if (!response.ok || body.code !== 0 || !Array.isArray(body.data?.list)) return []

    return body.data.list.flatMap((folder) => {
      const id = String(folder.id ?? '')
      if (!id) return []
      return [
        {
          id,
          name: folder.title || '未命名收藏夹',
          cover: String(folder.cover || '').replace(/^http:\/\//, 'https://'),
          trackCount: Number(folder.media_count ?? 0),
          source: 'bilibili' as const,
          creator: folder.upper?.name || userInfo.data.nickname,
          description: folder.intro || '',
        },
      ]
    })
  } catch (err) {
    logger.error('Bilibili getUserPlaylists failed', err)
    return []
  }
}

export async function getFavoriteVideos(
  favoriteId: string,
  page: number,
  pageSize: number,
  cookie: string,
): Promise<{ videos: BilibiliFavoriteVideo[]; total: number }> {
  try {
    const params = new URLSearchParams({ media_id: favoriteId, pn: String(page), ps: String(pageSize) })
    const response = await fetch(`https://api.bilibili.com/x/v3/fav/resource/list?${params}`, {
      headers: requestHeaders(cookie),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await response.json()) as BilibiliResponse<{
      medias?: Record<string, unknown>[]
      info?: { media_count?: number }
    }>
    if (!response.ok || body.code !== 0) return { videos: [], total: 0 }

    const videos = (body.data?.medias ?? []).flatMap((media) => {
      const bvid = String(media.bvid ?? '').trim()
      if (!bvid) return []
      return [
        {
          bvid,
          title: String(media.title ?? '').trim() || '未知视频',
          author: String((media.upper as { name?: string } | undefined)?.name ?? 'Bilibili'),
          duration: Number(media.duration ?? 0),
          cover: String(media.cover ?? '').replace(/^http:\/\//, 'https://'),
        },
      ]
    })
    return { videos, total: Number(body.data?.info?.media_count ?? videos.length) }
  } catch (err) {
    logger.error('Bilibili getFavoriteVideos failed', err, { favoriteId, page })
    return { videos: [], total: 0 }
  }
}

export function parseBilibiliRecommendedVideos(value: unknown): BilibiliRecommendedVideo[] {
  if (!value || typeof value !== 'object') return []
  const data = value as Record<string, unknown>
  const items = Array.isArray(data.item) ? data.item : []

  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const video = item as Record<string, unknown>
    const bvid = String(video.bvid ?? '').trim()
    if (!bvid || (video.goto && video.goto !== 'av')) return []
    const owner = video.owner as { name?: unknown } | undefined
    return [
      {
        bvid,
        title: String(video.title ?? '').trim() || '未知视频',
        author: String(owner?.name ?? video.author ?? 'Bilibili'),
        duration: Number(video.duration ?? video.duraion ?? 0),
        cover: String(video.pic ?? video.cover ?? '')
          .replace(/^http:\/\//, 'https://')
          .replace(/^\/\//, 'https://'),
      },
    ]
  })
}

/** Fetch Bilibili's logged-in personalized homepage recommendation feed. */
export async function getRecommendedVideos(cookie: string, limit = 20): Promise<BilibiliRecommendedVideo[]> {
  const params = new URLSearchParams({
    fresh_type: '4',
    feed_version: 'V8',
    fresh_idx: '1',
    fresh_idx_1h: '1',
    brush: '1',
    homepage_ver: '1',
    ps: String(limit),
  })
  const response = await fetch(`https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?${params}`, {
    headers: requestHeaders(cookie),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await response.json()) as BilibiliResponse<Record<string, unknown>>
  if (!response.ok || body.code !== 0) {
    throw new Error(`Bilibili recommendation feed failed: ${body.code ?? response.status}`)
  }
  return parseBilibiliRecommendedVideos(body.data).slice(0, limit)
}
