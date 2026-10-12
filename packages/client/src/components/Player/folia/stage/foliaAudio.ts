import { motionValue } from 'motion/react'
import { useEffect, useMemo } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  disposeAudioAnalyser,
  ensureAudioAnalyser,
  readAudioBands,
  stepAudioFrame,
} from '../../mineradio/shared/AudioAnalyser'
import type { AudioBands } from '../types'

// One driver per active stage; only MotionValues change on a frame, never React state.
export function useFoliaAudio(paused: boolean) {
  const fps = useSettingsStore((s) => s.bgFps)
  const signals = useMemo(
    () => ({
      audioPower: motionValue(0),
      audioBands: {
        bass: motionValue(0),
        lowMid: motionValue(0),
        mid: motionValue(0),
        vocal: motionValue(0),
        treble: motionValue(0),
      } satisfies AudioBands,
    }),
    [],
  )
  useEffect(() => {
    if (paused) {
      signals.audioPower.set(0)
      Object.values(signals.audioBands).forEach((value) => value.set(0))
      return
    }
    let handle = 0
    let last = 0
    const frame = (now: number) => {
      const elapsed = now - last
      if (elapsed >= 1000 / fps) {
        last = now
        ensureAudioAnalyser()
        stepAudioFrame(Math.min(elapsed / 1000, 0.1), usePlayerStore.getState().currentTime, true)
        const sample = readAudioBands()
        signals.audioPower.set(sample.energy * 255)
        signals.audioBands.bass.set(sample.bass * 255)
        signals.audioBands.lowMid.set(sample.sonic.lowMid * 255)
        signals.audioBands.mid.set(sample.mid * 255)
        signals.audioBands.vocal.set(sample.vocal * 255)
        signals.audioBands.treble.set(sample.treble * 255)
      }
      handle = requestAnimationFrame(frame)
    }
    handle = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(handle)
      disposeAudioAnalyser()
    }
  }, [fps, paused, signals])
  return signals
}
