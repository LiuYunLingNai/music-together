import { isHtdemucsReady } from '@/services/analysis/htdemucsModel'
import { isBeatThisReady } from '@/services/analysis/beatThisModel'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'

/**
 * 宿主版上游 `transitionCapabilities()`：把“能不能跑”拆成节拍网格与真分轨两件事。
 * 宿主没有 Electron 桥，`desktop` 恒为 false；分轨能否跑取决于 WebGPU 与模型状态。
 */
export interface TransitionCapabilities {
  /** 模型给出的节拍网格（BeatThis）。 */
  beatGrid: boolean
  /** 真分轨（htdemucs）。 */
  stems: boolean
  full: boolean
  desktop: boolean
}

/** 同步快照，供设置页 / 状态栏显示：本会话已加载完成才算可用。 */
export const transitionCapabilities = (): TransitionCapabilities => {
  const beatGrid = isBeatThisReady()
  const stems = isHtdemucsReady()
  return { beatGrid, stems, full: beatGrid && stems, desktop: false }
}

export const webgpuPresent = (): boolean =>
  typeof navigator !== 'undefined' && 'gpu' in navigator

/**
 * 自动混音的 stem 准备此刻该不该跑：两侧设置开关 + 浏览器有 WebGPU。
 * 模型是否已加载/是否刚失败不在这里判断：`loadHtdemucsModel` 自带 10 分钟
 * 冷却，直接尝试才能在一次失败后自动恢复；之前用 `phase === 'unavailable'`
 * 拦截会让一次临时失败永久关掉真分轨。
 */
export const canStartStemPrep = (): boolean => {
  const { trackFeaturesEnabled, highPrecisionStems } = useAudioSettingsStore.getState()
  if (!trackFeaturesEnabled || !highPrecisionStems) return false
  return webgpuPresent()
}
