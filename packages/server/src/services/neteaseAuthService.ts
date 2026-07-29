import ncmApi from '@neteasecloudmusicapienhanced/api'
import type { Playlist } from '@music-together/shared'
import type { GetUserInfoResult } from './authProvider.js'
import { logger } from '../utils/logger.js'

interface NeteaseVipInfoApi {
  vip_info_v2(params: { uid: number; cookie: string; timestamp: number }): Promise<{
    body?: { data?: Record<string, unknown> }
  }>
}

const NETEASE_VIP_LEVEL_NAMES: Record<number, string> = {
  1: '壹',
  2: '贰',
  3: '叁',
  4: '肆',
  5: '伍',
  6: '陆',
  7: '柒',
}

export function formatNeteaseVipLabel(vipType: number, vipLevel?: number): string | undefined {
  if (vipType <= 0) return undefined
  const tier = vipType >= 2 ? 'SVIP' : 'VIP'
  const level = vipLevel ? NETEASE_VIP_LEVEL_NAMES[vipLevel] : undefined
  return level ? `${tier}·${level}` : tier
}

export function parseNeteaseMembership(
  profileVipType: number,
  vipData: Record<string, unknown> | undefined,
  now = Date.now(),
): { vipType: 0 | 1 | 2; vipLabel?: string; vipLevel?: number } {
  const redplusValue = vipData?.redplus ?? vipData?.redPlus
  const redplus =
    redplusValue && typeof redplusValue === 'object' ? (redplusValue as Record<string, unknown>) : undefined
  const expireTime = Number(redplus?.expireTime ?? redplus?.expire_time ?? 0)
  const isSvip =
    Boolean(redplus) &&
    Number(redplus?.vipCode ?? redplus?.vip_code ?? 0) > 0 &&
    (expireTime > now || redplus?.isVip === true || Number(redplus?.vipStatus ?? 0) === 1)
  const rawVipLevel = Number(vipData?.redVipLevel ?? vipData?.red_vip_level ?? 0)
  const vipType = isSvip ? 2 : profileVipType > 0 ? 1 : 0
  const vipLevel = vipType > 0 && Number.isInteger(rawVipLevel) && rawVipLevel > 0 ? rawVipLevel : undefined

  return {
    vipType,
    vipLabel: formatNeteaseVipLabel(vipType, vipLevel),
    vipLevel,
  }
}

/**
 * 网易云音乐认证服务
 * 封装 @neteasecloudmusicapienhanced/api 实现 QR 登录和 Cookie 验证
 * 实现 AuthProvider 接口
 */

// ---------------------------------------------------------------------------
// QR Code 登录
// ---------------------------------------------------------------------------

/**
 * 生成网易云音乐扫码登录二维码
 */
export async function generateQrCode(): Promise<{ key: string; qrimg: string } | null> {
  try {
    const keyRes = await ncmApi.login_qr_key({ timestamp: Date.now() })
    const key = keyRes?.body?.data?.unikey
    if (!key) {
      logger.error('Netease QR: failed to get unikey', keyRes?.body)
      return null
    }

    const qrRes = await ncmApi.login_qr_create({ key, qrimg: true, timestamp: Date.now() })
    const qrimg = qrRes?.body?.data?.qrimg
    if (!qrimg) {
      logger.error('Netease QR: failed to generate QR image', qrRes?.body)
      return null
    }

    logger.info('网易云音乐登录二维码已生成')
    return { key, qrimg }
  } catch (err) {
    logger.error('Netease QR generation failed', err)
    return null
  }
}

/**
 * 检查网易云扫码状态
 * 状态码：800=过期, 801=等待扫码, 802=已扫码待确认, 803=登录成功
 */
export async function checkQrStatus(key: string): Promise<{
  status: number
  message: string
  cookie?: string
}> {
  try {
    const res = await ncmApi.login_qr_check({ key, timestamp: Date.now() })
    const code = res?.body?.code ?? 800
    const cookie = res?.body?.cookie

    const messages: Record<number, string> = {
      800: '二维码已过期，请重新获取',
      801: '等待扫码',
      802: '已扫码，等待确认',
      803: '登录成功',
    }

    return {
      status: code,
      message: messages[code] ?? `未知状态 (${code})`,
      cookie: code === 803 ? cookie : undefined,
    }
  } catch (err) {
    logger.error('Netease QR check failed', err)
    return { status: 800, message: '检查状态失败' }
  }
}

// ---------------------------------------------------------------------------
// Cookie 验证 & 用户信息
// ---------------------------------------------------------------------------

/**
 * 验证 Cookie 并获取用户信息
 * 区分「Cookie 已过期」和「临时故障」，以便调用方决定是否移除 Cookie
 */
export async function getUserInfo(cookie: string): Promise<GetUserInfoResult> {
  try {
    const res = await ncmApi.login_status({ cookie, timestamp: Date.now() })
    const profile = res?.body?.data?.profile

    if (!profile) {
      logger.warn('Netease cookie validation: no profile in response', { responseData: res?.body?.data })
      return { ok: false, reason: 'expired' }
    }

    const profileVipType = Number(profile.vipType ?? 0)
    let vipData: Record<string, unknown> | undefined
    try {
      const vipInfoApi = ncmApi as unknown as NeteaseVipInfoApi
      const vipRes = await vipInfoApi.vip_info_v2({ uid: Number(profile.userId ?? 0), cookie, timestamp: Date.now() })
      vipData = vipRes?.body?.data
    } catch (err) {
      // Membership detail failure must not invalidate an otherwise valid login.
      logger.warn('Netease SVIP status check failed', { err })
    }
    const { vipType, vipLabel, vipLevel } = parseNeteaseMembership(profileVipType, vipData)

    return {
      ok: true,
      data: {
        nickname: profile.nickname || 'Unknown',
        vipType,
        vipLabel,
        vipLevel,
        userId: profile.userId ?? 0,
      },
    }
  } catch (err) {
    logger.error('Netease getUserInfo failed (transient error)', err)
    return { ok: false, reason: 'error' }
  }
}

// ---------------------------------------------------------------------------
// 用户歌单
// ---------------------------------------------------------------------------

/**
 * 获取用户网易云歌单列表
 */
export async function getUserPlaylists(cookie: string): Promise<Playlist[]> {
  try {
    const result = await getUserInfo(cookie)
    if (!result.ok) {
      logger.warn(`Cannot fetch playlists: cookie ${result.reason}`)
      return []
    }

    const userInfo = result.data

    const res = await ncmApi.user_playlist({
      uid: userInfo.userId,
      limit: 50,
      offset: 0,
      cookie,
      timestamp: Date.now(),
    })

    const playlists = res?.body?.playlist
    if (!Array.isArray(playlists)) {
      logger.warn('Netease user_playlist: unexpected response', { code: res?.body?.code })
      return []
    }

    const mapped: Playlist[] = playlists.map((p) => ({
      id: String(p.id),
      name: String(p.name || ''),
      cover: String(p.coverImgUrl || ''),
      trackCount: Number(p.trackCount ?? 0),
      source: 'netease' as const,
      creator: String(p.creator?.nickname || ''),
      description: String(p.description || ''),
    }))

    logger.info(`已获取网易云用户“${userInfo.nickname}”的 ${mapped.length} 个歌单`, {
      platform: 'netease',
      nickname: userInfo.nickname,
      count: mapped.length,
    })
    return mapped
  } catch (err) {
    logger.error('Netease getUserPlaylists failed', err)
    return []
  }
}
