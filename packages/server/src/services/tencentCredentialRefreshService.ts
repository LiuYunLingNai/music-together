import pLimit from 'p-limit'
import { platformAuthRepo } from '../repositories/platformAuthRepository.js'
import { logger } from '../utils/logger.js'
import * as authService from './authService.js'
import * as tencentAuth from './tencentAuthService.js'

export const TENCENT_CREDENTIAL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000
const TENCENT_CREDENTIAL_SCAN_INTERVAL_MS = 5 * 60 * 1_000
const REFRESH_CONCURRENCY = 2

export interface TencentCredentialRefreshSummary {
  checked: number
  refreshed: number
  failed: number
  skipped: number
}

export type TencentCredentialRefresher = (cookie: string) => Promise<string>

export async function refreshDueTencentCredentials(
  now = Date.now(),
  refresh: TencentCredentialRefresher = tencentAuth.refreshCredential,
): Promise<TencentCredentialRefreshSummary> {
  const due = platformAuthRepo.loadDueTencent(now - TENCENT_CREDENTIAL_REFRESH_INTERVAL_MS)
  const summary: TencentCredentialRefreshSummary = { checked: due.length, refreshed: 0, failed: 0, skipped: 0 }
  const limit = pLimit(REFRESH_CONCURRENCY)

  await Promise.all(
    due.map((entry) =>
      limit(async () => {
        // Persist the attempt before the network call so a restart cannot make
        // a failing credential retry continuously.
        platformAuthRepo.markCredentialRefreshAttempt(entry.userId, 'tencent', now)

        if (!tencentAuth.isRefreshableCredential(entry.cookie)) {
          summary.skipped++
          logger.warn('QQ 音乐凭证缺少刷新字段，已跳过自动刷新并等待用户重新扫码', {
            event: 'auth.tencent_credential_refresh_skipped',
            userId: entry.userId,
          })
          return
        }

        try {
          const refreshedCookie = await refresh(entry.cookie)
          if (!tencentAuth.isRefreshableCredential(refreshedCookie)) {
            throw new Error('刷新响应未包含可用的 refresh_token 或 refresh_key')
          }
          if (!authService.replaceCredentialCookie(entry.userId, 'tencent', entry.cookie, refreshedCookie)) {
            summary.skipped++
            logger.info('QQ 音乐凭证在刷新期间已被替换，已丢弃旧刷新结果', {
              event: 'auth.tencent_credential_refresh_stale',
              userId: entry.userId,
            })
            return
          }

          summary.refreshed++
          logger.info('QQ 音乐播放凭证已自动刷新', {
            event: 'auth.tencent_credential_refreshed',
            userId: entry.userId,
          })
        } catch (error) {
          summary.failed++
          logger.warn('QQ 音乐播放凭证自动刷新失败，已保留原凭证', {
            event: 'auth.tencent_credential_refresh_failed',
            userId: entry.userId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }),
    ),
  )

  if (summary.checked > 0) {
    logger.info('QQ 音乐凭证定时刷新完成', {
      event: 'auth.tencent_credential_refresh_completed',
      ...summary,
    })
  }
  return summary
}

let scheduledRun: Promise<TencentCredentialRefreshSummary> | null = null

function runScheduledRefresh(): Promise<TencentCredentialRefreshSummary> {
  if (scheduledRun) return scheduledRun
  scheduledRun = refreshDueTencentCredentials().finally(() => {
    scheduledRun = null
  })
  return scheduledRun
}

export function startTencentCredentialRefreshScheduler(): ReturnType<typeof setInterval> {
  void runScheduledRefresh()
  const timer = setInterval(() => void runScheduledRefresh(), TENCENT_CREDENTIAL_SCAN_INTERVAL_MS)
  timer.unref()
  return timer
}

export function stopTencentCredentialRefreshScheduler(timer: ReturnType<typeof setInterval>): void {
  clearInterval(timer)
}
