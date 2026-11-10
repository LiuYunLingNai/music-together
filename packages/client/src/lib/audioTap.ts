/**
 * 音频分析节点的共享出口。
 *
 * ## 为什么需要这个文件
 *
 * 本项目的音频链路是：
 *
 *   HTMLMediaElement → createMediaElementSource → SoundTouch（worklet）→ destination
 *
 * 它**绕过了 `Howler.masterGain`**（HTML5 音频 + 自定义 worklet 路由）。
 * 因此把 `AnalyserNode` 接在 `Howler.masterGain` 上读到的永远是 0 ——
 * 这会表现为「视觉完全没有鼓点」，而且极难排查（引擎代码全对，就是没数据）。
 *
 * `timeStretch.ts` 在建立 SoundTouch 图时创建并注册一个只读 `AnalyserNode`；
 * 视觉层通过 `getAudioTapAnalyser()` 取用。
 *
 * 这是**只读**旁路：AnalyserNode 不接回 destination，只从 worklet 输出分支，
 * 因此不改变任何声音行为，也不触碰 SoundTouch / 变速 / 漂移校正。
 */

let analyser: AnalyserNode | null = null
/**
 * 低频专用分析节点：与 `analyser` 同源，但 `maxDecibels` 放宽到 0dB。
 *
 * 视觉背景要的是上游 Rust 侧那套「线性振幅 / 255」刻度；默认 `-30dB`
 * 上限会把响段整体钳在满字节，算出来的低频电平恒定，鼓点不再跳动。
 */
let lowFreqAnalyser: AnalyserNode | null = null
let revision = 0

/** 由 `timeStretch` 在建立音频图时调用。 */
export function publishStretchAnalyser(node: AnalyserNode | null): void {
  analyser = node
  // 即使复用同一个 HTMLMediaElement / AnalyserNode，先撤回再重新发布也代表
  // 已切到一条新的播放会话。revision 让视觉层能重置上一首歌的自适应阈值，
  // 避免安静歌曲沿用上一首高能歌曲的历史后长时间检测不到节拍。
  revision++
}

/** 由视觉层读取。未接线时返回 null（此时应静默降级，而不是报错）。 */
export function getAudioTapAnalyser(): AnalyserNode | null {
  return analyser
}

/** 与 `publishStretchAnalyser` 同生命周期发布，切歌时一并撤回。 */
export function publishLowFreqAnalyser(node: AnalyserNode | null): void {
  lowFreqAnalyser = node
}

export function getLowFreqAnalyser(): AnalyserNode | null {
  return lowFreqAnalyser
}

/** 当前 tap 发布代次；用于区分“舞台重挂载”和“真实音频源切换”。 */
export function getAudioTapRevision(): number {
  return revision
}
