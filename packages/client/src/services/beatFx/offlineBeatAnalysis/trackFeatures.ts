import {
  DRUMLESS_COVERAGE,
  drumCoverage,
  energyFrames,
  pickDrumHits,
  type DrumHits,
} from './drumHits'
import { melSpectrogram } from './melSpectrogram'
import { spectralFlux, vocalEnvelopeOfFeatures, vocalLevels, type VocalEnvelope } from './vocalEnvelope'
import { separateWholeTrack, STEM_SAMPLE_RATE } from '../../analysis/stems'

/**
 * 供 Folia 使用的曲目特征：鼓点击打与人声包络。
 *
 * 默认用混音近似；开启「真实分轨」且 WebGPU 可用时，先用 htdemucs 分出
 * 鼓轨 / 人声轨，再按上游的算法计算（鼓点用鼓轨频谱，人声电平用人声轨，
 * 谱通量仍来自混音）。
 */

export interface TrackFeatures {
  drumHits: DrumHits | null
  vocalEnvelope: VocalEnvelope | null
}

export interface TrackFeatureOptions {
  /** 用 htdemucs 真分轨；失败时自动回退混音近似。 */
  stems?: boolean
}

export const TRACK_FEATURE_SAMPLE_RATE = 22050

interface BandFilter {
  type: 'highpass' | 'lowpass'
  frequency: number
  q?: number
}

const OfflineCtx = (): typeof OfflineAudioContext | undefined =>
  typeof window === 'undefined'
    ? undefined
    : window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext

const renderMono = async (buffer: AudioBuffer, filters: BandFilter[]): Promise<Float32Array | null> => {
  const Context = OfflineCtx()
  if (!Context) return null
  const length = Math.max(1, Math.ceil(buffer.duration * TRACK_FEATURE_SAMPLE_RATE))
  const context = new Context(1, length, TRACK_FEATURE_SAMPLE_RATE)
  const source = context.createBufferSource()
  source.buffer = buffer
  let node: AudioNode = source
  for (const filter of filters) {
    const biquad = context.createBiquadFilter()
    biquad.type = filter.type
    biquad.frequency.value = filter.frequency
    biquad.Q.value = filter.q ?? 0.707
    node.connect(biquad)
    node = biquad
  }
  node.connect(context.destination)
  source.start()
  const rendered = await context.startRendering()
  return rendered.getChannelData(0)
}

const renderStereoAt = async (buffer: AudioBuffer, sampleRate: number): Promise<{ left: Float32Array; right: Float32Array } | null> => {
  const Context = OfflineCtx()
  if (!Context) return null
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate))
  const context = new Context(2, length, sampleRate)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  const rendered = await context.startRendering()
  const left = rendered.getChannelData(0)
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left
  return { left, right }
}

/** 44.1 kHz 单声道 → 22.05 kHz，用浏览器自带重采样（上游 `resampleStem`）。 */
const resampleMono = async (signal: Float32Array, fromRate: number, toRate: number): Promise<Float32Array | null> => {
  const Context = OfflineCtx()
  if (!Context) return null
  const length = Math.ceil(signal.length * toRate / fromRate)
  const context = new Context(1, length, toRate)
  const input = context.createBuffer(1, signal.length, fromRate)
  input.copyToChannel(signal as Float32Array<ArrayBuffer>, 0)
  const source = context.createBufferSource()
  source.buffer = input
  source.connect(context.destination)
  source.start()
  return (await context.startRendering()).getChannelData(0)
}

/** 真分轨特征：鼓点来自鼓轨频谱，人声电平来自人声轨；失败返回 null。 */
const computeStemFeatures = async (
  buffer: AudioBuffer,
  mixMel: Awaited<ReturnType<typeof melSpectrogram>>,
  isCurrent: () => boolean,
): Promise<TrackFeatures | null> => {
  // 低内存设备不跑分轨：整套管道峰值约数百 MB（解码 + 两轨 + 临时混音）。
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof memory === 'number' && memory > 0 && memory < 4) {
    console.info('[TrackFeatures] 设备内存较小，跳过真分轨，使用混音近似')
    return null
  }
  try {
    const stereo = buffer.sampleRate === STEM_SAMPLE_RATE && buffer.numberOfChannels >= 2
      ? { left: buffer.getChannelData(0), right: buffer.getChannelData(1) }
      : await renderStereoAt(buffer, STEM_SAMPLE_RATE)
    if (!stereo || !isCurrent()) return null
    const tracks = await separateWholeTrack(stereo.left, stereo.right, isCurrent)
    if (!tracks || !isCurrent()) return null

    const drumMono = await resampleMono(tracks.drums, STEM_SAMPLE_RATE, TRACK_FEATURE_SAMPLE_RATE)
    if (!drumMono || !isCurrent()) return null
    const drumMel = await melSpectrogram(drumMono, isCurrent)
    if (!drumMel.frames || !isCurrent()) return null

    const mixMono = new Float32Array(stereo.left.length)
    for (let index = 0; index < mixMono.length; index += 1) {
      mixMono[index] = (stereo.left[index] + stereo.right[index]) / 2
    }
    const coverage = drumCoverage(energyFrames(tracks.drums), energyFrames(mixMono))
    const drumHits = coverage < DRUMLESS_COVERAGE ? null : pickDrumHits(drumMel)

    const db = vocalLevels(tracks.vocals, mixMel.frames, STEM_SAMPLE_RATE)
    const vocalEnvelope = vocalEnvelopeOfFeatures(db, spectralFlux(mixMel))
    return { drumHits, vocalEnvelope }
  } catch (error) {
    console.warn('[TrackFeatures] stem separation failed, falling back to the mix:', error)
    return null
  }
}

export async function computeTrackFeatures(
  buffer: AudioBuffer,
  isCurrent: () => boolean = () => true,
  options: TrackFeatureOptions = {},
): Promise<TrackFeatures | null> {
  const [mono, vocalBand] = await Promise.all([
    renderMono(buffer, []),
    renderMono(buffer, [
      { type: 'highpass', frequency: 200 },
      { type: 'lowpass', frequency: 4000 },
    ]),
  ])
  if (!mono || !vocalBand || !isCurrent()) return null

  const mel = await melSpectrogram(mono, isCurrent)
  if (!mel.frames || !isCurrent()) return null

  if (options.stems) {
    const stemFeatures = await computeStemFeatures(buffer, mel, isCurrent)
    if (stemFeatures && isCurrent()) return stemFeatures
    if (!isCurrent()) return null
  }

  const drumHits = pickDrumHits(mel)
  const db = vocalLevels(vocalBand, mel.frames, TRACK_FEATURE_SAMPLE_RATE)
  const vocalEnvelope = vocalEnvelopeOfFeatures(db, spectralFlux(mel))

  return { drumHits, vocalEnvelope }
}

export type { DrumHits, VocalEnvelope }
