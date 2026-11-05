/**
 * 上游 `services/analysis/modelAvailability` 的宿主版本。
 *
 * 拍点始终有数据：本地离线分析是默认实现，开启高精度时再换成 beat_this。
 * 鼓点 / 人声由「混音特征分析」提供（开启真分轨时改用 htdemucs），所以
 * htdemucs 的可用性跟随该开关，避免设置页在效果已经工作时仍提示“缺少模型”。
 */
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'

export interface ModelAvailability {
    beat_this: boolean
    htdemucs: boolean
    htdemucs_gpu: boolean
}

const availability = (featuresEnabled: boolean): ModelAvailability => ({
    beat_this: true,
    htdemucs: featuresEnabled,
    htdemucs_gpu: featuresEnabled,
})

let snapshot = availability(useAudioSettingsStore.getState().trackFeaturesEnabled)
const listeners = new Set<() => void>()

useAudioSettingsStore.subscribe((state, previous) => {
    if (state.trackFeaturesEnabled === previous.trackFeaturesEnabled) return
    snapshot = availability(state.trackFeaturesEnabled)
    for (const listener of listeners) listener()
})

export const modelsPresent = (): ModelAvailability => snapshot

export const subscribeModelAvailability = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
