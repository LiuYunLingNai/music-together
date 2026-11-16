/**
 * 上游 `src/services/automix/tempoBend.ts` 的移植：让出歌按入歌的速度播放，
 * 音高不变。媒体元素默认 `preservesPitch = true`，这里显式写出这个依赖，
 * 因为元素会被回收复用。
 */
export const applyTempoBend = (element: HTMLMediaElement | null, rate: number): number => {
  if (!element) return 1
  if (!(rate > 0) || Math.abs(rate - 1) < 0.001) {
    resetTempoBend(element)
    return 1
  }
  element.preservesPitch = true
  element.playbackRate = rate
  return rate
}

export const resetTempoBend = (element: HTMLMediaElement | null): void => {
  if (element && element.playbackRate !== 1) element.playbackRate = 1
}
