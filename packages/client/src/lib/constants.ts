// ---------------------------------------------------------------------------
// Client-side timing constants (ms / s)
// ---------------------------------------------------------------------------

/** Deduplication window for PLAYER_PLAY events */
export const PLAYER_PLAY_DEDUP_MS = 2000

/** Throttle interval for currentTime store updates */
export const CURRENT_TIME_THROTTLE_MS = 100

/** Interval for client-initiated sync requests (drift correction) */
export const SYNC_REQUEST_INTERVAL_MS = 1_000

/** Logical drift target for the pitch-preserving tempo controller. */
export const DRIFT_DEAD_ZONE_MS = 5

/** Proportional gain for SoundTouch tempo correction. */
export const DRIFT_TEMPO_KP = 0.15

/** Maximum tempo correction; SoundTouch compensates pitch in the worklet. */
export const MAX_TEMPO_ADJUSTMENT = 0.01

/** Drift threshold (ms) before hard-seeking to correct position */
export const DRIFT_SEEK_THRESHOLD_MS = 500

/** EMA smoothing factor for drift measurements (0–1, higher = more responsive). */
export const DRIFT_SMOOTH_ALPHA = 0.35

/** Extra margin (ms) added to the median RTT when computing the adaptive
 *  hard-seek threshold.  Final threshold = max(DRIFT_SEEK_THRESHOLD_MS,
 *  medianRTT + DRIFT_SEEK_RTT_MARGIN_MS).  This prevents high-latency
 *  NTP jitter from repeatedly triggering hard seeks. */
export const DRIFT_SEEK_RTT_MARGIN_MS = 250

/** Number of consecutive sync responses whose smoothed drift exceeds
 *  the hard-seek threshold before actually seeking.  Prevents a single
 *  noisy measurement from causing an audible jump. */
export const HARD_SEEK_CONFIRM_COUNT = 2

/** Fade duration used to mask the exceptional hard correction path. */
export const HARD_SEEK_FADE_MS = 60

/** Safety clamp for network delay estimation (seconds) — prevents clock-skew outliers */
export const MAX_NETWORK_DELAY_S = 5

/** Safety timeout for lobby action loading state */
export const ACTION_LOADING_TIMEOUT_MS = 15_000
