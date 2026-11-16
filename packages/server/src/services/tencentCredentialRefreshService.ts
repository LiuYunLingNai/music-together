import pLimit from 'p-limit'
import type { MusicSource } from '@music-together/shared'
import { platformAuthRepo } from '../repositories/platformAuthRepository.js'
import { logger } from '../utils/logger.js'
import * as authService from './authService.js'
import * as tencentAuth from './tencentAuthService.js'
import * as neteaseAuth from './neteaseAuthService.js'

/**
 * 平台账号自动续期。
 *
 * - QQ 音乐：用 login_refresh 轮换播放凭证；
 * - 网易云：用 login_refresh 换取新的 MUSIC_U；
 * - 其他平台没有可靠的公开续期协议，交给 getUserInfo 判定过期并提示重新登录。
 *
 * 失败时保留旧凭证，调用前先写尝试时间，进程重启不会被失败任务反复打满。
 */

export const CREDENTIAL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000
export const TENCENT_CREDENTIAL_REFRESH_INTERVAL_MS = CREDENTIAL_REFRESH_INTERVAL_MS
const CREDENTIAL_SCAN_INTERVAL_MS = 5 * 60 * 1_000
const REFRESH_CONCURRENCY = 2

export interface CredentialRefreshSummary {
  checked: number
  refreshed: number
  failed: number
  skipped: number
}

export type TencentCredentialRefreshSummary = CredentialRefreshSummary
export type CredentialRefresher = (cookie: string) => Promise<string>
export type TencentCredentialRefresher = CredentialRefresher

interface ProviderRefreshConfig {
  platform: MusicSource
  label: string
  isRefreshable: (cookie: string) => boolean
  refresh: CredentialRefresher
}

const PROVIDERS: ProviderRefreshConfig[] = [
  {
    platform: 'tencent',
    label: 'QQ 音乐',
    isRefreshable: tencentAuth.isRefreshableCredential,
    refresh: tencentAuth.refreshCredential,
  },
  {
    platform: 'netease',
    label: '网易云音乐',
    isRefreshable: neteaseAuth.isRefreshableCredential,
    refresh: neteaseAuth.refreshCredential,
  },
]

async function refreshDueProvider(
  config: ProviderRefreshConfig,
  now: number,
  refresh: CredentialRefresher = config.refresh,
): Promise<CredentialRefreshSummary> {
  const due = platformAuthRepo.loadDue(config.platform, now - CREDENTIAL_REFRESH_INTERVAL_MS)
  const summary: CredentialRefreshSummary = { checked: due.length, refreshed: 0, failed: 0, skipped: 0 }
  const limit = pLimit(REFRESH_CONCURRENCY)

  await Promise.all(
    due
      .map((entry) => ({
        entry,
        authorizationVersion: authService.getAuthorizationVersion(entry.userId, config.platform),
      }))
      .map(({ entry, authorizationVersion }) =>
        limit(async () => {
          if (authService.getAuthorizationVersion(entry.userId, config.platform) !== authorizationVersion) {
            summary.skipped++
            return
          }
          // Persist the attempt before the network call so a restart cannot make
          // a failing credential retry continuously.
          platformAuthRepo.markCredentialRefreshAttempt(entry.userId, config.platform, now)

          if (!config.isRefreshable(entry.cookie)) {
            summary.skipped++
            logger.warn(`${config.label}凭证缺少刷新字段，已跳过自动续期并等待用户重新登录`, {
              event: 'auth.credential_refresh_skipped',
              platform: config.platform,
              userId: entry.userId,
            })
            return
          }

          try {
            const refreshedCookie = await refresh(entry.cookie)
            if (
              authService.getAuthorizationVersion(entry.userId, config.platform) !== authorizationVersion ||
              !authService.replaceCredentialCookie(
                entry.userId,
                config.platform,
                entry.cookie,
                refreshedCookie,
              )
            ) {
              summary.skipped++
              logger.info(`${config.label}凭证在续期期间已被替换，已丢弃旧刷新结果`, {
                event: 'auth.credential_refresh_stale',
                platform: config.platform,
                userId: entry.userId,
              })
              return
            }

            summary.refreshed++
            logger.info(`${config.label}凭证已自动续期`, {
              event: 'auth.credential_refreshed',
              platform: config.platform,
              userId: entry.userId,
            })
          } catch (error) {
            summary.failed++
            logger.warn(`${config.label}凭证自动续期失败，已保留原凭证`, {
              event: 'auth.credential_refresh_failed',
              platform: config.platform,
              userId: entry.userId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }),
      ),
  )

  if (summary.checked > 0) {
    logger.info(`${config.label}凭证定时续期完成`, {
      event: 'auth.credential_refresh_completed',
      platform: config.platform,
      ...summary,
    })
  }
  return summary
}

export function refreshDueTencentCredentials(
  now = Date.now(),
  refresh: CredentialRefresher = tencentAuth.refreshCredential,
): Promise<CredentialRefreshSummary> {
  return refreshDueProvider(PROVIDERS[0]!, now, refresh)
}

export function refreshDueNeteaseCredentials(
  now = Date.now(),
  refresh: CredentialRefresher = neteaseAuth.refreshCredential,
): Promise<CredentialRefreshSummary> {
  return refreshDueProvider(PROVIDERS[1]!, now, refresh)
}

let scheduledRun: Promise<CredentialRefreshSummary[]> | null = null

function runScheduledRefresh(): Promise<CredentialRefreshSummary[]> {
  if (scheduledRun) return scheduledRun
  scheduledRun = Promise.all(PROVIDERS.map((config) => refreshDueProvider(config, Date.now()))).finally(() => {
    scheduledRun = null
  })
  return scheduledRun
}

export function startCredentialRefreshScheduler(): ReturnType<typeof setInterval> {
  void runScheduledRefresh()
  const timer = setInterval(() => void runScheduledRefresh(), CREDENTIAL_SCAN_INTERVAL_MS)
  timer.unref()
  return timer
}

export function stopCredentialRefreshScheduler(timer: ReturnType<typeof setInterval>): void {
  clearInterval(timer)
}
