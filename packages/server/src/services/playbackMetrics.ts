export interface PlaybackMetrics {
  autoFallbackAttempts: number
  autoFallbackSuccess: number
  autoFallbackFailed: number
  manualSourceSwitches: number
  automaticSourceSwitches: number
  sourceSwitchFailed: number
  mediaFallbackRequests: number
}

const metrics: PlaybackMetrics = {
  autoFallbackAttempts: 0,
  autoFallbackSuccess: 0,
  autoFallbackFailed: 0,
  manualSourceSwitches: 0,
  automaticSourceSwitches: 0,
  sourceSwitchFailed: 0,
  mediaFallbackRequests: 0,
}

export function getPlaybackMetrics(): PlaybackMetrics {
  return { ...metrics }
}

export function recordAutoFallbackAttempt(): void {
  metrics.autoFallbackAttempts += 1
}

export function recordAutoFallbackSuccess(): void {
  metrics.autoFallbackSuccess += 1
}

export function recordAutoFallbackFailed(): void {
  metrics.autoFallbackFailed += 1
}

export function recordSourceSwitch(trigger: 'manual' | 'automatic'): void {
  if (trigger === 'manual') metrics.manualSourceSwitches += 1
  else metrics.automaticSourceSwitches += 1
}

export function recordSourceSwitchFailed(): void {
  metrics.sourceSwitchFailed += 1
}

export function recordMediaFallbackRequest(): void {
  metrics.mediaFallbackRequests += 1
}
