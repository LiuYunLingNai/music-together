// ---------------------------------------------------------------------------
// Client-side timing constants (ms / s)
// ---------------------------------------------------------------------------

/** Deduplication window for PLAYER_PLAY events */
export const PLAYER_PLAY_DEDUP_MS = 2000

/** Throttle interval for currentTime store updates */
export const CURRENT_TIME_THROTTLE_MS = 100

/** User-configurable range for steady-state sync packets (seconds) */
export const SYNC_PACKET_INTERVAL_MIN_SECONDS = 1
export const SYNC_PACKET_INTERVAL_MAX_SECONDS = 60

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

/** Extra margin (ms) added to half the median RTT when computing the adaptive
 *  hard-seek threshold.  Final threshold = max(DRIFT_SEEK_THRESHOLD_MS,
 *  medianRTT / 2 + DRIFT_SEEK_RTT_MARGIN_MS).  This prevents high-latency
 *  NTP jitter from repeatedly triggering hard seeks. */
export const DRIFT_SEEK_RTT_MARGIN_MS = 250

/** Number of consecutive sync responses whose smoothed drift exceeds
 *  the hard-seek threshold before actually seeking.  Prevents a single
 *  noisy measurement from causing an audible jump. */
export const HARD_SEEK_CONFIRM_COUNT = 2

/** Safety clamp for network delay estimation (seconds) — prevents clock-skew outliers */
export const MAX_NETWORK_DELAY_S = 5

/** Safety timeout for lobby action loading state */
export const ACTION_LOADING_TIMEOUT_MS = 15_000
