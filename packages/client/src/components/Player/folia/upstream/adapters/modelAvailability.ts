/**
 * 上游 `services/analysis/modelAvailability` 的宿主版本。
 *
 * 上游在 Electron 主进程里跑 beat_this / htdemucs 两个 ONNX 模型，窗口据此把读不到数据源的效果
 * 标成不可用。本仓没有这两个模型（拍点走 `services/beatFx/offlineBeatAnalysis`，鼓组分离没有
 * 对应实现），所以 htdemucs 恒为不可用；beat_this 用离线拍点替代，按可用处理。
 */
export interface ModelAvailability {
    beat_this: boolean
    htdemucs: boolean
    htdemucs_gpu: boolean
}

const UNAVAILABLE: ModelAvailability = { beat_this: true, htdemucs: false, htdemucs_gpu: false }

export const modelsPresent = (): ModelAvailability => UNAVAILABLE

/** 模型可用性不会在运行中变化，订阅是空操作。 */
export const subscribeModelAvailability = (listener: () => void): (() => void) => { void listener; return () => {} }
