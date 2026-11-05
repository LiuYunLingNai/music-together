import type { BeatMap } from '../beatFx/offlineBeatAnalysis/beatAnalysisTypes'
import { computeTrackFeatures } from '../beatFx/offlineBeatAnalysis/trackFeatures'
import { measureLoudness } from '../beatFx/offlineBeatAnalysis/loudness'
import { analyseWithBeatThis, decodeForBeatThis } from './beatThisAnalysis'
import { beatMapFromBeatThis } from './highPrecisionBeatMap'

export interface ModelBeatMapOptions {
  wantLoudness?: boolean
  wantFeatures?: boolean
  wantStems?: boolean
}

/**
 * beat_this 版本的一整首分析。`buffer` 是按播放采样率解码的同一份音频，
 * 只用于响度与混音特征侧车；模型自己再解码到 22.05 kHz 单声道。
 *
 * 任何失败都返回 null，调用方回退现有本地分析。
 */
export const analyzeModelBeatMap = async (
  bytes: ArrayBuffer,
  buffer: AudioBuffer,
  analysisProfile: string,
  isCurrent: () => boolean,
  options: ModelBeatMapOptions,
): Promise<BeatMap | null> => {
  try {
    const audio = await decodeForBeatThis(bytes)
    if (!audio || !isCurrent()) return null
    const analysis = await analyseWithBeatThis(audio, isCurrent)
    if (!analysis || !isCurrent()) return null
    const map = beatMapFromBeatThis(analysis, analysisProfile || 'default')
    const loudness = options.wantLoudness ? await measureLoudness(buffer, isCurrent) : undefined
    if (!isCurrent()) return null
    const features = options.wantFeatures
      ? await computeTrackFeatures(buffer, isCurrent, { stems: options.wantStems === true })
      : undefined
    return { ...map, loudness, features: features ?? undefined }
  } catch (error) {
    console.warn('beat_this 分析失败，回退本地分析:', error)
    return null
  }
}
