/**
 * 本机播放取数计数。只用于诊断面板，不参与任何播放决策。
 * 进程内累计，页面刷新清零；持久缓存的占用由 `mediaCache` 单独统计。
 */

export interface PlaybackDiagnostics {
  memoryHits: number
  persistentHits: number
  networkLoads: number
  networkFailures: number
  cacheWrites: number
  cacheWriteSkips: number
  prefetchHits: number
  prefetchRequests: number
  blobPreloads: number
}

const counters: PlaybackDiagnostics = {
  memoryHits: 0,
  persistentHits: 0,
  networkLoads: 0,
  networkFailures: 0,
  cacheWrites: 0,
  cacheWriteSkips: 0,
  prefetchHits: 0,
  prefetchRequests: 0,
  blobPreloads: 0,
}

export const getPlaybackDiagnostics = (): PlaybackDiagnostics => ({ ...counters })

export const resetPlaybackDiagnostics = (): void => {
  for (const key of Object.keys(counters) as Array<keyof PlaybackDiagnostics>) counters[key] = 0
}

type Counter = keyof PlaybackDiagnostics

export const notePlayback = (counter: Counter, delta = 1): void => {
  counters[counter] += delta
}
