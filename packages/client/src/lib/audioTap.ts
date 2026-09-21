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

/** 由 `timeStretch` 在建立音频图时调用。 */
export function publishStretchAnalyser(node: AnalyserNode | null): void {
  analyser = node
}

/** 由视觉层读取。未接线时返回 null（此时应静默降级，而不是报错）。 */
export function getAudioTapAnalyser(): AnalyserNode | null {
  return analyser
}
