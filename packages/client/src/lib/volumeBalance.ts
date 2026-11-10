/**
 * 智能响度平衡（ReplayGain `auto`）在宿主侧的输入适配：
 * 上游 `services/volumeBalance/balanceRules.ts` 原样放在 `automix/upstream`，
 * 这里只把宿主的整曲离线读数接进去，并维护 `typical` 历史。
 *
 * 上游的 `played / tag / head / platform / live` 读数在宿主没有对应数据源；
 * `file` 是离线分析给出的整曲测量，也是上游最信任的一档。
 */

import type { LoudnessInfo, ReplayGainMode } from '@/services/beatFx/offlineBeatAnalysis/loudness'
import {
  TYPICAL_SIZE,
  chooseBalance as chooseBalanceFromRules,
  typicalGainDb,
  VOLUME_BALANCE_TARGET_DB,
  type BalanceChoice,
} from './automix/upstream/balanceRules'

export {
  TYPICAL_FALLBACK_DB,
  TYPICAL_SIZE,
  VOLUME_BALANCE_MAX_BOOST_DB,
  VOLUME_BALANCE_PEAK_CEILING_DB,
  VOLUME_BALANCE_TARGET_DB,
  liftWithinPeak,
  planBalanceMove,
  typicalGainDb,
} from './automix/upstream/balanceRules'
export type { BalanceChoice, MoveQuestion } from './automix/upstream/balanceRules'

const STORAGE_KEY = 'mt-volume-balance-history'

const readHistory = (): number[] => {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : []
  } catch {
    return []
  }
}

let history: number[] | null = null

const historyOf = (): number[] => {
  history ??= readHistory()
  return history
}

/** 记下一次整曲读数（`目标响度 - 实测响度`），只保留最近 TYPICAL_SIZE 条。 */
export const recordWholeTrackGain = (gainDb: number): void => {
  if (!Number.isFinite(gainDb)) return
  const gains = [...historyOf(), gainDb].slice(-TYPICAL_SIZE)
  history = gains
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(gains))
  } catch {
    // 存储被禁用时保持内存态即可。
  }
}

/** 有整曲读数就用它；否则用最近读数的典型值，并且只允许衰减。 */
export const chooseBalance = (file: LoudnessInfo | null): BalanceChoice =>
  chooseBalanceFromRules({
    file: file ? { loudness: file.lufs, peak: file.peak } : null,
    typicalDb: typicalGainDb(historyOf()),
  })

export const replayGainDbFor = (info: LoudnessInfo | null, mode: ReplayGainMode): number => {
  if (mode === 'off') return 0
  if (mode === 'auto') return chooseBalance(info).effectiveGainDb
  if (!info) return 0
  let db = Math.min(6, Math.max(-12, VOLUME_BALANCE_TARGET_DB - info.lufs))
  if (db > 0 && info.peak > 0) db = Math.min(db, -20 * Math.log10(info.peak))
  return db
}
