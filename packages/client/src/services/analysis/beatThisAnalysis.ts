import {
  BEAT_THIS_SAMPLE_RATE,
  aggregateChunks,
  beatsFromLogits,
  melSpectrogram,
  splitForModel,
  type ChunkPrediction,
  type MelSpectrogram,
} from './beatThis'
import { computeBeatAccents, resolveBeatConfidence, type BeatAccents } from './beatAccents'
import { loadBeatThisModel, runBeatThis } from './beatThisModel'

/**
 * 整首曲目的 beat_this 分析：解码到 22.05 kHz 单声道、做梅尔频谱、分块推理、
 * 拼接 logits、取拍点/下拍，再在同一份频谱上算每拍重音与节奏门。
 *
 * 与上游 `analyseBeatGrid` 同一条链路；宿主没有 CPU 兜底，失败即返回 null，
 * 由调用方回退现有本地分析。
 */

export interface BeatThisAnalysis {
  beats: number[]
  downbeats: number[]
  accents: BeatAccents
  confidence: number[]
  duration: number
}

export interface BeatThisAudio {
  samples: Float32Array
  duration: number
}

const OfflineCtx = (): typeof OfflineAudioContext | undefined =>
  typeof window === 'undefined'
    ? undefined
    : window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext

/** 解码到模型采样率并按 (L+R)/2 取单声道；decodeAudioData 直接完成重采样。 */
export const decodeForBeatThis = async (bytes: ArrayBuffer): Promise<BeatThisAudio | null> => {
  const Context = OfflineCtx()
  if (!Context) return null
  try {
    const buffer = await new Context(1, 1, BEAT_THIS_SAMPLE_RATE).decodeAudioData(bytes)
    const left = buffer.getChannelData(0)
    const samples = buffer.numberOfChannels < 2 ? Float32Array.from(left) : new Float32Array(buffer.length)
    if (buffer.numberOfChannels >= 2) {
      const right = buffer.getChannelData(1)
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = (left[index] + right[index]) / 2
      }
    }
    return { samples, duration: buffer.duration }
  } catch (error) {
    console.warn('[beat-this] decode failed:', error)
    return null
  }
}

export const analyseWithBeatThis = async (
  audio: BeatThisAudio,
  isCurrent: () => boolean,
): Promise<BeatThisAnalysis | null> => {
  await loadBeatThisModel()
  if (!isCurrent()) return null

  const mel: MelSpectrogram = await melSpectrogram(audio.samples)
  if (!isCurrent()) return null

  const chunks = splitForModel(mel)
  if (!chunks.length) return null
  const result = await runBeatThis(
    chunks.map((chunk) => chunk.data),
    { mel: new Float32Array(mel.data), frames: mel.frames },
  )
  if (!isCurrent()) return null

  const predictions: ChunkPrediction[] = chunks.map((chunk, index) => ({
    start: chunk.start,
    frames: chunk.frames,
    beat: result.beat[index],
    downbeat: result.downbeat[index],
  }))
  const logits = aggregateChunks(predictions, mel.frames)
  const grid = beatsFromLogits(logits.beat, logits.downbeat)
  const confidence = resolveBeatConfidence(logits.beat, grid.beats)
  const accents = computeBeatAccents(mel, grid.beats, grid.downbeats, result.percussive ?? null, { confidence })
  return { ...grid, accents, confidence, duration: audio.duration }
}
