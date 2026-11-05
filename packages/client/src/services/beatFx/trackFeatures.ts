import type { DrumHits } from './offlineBeatAnalysis/drumHits'
import type { VocalEnvelope } from './offlineBeatAnalysis/vocalEnvelope'
import type { TrackFeatures } from './offlineBeatAnalysis/trackFeatures'

export { DRUM_HAT, DRUM_KICK, DRUM_SNARE, type DrumHitKind } from './offlineBeatAnalysis/drumHits'

/**
 * 当前曲目的特征（鼓点 / 人声包络）。
 *
 * 只有一份：切歌时清空，分析完成时按当前播放会话键发布。Folia 的适配器
 * 用 `heard.key` 查询，键不匹配就返回 null，效果自然退回拍点分支。
 */

let currentKey: string | null = null
let current: TrackFeatures | null = null

export const publishTrackFeatures = (key: string | null, features: TrackFeatures): void => {
  currentKey = key
  current = features
}

export const clearTrackFeatures = (): void => {
  currentKey = null
  current = null
}

export const getTrackDrumHits = (key: string | null): DrumHits | null =>
  key !== null && key === currentKey ? current?.drumHits ?? null : null

export const getTrackVocalEnvelope = (key: string | null): VocalEnvelope | null =>
  key !== null && key === currentKey ? current?.vocalEnvelope ?? null : null

export type { DrumHits, VocalEnvelope, TrackFeatures }
