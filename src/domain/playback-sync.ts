export interface PlaybackSyncAdjustment {
  playbackRate: number
  shouldSeek: boolean
}

export function playbackSyncAdjustment(
  driftSeconds: number,
  tempoSyncEnabled: boolean,
  hardSeekSyncEnabled: boolean,
): PlaybackSyncAdjustment {
  const absoluteDrift = Math.abs(driftSeconds)
  if (absoluteDrift > 0.8) {
    return { playbackRate: 1, shouldSeek: tempoSyncEnabled || hardSeekSyncEnabled }
  }
  if (tempoSyncEnabled && absoluteDrift > 0.05) {
    return { playbackRate: Math.max(0.99, Math.min(1.01, 1 - driftSeconds * 0.08)), shouldSeek: false }
  }
  return { playbackRate: 1, shouldSeek: false }
}
