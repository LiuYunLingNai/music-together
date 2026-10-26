/**
 * 上游 `services/analysis/drumHits` 的宿主版本。
 *
 * 上游在 Electron 主进程里用 htdemucs 的 GPU 分离出鼓组，再把 kick / snare / hat 的击打点
 * 交给时计的智能动感（`pendolo/usePendoloBeatFx.ts`）。本仓没有这个模型，也没有 GPU 分离管线。
 *
 * 上游自己写明了缺鼓点时的行为（`usePendoloBeatFx.ts` 顶部注释）：
 * 「没有鼓点 —— 还没读到、超出范围、无鼓的曲子、没有 htdemucs_gpu —— 时计就按拍点表播放。」
 * 因此这里让 `getDrumHits` 恒返回 null，时计自然走拍点那条分支：敲击波前与光环照常出现，
 * 只少了鼓组特有的鼓面起伏与倾斜。接口形状与上游逐字一致，将来接上真实分离时无需改动调用方。
 */
import type { MotionValue } from 'motion/react'

export type DrumHitKind = 0 | 1 | 2
export const DRUM_KICK: DrumHitKind = 0
export const DRUM_SNARE: DrumHitKind = 1
export const DRUM_HAT: DrumHitKind = 2

/** 上游同形：三条并行的定长数组 + 分离进度。 */
export interface DrumHits {
    times: Float64Array
    strengths: Float32Array
    kinds: Uint8Array
    /** 分离还没读完时，已知的最后一个时间点（秒）。 */
    until?: number
}

/** 本仓没有鼓组分离：恒为 null，时计按拍点表播放。 */
export const getDrumHits = (key: string | null): DrumHits | null => {
    void key
    return null
}

/** 上游用 MotionValue 发布鼓点进度；这里给一个恒为 null 的只读信号。 */
export type DrumHitsSignal = MotionValue<DrumHits | null>
