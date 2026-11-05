import { rampParam } from './params'
import { createReleaseTimer, type AudioEffectBranch } from './release'
import { WOW_BASE_DELAY_SECONDS, type AudioEffectNodes } from './nodes'

export const createWowBranch = (context: AudioContext, nodes: AudioEffectNodes): AudioEffectBranch => {
  let wowLfo: OscillatorNode | null = null
  let flutterLfo: OscillatorNode | null = null
  let wowDepth: GainNode | null = null
  let flutterDepth: GainNode | null = null
  const release = createReleaseTimer()

  const teardown = (): void => {
    for (const oscillator of [wowLfo, flutterLfo]) {
      if (!oscillator) continue
      try {
        oscillator.stop()
      } catch {
        // 已随 AudioContext 停止。
      }
      oscillator.disconnect()
    }
    wowDepth?.disconnect()
    flutterDepth?.disconnect()
    wowLfo = null
    flutterLfo = null
    wowDepth = null
    flutterDepth = null
  }

  const startOscillator = (frequency: number): { oscillator: OscillatorNode; depth: GainNode } => {
    const oscillator = context.createOscillator()
    oscillator.frequency.value = frequency
    const depth = context.createGain()
    depth.gain.value = 0
    oscillator.connect(depth)
    depth.connect(nodes.wowDelay.delayTime)
    oscillator.start()
    return { oscillator, depth }
  }

  return {
    set: (amount) => {
      if (amount > 0) {
        release.cancel()
        if (!wowLfo) {
          const wow = startOscillator(0.7)
          wowLfo = wow.oscillator
          wowDepth = wow.depth
          const flutter = startOscillator(6.8)
          flutterLfo = flutter.oscillator
          flutterDepth = flutter.depth
        }
        rampParam(context, nodes.wowDelay.delayTime, WOW_BASE_DELAY_SECONDS, 0.08)
        if (wowDepth) rampParam(context, wowDepth.gain, amount * 0.0045, 0.08)
        if (flutterDepth) rampParam(context, flutterDepth.gain, amount * 0.0006, 0.08)
        return
      }

      rampParam(context, nodes.wowDelay.delayTime, 0, 0.08)
      if (wowDepth && flutterDepth) {
        rampParam(context, wowDepth.gain, 0, 0.08)
        rampParam(context, flutterDepth.gain, 0, 0.08)
        release.schedule(teardown)
      }
    },
    dispose: () => {
      release.cancel()
      teardown()
    },
  }
}
