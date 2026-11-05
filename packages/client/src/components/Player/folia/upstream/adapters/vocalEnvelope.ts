/**
 * 上游 `services/analysis/vocalEnvelope` 的宿主版本。
 *
 * 上游从 htdemucs 的人声轨得到逐帧包络；宿主用混音 200–4000 Hz 频带近似
 * （见 `services/beatFx/offlineBeatAnalysis/vocalEnvelope.ts`）。未开启混音
 * 特征或分析未完成时返回 null，雾笺退回混音频带分支。
 */
import { getTrackVocalEnvelope, type VocalEnvelope } from '@/services/beatFx/trackFeatures'

export const VOCAL_FPS = 50

export type { VocalEnvelope }

export const getVocalEnvelope = (key: string | null): VocalEnvelope | null => getTrackVocalEnvelope(key)
