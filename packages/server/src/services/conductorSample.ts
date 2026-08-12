/**
 * Resolve the server-time anchor that was sampled together with a conductor's
 * media position. Keeping both values on the same instant preserves the room's
 * playback zero point; receive-time anchoring introduces transport bias.
 */
export function resolveConductorSampleTimestamp(hostServerTime: number | undefined, serverNow: number): number {
  return hostServerTime && Math.abs(hostServerTime - serverNow) < 10_000 ? hostServerTime : serverNow
}
