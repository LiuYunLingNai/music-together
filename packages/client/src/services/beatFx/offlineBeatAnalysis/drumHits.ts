/**
 * 鼓点击打的纯算术 —— 上游 `services/analysis/drumHitPicking.ts` 的移植。
 *
 * 上游喂进来的是 htdemucs 分离后的鼓轨频谱；宿主没有分离模型，喂的是
 * **混音**的频谱。因此 kick / snare / hat 会带贝斯与人声的串扰，结果是近似值，
 * 不是真分离。接口与阈值保持上游一致，将来接上分离时只换输入。
 */

import { BEAT_THIS_FPS, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './melSpectrogram'

export type DrumHitKind = 0 | 1 | 2
export const DRUM_KICK: DrumHitKind = 0
export const DRUM_SNARE: DrumHitKind = 1
export const DRUM_HAT: DrumHitKind = 2

export interface DrumHits {
  times: Float64Array
  strengths: Float32Array
  kinds: Uint8Array
  until?: number
}

export type DrumBands = [Float32Array, Float32Array, Float32Array]

const PEAK_BEFORE = 1
const PEAK_AFTER = 2
const BASE_FROM = 6
const BASE_TO = 2
const HIT_TOP = 0.99
const HIT_ONSET_FLOOR = 0.15
const PEAK_HALF = 3
const MIN_HIT_GAP = 0.09
const KICK_MAX_HZ = 150
const SNARE_MAX_HZ = 4000
const HAT_MIN_HZ = 6000

const bandTrack = (mel: MelSpectrogram, fromHz: number, toHz: number): Float32Array => {
  const bands = melBandCentresHz()
    .map((hz, band) => (hz >= fromHz && hz < toHz ? band : -1))
    .filter((band) => band >= 0)
  const out = new Float32Array(mel.frames)
  for (let frame = 0; frame < mel.frames; frame += 1) {
    let sum = 0
    for (const band of bands) sum += mel.data[frame * MEL_BANDS + band]
    out[frame] = bands.length ? sum / bands.length : 0
  }
  return out
}

const riseAt = (track: Float32Array, frame: number): number => {
  let peak = 0
  for (let at = frame - PEAK_BEFORE; at <= frame + PEAK_AFTER; at += 1) {
    if (at >= 0 && at < track.length) peak = Math.max(peak, track[at])
  }
  let base = 0
  let count = 0
  for (let at = frame - BASE_FROM; at <= frame - BASE_TO; at += 1) {
    if (at >= 0 && at < track.length) {
      base += track[at]
      count += 1
    }
  }
  return Math.max(0, peak - (count ? base / count : 0))
}

const riseShares = (track: Float32Array): Float32Array => {
  const rise = new Float32Array(track.length)
  for (let frame = 0; frame < track.length; frame += 1) rise[frame] = riseAt(track, frame)
  const loud = rise.filter((value) => value > 0).sort()
  const top = (loud.length ? loud[Math.min(loud.length - 1, Math.floor(HIT_TOP * loud.length))] : 0) || 1
  return rise.map((value) => Math.min(1, value / top))
}

export const drumBandTracks = (mel: MelSpectrogram): DrumBands => [
  bandTrack(mel, 0, KICK_MAX_HZ),
  bandTrack(mel, KICK_MAX_HZ, SNARE_MAX_HZ),
  bandTrack(mel, HAT_MIN_HZ, Infinity),
]

export const pickBandHits = (tracks: DrumBands, frames: number): DrumHits => {
  const bands = tracks.map((track) => riseShares(track.subarray(0, frames)))
  const top = new Float32Array(frames)
  const kindOf = new Uint8Array(frames)
  for (let frame = 0; frame < frames; frame += 1) {
    for (let kind = 0; kind < bands.length; kind += 1) {
      if (bands[kind][frame] > top[frame]) {
        top[frame] = bands[kind][frame]
        kindOf[frame] = kind
      }
    }
  }
  const times: number[] = []
  const strengths: number[] = []
  const kinds: number[] = []
  for (let frame = 0; frame < frames; frame += 1) {
    const share = top[frame]
    if (share < HIT_ONSET_FLOOR) continue
    let peak = true
    for (let at = Math.max(0, frame - PEAK_HALF); at <= Math.min(frames - 1, frame + PEAK_HALF) && peak; at += 1) {
      if (top[at] > share || (top[at] === share && at < frame)) peak = false
    }
    if (!peak) continue
    const time = frame / BEAT_THIS_FPS
    const last = times.length - 1
    if (last >= 0 && time - times[last] < MIN_HIT_GAP) {
      if (share > strengths[last]) {
        times[last] = time
        strengths[last] = share
        kinds[last] = kindOf[frame]
      }
      continue
    }
    times.push(time)
    strengths.push(share)
    kinds.push(kindOf[frame])
  }
  return {
    times: Float64Array.from(times),
    strengths: Float32Array.from(strengths),
    kinds: Uint8Array.from(kinds),
  }
}

export const pickDrumHits = (mel: MelSpectrogram): DrumHits =>
  pickBandHits(drumBandTracks(mel), mel.frames)

/** 鼓轨与混音的能量窗：44.1 kHz 下 10 ms 一帧（上游 `drumHitPicking.ts`）。 */
export const ENERGY_HOP = 441
/** 覆盖率按 0.25 s 窗口统计。 */
export const SHARE_WINDOW = 25
const SHARE_AUDIBLE = 0.05
const DRUMS_PLAYING_SHARE = 0.03
/** 鼓在可听窗口里出现不足这个比例 ⇒ 判为无鼓曲目。 */
export const DRUMLESS_COVERAGE = 0.08

const quantile = (values: number[], q: number): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

export const energyFrames = (signal: Float32Array): Float32Array => {
  const out = new Float32Array(Math.ceil(signal.length / ENERGY_HOP))
  for (let at = 0; at < signal.length; at += 1) out[Math.floor(at / ENERGY_HOP)] += signal[at] * signal[at]
  return out
}

/** 鼓实际演奏的时长占比：可听窗口里，鼓轨能量达到混音 3% 的窗口比例。 */
export const drumCoverage = (drumEnergy: Float32Array, mixEnergy: Float32Array): number => {
  const windows: Array<{ drum: number; mix: number }> = []
  for (let from = 0; from < mixEnergy.length; from += SHARE_WINDOW) {
    let drum = 0
    let mix = 0
    for (let at = from; at < Math.min(mixEnergy.length, from + SHARE_WINDOW); at += 1) {
      drum += drumEnergy[at] ?? 0
      mix += mixEnergy[at]
    }
    windows.push({ drum, mix })
  }
  const floor = quantile(windows.map((window) => window.mix), 0.5) * SHARE_AUDIBLE
  const audible = windows.filter((window) => window.mix > floor && window.mix > 0)
  if (!audible.length) return 0
  return audible.filter((window) => window.drum >= DRUMS_PLAYING_SHARE * window.mix).length / audible.length
}
