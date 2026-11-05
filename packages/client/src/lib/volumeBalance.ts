/**
 * 智能响度平衡（ReplayGain `auto`）—— 上游
 * `services/volumeBalance/balanceRules.ts` 的决策部分。
 *
 * 宿主能拿到的“整曲读数”来自离线分析的积分响度，所以等价的输入是
 * `file` 与 `typical`；`played / profile / tag / head / platform / live`
 * 这些上游读数在宿主没有对应数据源，不参与决策。
 */

import type { LoudnessInfo, ReplayGainMode } from '@/services/beatFx/offlineBeatAnalysis/loudness'

export const VOLUME_BALANCE_TARGET_DB = -14
export const VOLUME_BALANCE_MAX_BOOST_DB = 6
export const VOLUME_BALANCE_PEAK_CEILING_DB = -1.5
export const TYPICAL_SIZE = 20
export const TYPICAL_FALLBACK_DB = -5

const SILENCE_DB = -90
const STORAGE_KEY = 'mt-volume-balance-history'

const isAudible = (loudness: number): boolean => loudness > SILENCE_DB

/** 允许抬升时同时受“最大抬升”和“峰值天花板”限制。 */
export const liftWithinPeak = (gainDb: number, peak?: number | null): number => {
  if (gainDb <= 0) return gainDb
  if (!(typeof peak === 'number' && peak > 0)) return 0
  const headroomDb = VOLUME_BALANCE_PEAK_CEILING_DB - 20 * Math.log10(peak)
  return Math.min(gainDb, VOLUME_BALANCE_MAX_BOOST_DB, Math.max(0, headroomDb))
}

/** 最近 TYPICAL_SIZE 个整曲读数的中位数增益，永不为正；没有读数时用保守的 -5 dB。 */
export const typicalGainDb = (gains: readonly number[]): number => {
  const recent = gains.slice(-TYPICAL_SIZE).filter(Number.isFinite).sort((a, b) => a - b)
  if (!recent.length) return TYPICAL_FALLBACK_DB
  const middle = Math.floor(recent.length / 2)
  const median = recent.length % 2 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2
  return Math.min(0, median)
}

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

export interface BalanceChoice {
  reading: 'file' | 'typical'
  gainDb: number
  effectiveGainDb: number
  estimated: boolean
}

/** 有整曲读数就用它；否则用最近读数的典型值，并且只允许衰减。 */
export const chooseBalance = (file: LoudnessInfo | null): BalanceChoice => {
  if (file && isAudible(file.lufs)) {
    const gainDb = VOLUME_BALANCE_TARGET_DB - file.lufs
    return { reading: 'file', gainDb, effectiveGainDb: liftWithinPeak(gainDb, file.peak), estimated: false }
  }
  const typicalDb = typicalGainDb(historyOf())
  return { reading: 'typical', gainDb: typicalDb, effectiveGainDb: Math.min(0, typicalDb), estimated: true }
}

export const replayGainDbFor = (info: LoudnessInfo | null, mode: ReplayGainMode): number => {
  if (mode === 'off') return 0
  if (mode === 'auto') return chooseBalance(info).effectiveGainDb
  if (!info) return 0
  let db = Math.min(6, Math.max(-12, VOLUME_BALANCE_TARGET_DB - info.lufs))
  if (db > 0 && info.peak > 0) db = Math.min(db, -20 * Math.log10(info.peak))
  return db
}

export const replayGainLinearFor = (info: LoudnessInfo | null, mode: ReplayGainMode): number =>
  10 ** (replayGainDbFor(info, mode) / 20)
