import type { MusicSource, PlatformDiagnostic, PlatformDiagnosticsReport } from '@music-together/shared'
import { AUTH_PROVIDERS } from './authProvider.js'
import * as authService from './authService.js'
import { logger } from '../utils/logger.js'

const PLATFORMS: MusicSource[] = ['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili']
const PROBE_TIMEOUT_MS = 8_000
const LABELS: Record<MusicSource, string> = {
  netease: '网易云',
  tencent: 'QQ 音乐',
  kugou: '酷狗',
  kugou_concept: '酷狗概念版',
  bilibili: 'Bilibili',
}

async function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function diagnoseOne(platform: MusicSource, identityUserId: string, roomId: string): Promise<PlatformDiagnostic> {
  const cookie = authService.getUserCookie(identityUserId, platform, roomId)
  if (!cookie) {
    return {
      platform,
      loggedIn: false,
      reachable: false,
      latencyMs: null,
      advice: '未登录：登录后可播放会员歌曲并使用平台推荐',
    }
  }

  const started = Date.now()
  try {
    const result = await withTimeout(AUTH_PROVIDERS[platform].getUserInfo(cookie))
    const latencyMs = Date.now() - started
    if (!result) {
      return {
        platform,
        loggedIn: true,
        reachable: false,
        latencyMs,
        code: 'timeout',
        advice: '平台在 8 秒内没有响应，请检查服务器网络或稍后重试',
      }
    }
    if (!result.ok) {
      return {
        platform,
        loggedIn: true,
        reachable: result.reason === 'expired',
        latencyMs,
        code: result.reason,
        advice: result.reason === 'expired' ? '登录已失效，请重新扫码登录' : '平台暂时不可用，请稍后重试',
      }
    }
    const vipType = result.data.vipType
    return {
      platform,
      loggedIn: true,
      reachable: true,
      latencyMs,
      vipType,
      vipLabel: result.data.vipLabel,
      code: 'ok',
      message: result.data.nickname,
      advice: vipType > 0 ? '账号在线，会员权益可用' : '账号在线；普通账号可能无法播放会员歌曲',
    }
  } catch (error) {
    logger.warn('平台诊断请求失败', { platform, error })
    return {
      platform,
      loggedIn: true,
      reachable: false,
      latencyMs: Date.now() - started,
      code: 'error',
      advice: '诊断请求异常，请稍后重试',
    }
  }
}

/** 并行探测各平台账号状态；报告只含可用性与会员等级，绝不含凭据。 */
export async function buildPlatformDiagnostics(
  identityUserId: string,
  roomId: string,
): Promise<PlatformDiagnosticsReport> {
  const platforms = await Promise.all(PLATFORMS.map((platform) => diagnoseOne(platform, identityUserId, roomId)))
  const generatedAt = Date.now()
  const lines = [
    'Music Together 平台诊断',
    `时间: ${new Date(generatedAt).toISOString()}`,
    ...platforms.map((item) => {
      const state = item.loggedIn ? (item.reachable ? '已登录/可达' : '已登录/不可达') : '未登录'
      const vip = item.vipLabel ?? (item.vipType ? `VIP${item.vipType}` : '-')
      const latency = item.latencyMs == null ? '-' : `${item.latencyMs}ms`
      return `${LABELS[item.platform]}: ${state} | ${latency} | ${vip} | ${item.advice}`
    }),
    '说明: 本报告不包含 cookie、token 或账号密码。',
  ]
  return { generatedAt, platforms, report: lines.join('\n') }
}
