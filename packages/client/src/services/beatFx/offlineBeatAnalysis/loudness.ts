/**
 * 曲目响度测量（EBU R128 近似）。
 *
 * 宿主没有音源侧的 ReplayGain 标签，所以在离线分析的解码结果上直接算：
 * K 加权 → 100 ms 子块 → 400 ms 滑窗 → 绝对/相对门限。目标响度取流媒体常用的
 * -14 LUFS，并对正增益做峰值保护。
 */

export type ReplayGainMode = 'off' | 'track' | 'auto'

export interface LoudnessInfo {
  /** 整曲积分响度，LUFS。 */
  lufs: number
  /** 采样峰值（0..1），用于阻止正增益削波。 */
  peak: number
}

export const REPLAY_GAIN_TARGET_LUFS = -14
const ABSOLUTE_GATE_LUFS = -70
const RELATIVE_GATE_LU = 10

const K_SHELF_FREQUENCY = 1681.974450955533
const K_SHELF_GAIN_DB = 3.999843853973347
const K_HIGHPASS_FREQUENCY = 38.13547087602444
const K_HIGHPASS_Q = 0.5003270373238773

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

const highShelf = (sampleRate: number): Biquad => {
  const amplitude = 10 ** (K_SHELF_GAIN_DB / 40)
  const w0 = (2 * Math.PI * K_SHELF_FREQUENCY) / sampleRate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = (sin / 2) * Math.SQRT2
  const sqrtA = Math.sqrt(amplitude)
  const b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cos + 2 * sqrtA * alpha)
  const b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cos)
  const b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cos - 2 * sqrtA * alpha)
  const a0 = (amplitude + 1) - (amplitude - 1) * cos + 2 * sqrtA * alpha
  const a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cos)
  const a2 = (amplitude + 1) - (amplitude - 1) * cos - 2 * sqrtA * alpha
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

const highPass = (sampleRate: number): Biquad => {
  const w0 = (2 * Math.PI * K_HIGHPASS_FREQUENCY) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * K_HIGHPASS_Q)
  const b0 = (1 + cos) / 2
  const b1 = -(1 + cos)
  const b2 = (1 + cos) / 2
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const loudnessOfPower = (power: number): number => -0.691 + 10 * Math.log10(power)

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

export async function measureLoudness(
  buffer: AudioBuffer,
  isCurrent: () => boolean = () => true,
): Promise<LoudnessInfo> {
  const sampleRate = buffer.sampleRate
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const blockSize = Math.max(1, Math.round(sampleRate * 0.1))
  const blockCount = Math.max(1, Math.ceil(length / blockSize))
  const blockSums = new Float64Array(blockCount)
  const blockCounts = new Float64Array(blockCount)
  for (let block = 0; block < blockCount; block += 1) {
    blockCounts[block] = Math.min(blockSize, length - block * blockSize)
  }

  const shelf = highShelf(sampleRate)
  const pass = highPass(sampleRate)
  let peak = 0

  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel)
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    let u1 = 0
    let u2 = 0
    let v1 = 0
    let v2 = 0
    for (let index = 0; index < length; index += 1) {
      const x = data[index]
      const abs = Math.abs(x)
      if (abs > peak) peak = abs

      const y = shelf.b0 * x + shelf.b1 * x1 + shelf.b2 * x2 - shelf.a1 * y1 - shelf.a2 * y2
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y

      const v = pass.b0 * y + pass.b1 * u1 + pass.b2 * u2 - pass.a1 * v1 - pass.a2 * v2
      u2 = u1
      u1 = y
      v2 = v1
      v1 = v

      blockSums[Math.floor(index / blockSize)] += v * v

      if ((index & 0xfffff) === 0) {
        await yieldToMain()
        if (!isCurrent()) return { lufs: REPLAY_GAIN_TARGET_LUFS, peak }
      }
    }
  }

  const powers: number[] = []
  for (let block = 0; block + 3 < blockCount; block += 1) {
    let sum = 0
    let count = 0
    for (let offset = 0; offset < 4; offset += 1) {
      sum += blockSums[block + offset]
      count += blockCounts[block + offset]
    }
    if (count > 0) powers.push(sum / count)
  }

  if (powers.length === 0) {
    const total = Array.from(blockSums).reduce((sum, value) => sum + value, 0)
    const power = total / Math.max(1, length)
    return { lufs: power > 0 ? loudnessOfPower(power) : REPLAY_GAIN_TARGET_LUFS, peak }
  }

  const aboveAbsolute = powers.filter((power) => loudnessOfPower(power) > ABSOLUTE_GATE_LUFS)
  if (aboveAbsolute.length === 0) return { lufs: REPLAY_GAIN_TARGET_LUFS, peak }

  const absoluteMean = mean(aboveAbsolute)
  const relativeThreshold = loudnessOfPower(absoluteMean) - RELATIVE_GATE_LU
  const aboveRelative = aboveAbsolute.filter((power) => loudnessOfPower(power) > relativeThreshold)
  const finalPower = mean(aboveRelative.length > 0 ? aboveRelative : aboveAbsolute)
  return { lufs: finalPower > 0 ? loudnessOfPower(finalPower) : REPLAY_GAIN_TARGET_LUFS, peak }
}
