import { DEFAULT_AUDIO_EFFECT_SETTINGS, normalizeAudioEffects, type AudioEffectSettings } from './model'
import { createBitCrushCurve, createSaturationCurve } from './sources'
import { createNoiseBranch } from './noise'
import { createReverbBranch } from './reverb'
import { createWowBranch } from './wow'
import { dbToLinear, rampParam } from './params'
import { connectAudioEffectNodes, createAudioEffectNodes, disconnectAudioEffectNodes } from './nodes'

interface CreateAudioEffectChainParams {
  context: AudioContext
  input: AudioNode
  output: AudioNode
  effects: AudioEffectSettings
  enabled: boolean
}

export interface AudioEffectChain {
  apply: (effects: AudioEffectSettings, enabled: boolean) => void
  dispose: () => void
}

export const createAudioEffectChain = ({
  context,
  input,
  output,
  effects,
  enabled,
}: CreateAudioEffectChainParams): AudioEffectChain => {
  const nodes = createAudioEffectNodes(context)
  connectAudioEffectNodes(nodes, input, output)

  const reverb = createReverbBranch(context, nodes)
  const noise = createNoiseBranch(context, nodes)
  const wow = createWowBranch(context, nodes)
  let lastDrive = -1
  let lastCrush = -1

  const apply = (nextEffects: AudioEffectSettings, nextEnabled: boolean): void => {
    const active = nextEnabled ? normalizeAudioEffects(nextEffects) : DEFAULT_AUDIO_EFFECT_SETTINGS

    rampParam(context, nodes.highpass.frequency, active.highpass)
    rampParam(context, nodes.lowpass.frequency, Math.min(active.lowpass, context.sampleRate * 0.475))
    // 两个截止都在中性端点时走直通（见 connectAudioEffectNodes）；挪开任一个都会交叉淡化到
    // 滤波支路，切换本身不出咔哒声。
    const filtersNeutral =
      active.highpass <= DEFAULT_AUDIO_EFFECT_SETTINGS.highpass &&
      active.lowpass >= DEFAULT_AUDIO_EFFECT_SETTINGS.lowpass
    rampParam(context, nodes.filterBypass.gain, filtersNeutral ? 1 : 0)
    rampParam(context, nodes.filterReturn.gain, filtersNeutral ? 0 : 1)

    if (active.drive !== lastDrive) {
      lastDrive = active.drive
      nodes.drive.curve = createSaturationCurve(active.drive)
    }
    if (active.crush !== lastCrush) {
      lastCrush = active.crush
      nodes.crush.curve = createBitCrushCurve(active.crush)
    }

    wow.set(active.wow)
    noise.set(active.noise)
    reverb.set(active.space)

    const direct = (1 + active.width) / 2
    const cross = (1 - active.width) / 2
    rampParam(context, nodes.leftDirect.gain, direct)
    rampParam(context, nodes.rightDirect.gain, direct)
    rampParam(context, nodes.leftCross.gain, cross)
    rampParam(context, nodes.rightCross.gain, cross)

    rampParam(context, nodes.compressor.threshold, -6 - active.punch * 26)
    rampParam(context, nodes.compressor.ratio, 1 + active.punch * 7)
    rampParam(context, nodes.compressor.knee, 30 - active.punch * 18)
    // 压缩削掉的峰值由 makeup 补回；饱和曲线本身已配平，不再另加增益。
    rampParam(context, nodes.makeup.gain, dbToLinear(active.punch * 3))
  }

  apply(effects, enabled)

  return {
    apply,
    dispose: () => {
      wow.dispose()
      noise.dispose()
      reverb.dispose()
      disconnectAudioEffectNodes(nodes, input)
    },
  }
}
