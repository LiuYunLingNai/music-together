import type { LoudnessInfo, ReplayGainMode } from '@/services/beatFx/offlineBeatAnalysis/loudness'
import { recordWholeTrackGain, replayGainLinearFor, VOLUME_BALANCE_TARGET_DB } from './volumeBalance'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'

/**
 * 当前曲目的响度增益。分析完成时发布，切歌/卸载时清空；音频图直接读这里。
 *
 * 宿主没有音源侧的 ReplayGain 标签，增益来自离线分析里顺带算出的积分响度。
 */

let currentLoudness: LoudnessInfo | null = null
const listeners = new Set<(linear: number) => void>()

const notify = (): void => {
  const linear = getReplayGainLinear()
  for (const listener of listeners) listener(linear)
}

export const getReplayGainLinear = (): number =>
  replayGainLinearFor(currentLoudness, useAudioSettingsStore.getState().replayGainMode)

export const publishTrackLoudness = (loudness: LoudnessInfo | null | undefined): void => {
  if (!loudness) return
  currentLoudness = loudness
  recordWholeTrackGain(VOLUME_BALANCE_TARGET_DB - loudness.lufs)
  notify()
}

export const clearTrackLoudness = (): void => {
  if (currentLoudness === null) return
  currentLoudness = null
  notify()
}

export const subscribeReplayGain = (listener: (linear: number) => void): (() => void) => {
  listeners.add(listener)
  listener(getReplayGainLinear())
  return () => listeners.delete(listener)
}

useAudioSettingsStore.subscribe((state, previous) => {
  if (state.replayGainMode === previous.replayGainMode) return
  notify()
})

export type { LoudnessInfo, ReplayGainMode }
