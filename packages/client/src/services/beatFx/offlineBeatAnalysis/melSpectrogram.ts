/**
 * Beat This! 的输入契约里纯算术的那一半：22.05 kHz、N_FFT 1024、HOP 441、
 * 128 mel 的 log-mel 频谱。上游 `services/analysis/beatThis.ts` 的宿主移植，
 * 只保留频谱计算，不包含模型。
 *
 * 这里的常数都是契约值（22050 / 1024 / 441 / 30–11000 Hz / log1p×1000），
 * 改动会让下游的鼓点与包络结果整体偏移。
 */

export const BEAT_THIS_SAMPLE_RATE = 22050
const N_FFT = 1024
const HOP = 441
export const BEAT_THIS_FPS = BEAT_THIS_SAMPLE_RATE / HOP
export const MEL_BANDS = 128
const F_MIN = 30
const F_MAX = 11000
const LOG_MULTIPLIER = 1000
const AMIN = 1e-10

const hzToMel = (hz: number): number => {
  const fSp = 200 / 3
  if (hz < 1000) return hz / fSp
  return 1000 / fSp + Math.log(hz / 1000) / (Math.log(6.4) / 27)
}

const melToHz = (mel: number): number => {
  const fSp = 200 / 3
  const minLogMel = 1000 / fSp
  if (mel < minLogMel) return fSp * mel
  return 1000 * Math.exp((Math.log(6.4) / 27) * (mel - minLogMel))
}

interface MelBand {
  weights: Float64Array
  start: number
  end: number
}

let filterbank: MelBand[] | null = null
let hann: Float64Array | null = null

const buildFilterbank = (): MelBand[] => {
  const bins = N_FFT / 2 + 1
  const melMin = hzToMel(F_MIN)
  const melMax = hzToMel(F_MAX)
  const corners = Array.from({ length: MEL_BANDS + 2 }, (_, index) =>
    melToHz(melMin + ((melMax - melMin) * index) / (MEL_BANDS + 1)))

  return Array.from({ length: MEL_BANDS }, (_, band) => {
    const row = new Float64Array(bins)
    const [left, centre, right] = [corners[band], corners[band + 1], corners[band + 2]]
    for (let bin = 0; bin < bins; bin += 1) {
      const hz = (bin * BEAT_THIS_SAMPLE_RATE) / N_FFT
      const rising = centre === left ? 0 : (hz - left) / (centre - left)
      const falling = right === centre ? 0 : (right - hz) / (right - centre)
      row[bin] = Math.max(0, Math.min(rising, falling))
    }
    let start = 0
    while (start < bins && row[start] === 0) start += 1
    let end = bins
    while (end > start && row[end - 1] === 0) end -= 1
    return { weights: row, start, end }
  })
}

const melBandCentres = (): number[] => {
  const melMin = hzToMel(F_MIN)
  const melMax = hzToMel(F_MAX)
  return Array.from({ length: MEL_BANDS }, (_, band) =>
    melToHz(melMin + ((melMax - melMin) * (band + 1)) / (MEL_BANDS + 1)))
}

const bitReversalCache = new Map<number, Int32Array>()
const bitReversalOf = (n: number): Int32Array => {
  const cached = bitReversalCache.get(n)
  if (cached) return cached
  const table = new Int32Array(n)
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    table[i] = j
  }
  bitReversalCache.set(n, table)
  return table
}

const fft = (real: Float64Array, imag: Float64Array): void => {
  const n = real.length
  const reversed = bitReversalOf(n)
  for (let i = 1; i < n; i += 1) {
    const j = reversed[i]
    if (i < j) {
      let swap = real[i]
      real[i] = real[j]
      real[j] = swap
      swap = imag[i]
      imag[i] = imag[j]
      imag[j] = swap
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wReal = Math.cos(angle)
    const wImag = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curReal = 1
      let curImag = 0
      for (let k = 0; k < len / 2; k += 1) {
        const aReal = real[i + k]
        const aImag = imag[i + k]
        const bReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag
        const bImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal
        real[i + k] = aReal + bReal
        imag[i + k] = aImag + bImag
        real[i + k + len / 2] = aReal - bReal
        imag[i + k + len / 2] = aImag - bImag
        const nextReal = curReal * wReal - curImag * wImag
        curImag = curReal * wImag + curImag * wReal
        curReal = nextReal
      }
    }
  }
}

export interface MelSpectrogram {
  data: Float32Array
  frames: number
}

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 与上游同一条 STFT：reflect 补边、周期 Hann、按 sqrt(N) 归一、log1p 压缩。 */
export async function melSpectrogram(
  mono: Float32Array,
  isCurrent: () => boolean = () => true,
): Promise<MelSpectrogram> {
  if (!filterbank) filterbank = buildFilterbank()
  if (!hann) {
    hann = new Float64Array(N_FFT)
    for (let index = 0; index < N_FFT; index += 1) {
      hann[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / N_FFT))
    }
  }

  const pad = N_FFT / 2
  const padded = new Float64Array(mono.length + 2 * pad)
  for (let index = 0; index < pad; index += 1) {
    padded[index] = mono[Math.min(pad - index, mono.length - 1)]
    padded[padded.length - 1 - index] = mono[Math.max(0, mono.length - 1 - (pad - index))]
  }
  padded.set(mono, pad)

  const frames = Math.floor((padded.length - N_FFT) / HOP) + 1
  if (frames <= 0) return { data: new Float32Array(0), frames: 0 }

  const data = new Float32Array(frames * MEL_BANDS)
  const real = new Float64Array(N_FFT)
  const imag = new Float64Array(N_FFT)
  const magnitude = new Float64Array(N_FFT / 2 + 1)
  const scale = 1 / Math.sqrt(N_FFT)

  let yieldBy = performance.now() + 12
  for (let frame = 0; frame < frames; frame += 1) {
    if (performance.now() >= yieldBy) {
      await yieldToMain()
      if (!isCurrent()) return { data: new Float32Array(0), frames: 0 }
      yieldBy = performance.now() + 12
    }
    const start = frame * HOP
    for (let index = 0; index < N_FFT; index += 1) {
      real[index] = padded[start + index] * hann[index]
      imag[index] = 0
    }
    fft(real, imag)
    for (let bin = 0; bin < magnitude.length; bin += 1) {
      magnitude[bin] = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]) * scale
    }
    for (let band = 0; band < MEL_BANDS; band += 1) {
      const { weights, start: from, end: to } = filterbank[band]
      let energy = 0
      for (let bin = from; bin < to; bin += 1) energy += magnitude[bin] * weights[bin]
      data[frame * MEL_BANDS + band] = Math.log1p(LOG_MULTIPLIER * Math.max(energy, AMIN))
    }
  }
  return { data, frames }
}

export const melBandCentresHz = melBandCentres
