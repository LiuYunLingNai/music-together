/** Expected playback position when a scheduled action runs after its target time. */
export function getScheduledPlaybackPosition(
  baseTime: number,
  serverTimeToExecute: number,
  currentServerTime: number,
): number {
  return baseTime + Math.max(0, currentServerTime - serverTimeToExecute) / 1000
}

/** Hard-seek threshold based on one-way NTP uncertainty rather than full RTT. */
export function getHardSeekThresholdMs(baseThresholdMs: number, medianRttMs: number, marginMs: number): number {
  return Math.max(baseThresholdMs, medianRttMs / 2 + marginMs)
}

/** Advance an authoritative sync sample by its bounded receive delay. */
export function getSyncExpectedPosition(
  currentTime: number,
  isPlaying: boolean,
  responseServerTimestamp: number,
  currentServerTime: number,
  maxNetworkDelaySeconds: number,
): number {
  if (!isPlaying) return currentTime
  const delaySeconds = Math.max(
    0,
    Math.min(maxNetworkDelaySeconds, (currentServerTime - responseServerTimestamp) / 1000),
  )
  return currentTime + delaySeconds
}

export function isDriftSettled(driftAbsSeconds: number, deadZoneMs: number): boolean {
  return driftAbsSeconds < deadZoneMs / 1000
}

/** Slow polling only after several consecutive settled samples. */
export function getSyncRequestIntervalMs(
  isPlaying: boolean,
  lowDriftStreak: number,
  fastIntervalMs: number,
  settledIntervalMs: number,
  slowdownConfirmCount: number,
): number {
  if (!isPlaying || lowDriftStreak < slowdownConfirmCount) return fastIntervalMs
  return Math.max(fastIntervalMs, settledIntervalMs)
}
