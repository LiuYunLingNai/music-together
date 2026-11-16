import { rampParam } from './params'
import { createReverbImpulse } from './sources'
import { createReleaseTimer, type AudioEffectBranch } from './release'
import type { AudioEffectNodes } from './nodes'

export const createReverbBranch = (context: AudioContext, nodes: AudioEffectNodes): AudioEffectBranch => {
  let convolver: ConvolverNode | null = null
  const release = createReleaseTimer()

  const teardown = (): void => {
    if (!convolver) return
    nodes.wetSend.disconnect(convolver)
    convolver.disconnect()
    convolver = null
  }

  return {
    set: (amount) => {
      if (amount > 0) {
        release.cancel()
        if (!convolver) {
          convolver = context.createConvolver()
          convolver.normalize = true
          convolver.buffer = createReverbImpulse(context)
          nodes.wetSend.connect(convolver)
          convolver.connect(nodes.wet)
        }
        rampParam(context, nodes.wet.gain, amount * 0.75, 0.08)
        rampParam(context, nodes.dry.gain, 1 - amount * 0.2, 0.08)
        return
      }

      rampParam(context, nodes.wet.gain, 0, 0.08)
      rampParam(context, nodes.dry.gain, 1, 0.08)
      if (convolver) release.schedule(teardown)
    },
    dispose: () => {
      release.cancel()
      teardown()
    },
  }
}
