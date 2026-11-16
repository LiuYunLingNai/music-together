import { rampParam } from './params'
import { createVinylNoiseBuffer } from './sources'
import { createReleaseTimer, type AudioEffectBranch } from './release'
import type { AudioEffectNodes } from './nodes'

export const createNoiseBranch = (context: AudioContext, nodes: AudioEffectNodes): AudioEffectBranch => {
  let source: AudioBufferSourceNode | null = null
  let filter: BiquadFilterNode | null = null
  const release = createReleaseTimer()

  const teardown = (): void => {
    if (source) {
      try {
        source.stop()
      } catch {
        // 已随 AudioContext 停止。
      }
      source.disconnect()
      source = null
    }
    filter?.disconnect()
    filter = null
  }

  return {
    set: (amount) => {
      if (amount > 0) {
        release.cancel()
        if (!source) {
          filter = context.createBiquadFilter()
          filter.type = 'bandpass'
          filter.frequency.value = 2600
          filter.Q.value = 0.5
          source = context.createBufferSource()
          source.buffer = createVinylNoiseBuffer(context)
          source.loop = true
          source.connect(filter)
          filter.connect(nodes.noiseGain)
          source.start()
        }
        rampParam(context, nodes.noiseGain.gain, amount ** 1.4 * 0.55, 0.12)
        return
      }

      rampParam(context, nodes.noiseGain.gain, 0, 0.12)
      if (source) release.schedule(teardown)
    },
    dispose: () => {
      release.cancel()
      teardown()
    },
  }
}
