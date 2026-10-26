import { useEffect } from 'react'
import type { MotionValue } from 'motion/react'
import { audioBands, audioPower, currentTime as previewTime, lyricCurrentTime } from '../upstream/adapters/hostRuntime'
import type { FoliaAudioSignals } from './foliaAudioContext'

/**
 * 把舞台的歌词时钟与音频电平转发给窗口读的那组 MotionValue。
 *
 * 上游这些信号是全局单例（`stores/motionSignals`），播放页、歌词样式窗口的实时预览、
 * 视频层都订阅同一份；本仓的时钟与音频由舞台持有，所以在这里单向镜像过去：
 *   · 窗口的「实时」预览用它对照当前歌曲与播放位置；
 *   · 视频层用 `currentTime` 对齐与判定跳转。
 *
 * 只订阅变化、不自建循环：舞台暂停时这些值自然停住。
 */
export function useMirrorPreviewSignals(currentTime: MotionValue<number>, audio: FoliaAudioSignals) {
  useEffect(() => {
    // 音频信号缺失（舞台未接音频 / 测试替身）时只镜像时钟。
    if (!audio?.audioPower || !audio.audioBands) {
      const copyTime = () => {
        const seconds = currentTime.get()
        previewTime.set(seconds)
        lyricCurrentTime.set(seconds)
      }
      copyTime()
      return currentTime.on('change', copyTime)
    }
    const copy = () => {
      const seconds = currentTime.get()
      if (previewTime.get() !== seconds) previewTime.set(seconds)
      if (lyricCurrentTime.get() !== seconds) lyricCurrentTime.set(seconds)
    }
    copy()
    const stops = [currentTime.on('change', copy)]

    const mirror = (from: MotionValue<number>, to: MotionValue<number>) => {
      to.set(from.get())
      stops.push(from.on('change', (value) => to.set(value)))
    }
    mirror(audio.audioPower, audioPower)
    mirror(audio.audioBands.bass, audioBands.bass)
    mirror(audio.audioBands.lowMid, audioBands.lowMid)
    mirror(audio.audioBands.mid, audioBands.mid)
    mirror(audio.audioBands.vocal, audioBands.vocal)
    mirror(audio.audioBands.treble, audioBands.treble)
    const sourceSpectrum = audio.audioBands.spectrum
    const targetSpectrum = audioBands.spectrum
    if (sourceSpectrum && targetSpectrum) {
      targetSpectrum.set(sourceSpectrum.get())
      stops.push(sourceSpectrum.on('change', (value) => targetSpectrum.set(value)))
    }

    return () => stops.forEach((stop) => stop())
  }, [audio, currentTime])
}
