/** Expected playback position when a scheduled play starts after its target time. */
export function getScheduledPlaybackPosition(
  baseTime: number,
  serverTimeToExecute: number,
  currentServerTime: number,
): number {
  return baseTime + Math.max(0, currentServerTime - serverTimeToExecute) / 1000
}

/** Adaptive hard-seek threshold based on NTP one-way delay uncertainty. */
export function getHardSeekThresholdMs(baseThresholdMs: number, medianRttMs: number, marginMs: number): number {
  return Math.max(baseThresholdMs, medianRttMs / 2 + marginMs)
}

/** Expected authoritative position carried by a sync response at receive time. */
export function getSyncExpectedPosition(
  currentTime: number,
  isPlaying: boolean,
  responseServerTimestamp: number,
  currentServerTime: number,
  maxNetworkDelaySeconds: number,
): number {
  if (!isPlaying) return currentTime
  const networkDelaySeconds = Math.max(
    0,
    Math.min(maxNetworkDelaySeconds, (currentServerTime - responseServerTimestamp) / 1000),
  )
  return currentTime + networkDelaySeconds
}
