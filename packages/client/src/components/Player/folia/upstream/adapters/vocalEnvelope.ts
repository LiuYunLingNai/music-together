/**
 * 上游 `services/analysis/vocalEnvelope` 的宿主版本。
 *
 * 上游从 htdemucs 的人声分离（Electron 主进程的 GPU 管线）得到逐帧人声包络，雾笺的「疏雨轻车」
 * 用它决定雨点密度与重音。本仓没有分离管线，这里恒为 null；雾笺随后的分支会退回混音的
 * 1-3.5 kHz 频带（见 `nebbiaHits.ts` 的说明），与上游缺人声轨时的行为一致。
 */
export const VOCAL_FPS = 50

export interface VocalEnvelope {
    fps: number
    /** Level per frame, dB. */
    db: Float32Array
    /** The track's loud singing, dB: the 97th percentile of `db`. */
    top: number
    /** Frames where a sung syllable starts, ascending. */
    onsets: Uint32Array
    /** The first frame read. Missing for the whole track. */
    from?: number
}

export const getVocalEnvelope = (key: string | null): VocalEnvelope | null => {
    void key
    return null
}
