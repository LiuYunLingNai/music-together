/**
 * 判定一段音频是不是“整首歌”——上游 `wholeSongCheck` 的宿主版。
 *
 * 平台可能只给试听片段：片段会正常播放，但绝不能当成整曲写进媒体缓存，
 * 也不能让由它算出的画像/分轨长期代表这首歌。
 */

/** 低于声明时长的这个比例，判定为试听片段。 */
export const NOT_THE_SONG_SHARE = 0.5
/** 达到声明时长的这个比例，判定为整曲，可以覆盖已有缓存。 */
export const WHOLE_SONG_SHARE = 0.95

export type WholeSongVerdict = 'not-the-song' | 'whole' | 'unknown'

const valid = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export function wholeSongVerdict(
  actualDurationSec: number | null | undefined,
  statedDurationSec: number | null | undefined,
): WholeSongVerdict {
  if (!valid(actualDurationSec) || !valid(statedDurationSec)) return 'unknown'
  const share = actualDurationSec / statedDurationSec
  if (share < NOT_THE_SONG_SHARE) return 'not-the-song'
  if (share >= WHOLE_SONG_SHARE) return 'whole'
  return 'unknown'
}

/**
 * 是否允许写入媒体缓存：
 * - 判定为片段：拒绝，并删除可能已存在的旧副本；
 * - 判定为整曲：允许覆盖；
 * - 无法判定或介于两档之间：只在没有旧副本时写入。
 */
export function judgeSongAudioForCache(options: {
  actualDurationSec?: number | null
  statedDurationSec?: number | null
  hasCopy: boolean
}): { store: boolean; distrustExisting: boolean } {
  const verdict = wholeSongVerdict(options.actualDurationSec, options.statedDurationSec)
  if (verdict === 'not-the-song') return { store: false, distrustExisting: true }
  if (verdict === 'whole') return { store: true, distrustExisting: false }
  return { store: !options.hasCopy, distrustExisting: false }
}
