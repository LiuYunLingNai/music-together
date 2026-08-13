/**
 * Resolve the server-time anchor that was sampled together with a conductor's
 * media position. Keeping both values on the same instant preserves the room's
 * playback zero point; receive-time anchoring introduces transport bias.
 *
 * The acceptance window is intentionally small: the client only attaches
 * `hostServerTime` while its NTP clock is calibrated (error bounded by
 * ~RTT/2 + jitter), so any sample further than this from the server clock is
 * either uncalibrated or from a stale era — anchor at receive time instead.
 */
const MAX_HOST_SERVER_TIME_SKEW_MS = 3_000

export function resolveConductorSampleTimestamp(hostServerTime: number | undefined, serverNow: number): number {
  if (!hostServerTime || Math.abs(hostServerTime - serverNow) >= MAX_HOST_SERVER_TIME_SKEW_MS) return serverNow
  return Math.min(hostServerTime, serverNow)
}
