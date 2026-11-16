/**
 * Howler 用默认参数创建 AudioContext（latencyHint = interactive，最小缓冲）。
 * 本应用没有交互式低延迟需求，而舞台渲染/分析会抢占 CPU/GPU，最小缓冲最容易爆音，
 * 因此在 Howler 创建之前把默认提示改成 playback。必须早于任何 Howl 的创建。
 */
const NativeAudioContext: typeof AudioContext | undefined =
  typeof window !== 'undefined' ? window.AudioContext : undefined

if (NativeAudioContext && !(NativeAudioContext as unknown as { __mtPlayback?: boolean }).__mtPlayback) {
  class PlaybackAudioContext extends NativeAudioContext {
    static __mtPlayback = true
    constructor(options?: AudioContextOptions) {
      super({ latencyHint: 'playback', ...options })
    }
  }
  window.AudioContext = PlaybackAudioContext
}

export {}
