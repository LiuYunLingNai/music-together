/**
 * 上游 `services/analysis/drumHits` 的宿主版本。
 *
 * 上游用 htdemucs 分离鼓轨；宿主用混音频谱近似（见
 * `services/beatFx/offlineBeatAnalysis/drumHits.ts`）。分析未完成、未开启
 * 混音特征、或时间尚未覆盖时返回 null，时计按拍点表播放。
 */
import { getTrackDrumHits, type DrumHitKind, type DrumHits } from '@/services/beatFx/trackFeatures'
import type { MotionValue } from 'motion/react'

export { DRUM_HAT, DRUM_KICK, DRUM_SNARE } from '@/services/beatFx/trackFeatures'
export type { DrumHitKind, DrumHits }

export const getDrumHits = (key: string | null): DrumHits | null => getTrackDrumHits(key)

/** 上游用 MotionValue 发布鼓点进度；这里保留同形接口。 */
export type DrumHitsSignal = MotionValue<DrumHits | null>
