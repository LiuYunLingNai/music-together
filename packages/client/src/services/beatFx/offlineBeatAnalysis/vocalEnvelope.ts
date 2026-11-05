/**
 * 人声包络 —— 上游 `services/analysis/vocalEnvelope.ts` 的纯算术部分。
 *
 * 上游用 htdemucs 的人声轨；宿主用混音里 200–4000 Hz 的频带近似。电平与
 * onsets 的形状保持上游一致，但伴奏泄漏会让结果比真分离更粗糙。
 */

import { MEL_BANDS, type MelSpectrogram } from './melSpectrogram'

export const VOCAL_FPS = 50
const TOP_SHARE = 0.97
const SINGING_DB = 28
const PEAK_REACH = 3
const AVERAGE_BEFORE = 10
const ONSET_DELTA = 0.7
const FALLING_DB = 3
const ONSET_GAP = 3

export interface VocalEnvelope {
  fps: number
  db: Float32Array
  top: number
  onsets: Uint32Array
  from?: number
}

/** 20 ms 一帧；帧长随采样率变化，保持与上游 44.1 kHz / 882 样本一致。 */
const frameSizeOf = (sampleRate: number): number => Math.max(1, Math.round(sampleRate * 0.02))

export const vocalLevels = (
  band: Float32Array,
  frames: number,
  sampleRate: number,
): Float32Array => {
  const frameSize = frameSizeOf(sampleRate)
  const db = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame += 1) {
    const from = frame * frameSize - frameSize
    let sum = 0
    for (let at = Math.max(0, from); at < Math.min(band.length, from + 2 * frameSize); at += 1) {
      sum += band[at] * band[at]
    }
    db[frame] = 10 * Math.log10(sum / (2 * frameSize) + 1e-12)
  }
  return db
}

const quantile = (values: Float32Array, share: number): number => {
  if (!values.length) return -120
  const sorted = values.slice().sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]
}

export const spectralFlux = (mel: MelSpectrogram): Float32Array => {
  const flux = new Float32Array(mel.frames)
  for (let frame = 1; frame < mel.frames; frame += 1) {
    let sum = 0
    for (let band = 0; band < MEL_BANDS; band += 1) {
      const rise = mel.data[frame * MEL_BANDS + band] - mel.data[(frame - 1) * MEL_BANDS + band]
      if (rise > 0) sum += rise
    }
    flux[frame] = sum / MEL_BANDS
  }
  return flux
}

export const pickVocalOnsets = (
  flux: Float32Array,
  db: Float32Array,
  top: number,
  from = 0,
): Uint32Array => {
  const n = Math.min(flux.length, db.length)
  const first = from > 0 ? from + 1 : 0
  const count = Math.max(1, n - first)
  let mean = 0
  for (let at = first; at < n; at += 1) mean += flux[at]
  mean /= count
  let variance = 0
  for (let at = first; at < n; at += 1) variance += (flux[at] - mean) ** 2
  const delta = ONSET_DELTA * Math.sqrt(variance / count)
  const onsets: number[] = []
  let last = -Infinity
  for (let frame = from > 0 ? first + AVERAGE_BEFORE : PEAK_REACH; frame < n - PEAK_REACH; frame += 1) {
    if (db[frame] <= top - SINGING_DB || frame - last < ONSET_GAP) continue
    if (db[frame + 1] < db[frame - 1] - FALLING_DB) continue
    let peak = true
    for (let at = frame - PEAK_REACH; at <= frame + PEAK_REACH && peak; at += 1) peak = flux[at] <= flux[frame]
    if (!peak) continue
    let local = 0
    const localFrom = Math.max(0, frame - AVERAGE_BEFORE)
    for (let at = localFrom; at <= frame + PEAK_REACH; at += 1) local += flux[at]
    if (flux[frame] < local / (frame + PEAK_REACH + 1 - localFrom) + delta) continue
    onsets.push(frame)
    last = frame
  }
  return Uint32Array.from(onsets)
}

export const vocalEnvelopeOfFeatures = (
  db: Float32Array,
  flux: Float32Array,
  from = 0,
): VocalEnvelope => {
  if (from > 0) db.fill(-120, 0, from)
  const top = quantile(db.subarray(from), TOP_SHARE)
  const onsets = pickVocalOnsets(flux, db, top, from)
  return from > 0 ? { fps: VOCAL_FPS, db, top, onsets, from } : { fps: VOCAL_FPS, db, top, onsets }
}
