let cancelPendingPlay: (() => void) | null = null

/** Register the pending PLAYER_PLAY timer so newer control actions can cancel it. */
export function registerPendingPlayCancel(cancel: () => void): () => void {
  cancelPendingPlay?.()
  cancelPendingPlay = cancel
  return () => {
    if (cancelPendingPlay === cancel) cancelPendingPlay = null
  }
}

/** Cancel a scheduled track load superseded by pause/resume/seek/new play. */
export function cancelScheduledPlay(): void {
  cancelPendingPlay?.()
}
