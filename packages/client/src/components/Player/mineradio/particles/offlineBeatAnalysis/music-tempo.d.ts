/**
 * `music-tempo` 的类型声明。
 *
 * 包本身不带 `.d.ts`。这里只声明本项目用到的表面：
 * 构造签名 `new MusicTempo(mono, params)` 与两个只读字段。
 *
 * ★ 上游 vendor 里的 `music-tempo.min.js` 与 npm `music-tempo@1.0.3` 的
 *   `dist/browser/music-tempo.min.js` **字节完全相同**（14537 B，
 *   已 cmp 校验），因此这里的签名同时覆盖两条取用路径。
 */

declare module 'music-tempo' {
  export interface MusicTempoParams {
    bufferSize?: number
    hopSize?: number
    timeStep?: number
    minBeatInterval?: number
    maxBeatInterval?: number
    expiryTime?: number
  }

  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: MusicTempoParams)
    /** BPM —— 上游拿到的是 `.toFixed(3)` 的字符串，失败时为数字 −1。 */
    readonly tempo: string | number
    /** 拍点时间（秒）数组。 */
    readonly beats: number[]
  }
}
