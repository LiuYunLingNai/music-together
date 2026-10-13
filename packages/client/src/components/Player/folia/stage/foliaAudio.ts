import { motionValue, type MotionValue } from 'motion/react'
import { useEffect, useMemo } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  disposeAudioAnalyser,
  ensureAudioAnalyser,
  readAudioBands,
  readAudioSpectrum,
  stepAudioFrame,
} from '../../stages/AudioAnalyser'
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
        // 原始 FFT 频谱（0..255）。monet 的频谱叠层据此走上游的
        // raw-spectrum 快路径；未接线时保持空数组（band-profile 回退）。
        spectrum: motionValue(new Uint8Array(new ArrayBuffer(0))),
      } satisfies AudioBands,
    }),
    [],
  )
  useEffect(() => {
    if (paused) {
      signals.audioPower.set(0)
      Object.values(signals.audioBands).forEach((value) => {
        if (typeof value.set === 'function' && value !== signals.audioBands.spectrum) {
          ;(value as MotionValue<number>).set(0)
        }
      })
      signals.audioBands.spectrum.set(new Uint8Array(new ArrayBuffer(0)))
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
        /**
         * 上游 folia 的"静音呼吸"兜底（usePlaybackVisualizerBridge.ts:121-131）：
         * 播放中但能量持续为零（音量 0 / 数字静音段）时，所有频段喂一条
         * `sin(t)` 呼吸曲线 —— 画面保持轻柔起伏而不是死住。上游注释：
         * analyser 在音量之后，静音时"真实"信号就是零，呼吸即待机态。
         * mineradio 不用这个兜底（其上游靠静音地板让节拍引擎继续打点），
         * folia 的背景响应是低通平滑的，呼吸不会触发节拍类猛推动效。
         */
        const silent = sample.energy <= 0 && sample.bass <= 0 && sample.mid <= 0 && sample.treble <= 0
        if (silent) {
          const breath = (Math.sin(now / 2000) + 1) * 20
          signals.audioPower.set(breath)
          signals.audioBands.bass.set(breath)
          signals.audioBands.lowMid.set(breath)
          signals.audioBands.mid.set(breath)
          signals.audioBands.vocal.set(breath)
          signals.audioBands.treble.set(breath)
        } else {
          signals.audioPower.set(sample.energy * 255)
          signals.audioBands.bass.set(sample.bass * 255)
          signals.audioBands.lowMid.set(sample.sonic.lowMid * 255)
          signals.audioBands.mid.set(sample.mid * 255)
          signals.audioBands.vocal.set(sample.vocal * 255)
          signals.audioBands.treble.set(sample.treble * 255)
        }
        const spectrum = readAudioSpectrum()
        if (spectrum) signals.audioBands.spectrum.set(spectrum)
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
