const SATURATION_SAMPLES = 1024
const CRUSH_SAMPLES = 8192
const SATURATION_REFERENCE_AMPLITUDE = 0.5

const measureSaturationCompensation = (shape: number, scale: number): number => {
  const cycleSamples = 1024
  let energy = 0
  for (let index = 0; index < cycleSamples; index += 1) {
    const input = SATURATION_REFERENCE_AMPLITUDE * Math.sin((2 * Math.PI * index) / cycleSamples)
    const shaped = Math.tanh(shape * input) / scale
    energy += shaped * shaped
  }
  const shapedRms = Math.sqrt(energy / cycleSamples)
  const referenceRms = SATURATION_REFERENCE_AMPLITUDE / Math.SQRT2
  return shapedRms > 0 ? referenceRms / shapedRms : 1
}

export const createSaturationCurve = (amount: number): Float32Array<ArrayBuffer> | null => {
  if (amount <= 0) return null

  // 软削波先配平响度，避免"加饱和=加音量"。
  const shape = 1 + amount * 4
  const scale = Math.tanh(shape)
  const compensation = measureSaturationCompensation(shape, scale)
  const curve = new Float32Array(SATURATION_SAMPLES)
  for (let index = 0; index < SATURATION_SAMPLES; index += 1) {
    const input = (index / (SATURATION_SAMPLES - 1)) * 2 - 1
    curve[index] = (Math.tanh(shape * input) / scale) * compensation
  }
  return curve
}

export const createBitCrushCurve = (amount: number): Float32Array<ArrayBuffer> | null => {
  if (amount <= 0) return null

  // 开方后 8–10 bit 的可听区间落在滑块中段。
  const bits = 16 - Math.sqrt(amount) * 12
  const steps = Math.max(2, 2 ** (bits - 1))
  const curve = new Float32Array(CRUSH_SAMPLES)
  for (let index = 0; index < CRUSH_SAMPLES; index += 1) {
    const input = (index / (CRUSH_SAMPLES - 1)) * 2 - 1
    curve[index] = Math.max(-1, Math.min(1, Math.round(input * steps) / steps))
  }
  return curve
}

export const createVinylNoiseBuffer = (context: BaseAudioContext): AudioBuffer => {
  const length = Math.max(1, Math.floor(context.sampleRate * 3))
  const buffer = context.createBuffer(2, length, context.sampleRate)

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    let crackle = 0
    for (let index = 0; index < length; index += 1) {
      if (Math.random() < 0.0007) crackle = Math.random() * 2 - 1
      crackle *= 0.88
      data[index] = (Math.random() * 2 - 1) * 0.12 + crackle * 0.9
    }
  }

  return buffer
}

export const createReverbImpulse = (context: BaseAudioContext, seconds = 2.2, decay = 2.8): AudioBuffer => {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds))
  const buffer = context.createBuffer(2, length, context.sampleRate)

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < length; index += 1) {
      const progress = index / length
      data[index] = (Math.random() * 2 - 1) * (1 - progress) ** decay
    }
  }

  return buffer
}
