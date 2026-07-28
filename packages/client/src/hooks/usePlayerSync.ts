import { getServerTime, isCalibrated, getMedianRTT } from '@/lib/clockSync'
import {
  DRIFT_SEEK_THRESHOLD_MS,
  DRIFT_DEAD_ZONE_MS,
  DRIFT_TEMPO_KP,
  MAX_TEMPO_ADJUSTMENT,
  DRIFT_SMOOTH_ALPHA,
  MAX_NETWORK_DELAY_S,
  DRIFT_SEEK_RTT_MARGIN_MS,
  HARD_SEEK_CONFIRM_COUNT,
} from '@/lib/constants'
import { useSocketContext } from '@/providers/socket-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ScheduledPlayState } from '@music-together/shared'
import { EVENTS } from '@music-together/shared'
import type { Howl } from 'howler'
import { useEffect, useRef, type RefObject } from 'react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the delay (ms) until `serverTimeToExecute`, using our
 * NTP-calibrated clock.  Returns 0 if the time has already passed.
 * Falls back to 0 (immediate execution) when NTP is not yet calibrated
 * to avoid wildly inaccurate scheduling from uncorrected local clocks.
 */
function scheduleDelay(serverTimeToExecute: number): number {
  if (!isCalibrated()) return 0
  return Math.max(0, serverTimeToExecute - getServerTime())
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages playback sync via **event-driven Scheduled Execution**
 * with periodic **pitch-preserving drift correction + EMA smoothing**:
 *
 *   small drift           -> SoundTouch tempo correction (max +/-1%)
 *   sustained large drift -> direct seek correction (rare)
 *
 * The EMA low-pass filter prevents a single noisy network sample from
 * triggering a seek. Native uncorrected playback rate is never used.
 */
export function usePlayerSync(
  howlRef: RefObject<Howl | null>,
  soundIdRef: RefObject<number | undefined>,
  schedulePlayback: (targetTime: number, executeAt: number) => void,
  cancelScheduledPlayback: () => void,
  pausePlayback: (position: number) => void,
  setPlaybackTempo: (tempo: number) => void,
) {
  const { socket } = useSocketContext()
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime)
  const syncPacketIntervalSeconds = useSettingsStore((s) => s.syncPacketIntervalSeconds)

  // Pending scheduled action timers (so we can cancel on unmount / new action)
  const scheduledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Monotonic action ID — guards against stale setTimeout(fn, 0) callbacks
  // when rapid events arrive in the same event loop tick.
  const actionIdRef = useRef(0)
  // EMA-smoothed drift value (seconds) — persists across sync responses
  const smoothedDriftRef = useRef(0)
  // When true, next sync response seeds EMA directly instead of blending,
  // avoiding the cold-start lag after pause/resume/new-track.
  const emaColdStartRef = useRef(true)
  // Consecutive hard-seek triggers — require HARD_SEEK_CONFIRM_COUNT before actually seeking
  const hardSeekCountRef = useRef(0)

  const clearScheduled = () => {
    if (scheduledTimerRef.current) {
      clearTimeout(scheduledTimerRef.current)
      scheduledTimerRef.current = null
    }
  }

  // -----------------------------------------------------------------------
  // Scheduled action handlers
  // -----------------------------------------------------------------------
  useEffect(() => {
    // -- SEEK ---------------------------------------------------------------
    const onSeek = (data: { playState: ScheduledPlayState }) => {
      clearScheduled()
      const id = ++actionIdRef.current
      const delay = scheduleDelay(data.playState.serverTimeToExecute)

      scheduledTimerRef.current = setTimeout(() => {
        if (actionIdRef.current !== id) return // stale callback
        if (howlRef.current) {
          howlRef.current.seek(data.playState.currentTime)
        }
        setCurrentTime(data.playState.currentTime)
        setPlaybackTempo(1)
        smoothedDriftRef.current = 0
        emaColdStartRef.current = true
        // Keep roomStore.playState in sync for recovery effect
        useRoomStore.getState().updateRoom({
          playState: {
            isPlaying: data.playState.isPlaying,
            currentTime: data.playState.currentTime,
            serverTimestamp: data.playState.serverTimestamp,
          },
        })
      }, delay)
    }

    // -- PAUSE --------------------------------------------------------------
    const onPause = (data: { playState: ScheduledPlayState }) => {
      clearScheduled()
      cancelScheduledPlayback()
      const id = ++actionIdRef.current
      const delay = scheduleDelay(data.playState.serverTimeToExecute)

      scheduledTimerRef.current = setTimeout(() => {
        if (actionIdRef.current !== id) return // stale callback
        if (howlRef.current) {
          pausePlayback(data.playState.currentTime)
          setCurrentTime(data.playState.currentTime)
        }
        // Reset drift state — paused means no drift
        smoothedDriftRef.current = 0
        emaColdStartRef.current = true
        usePlayerStore.getState().setSyncDrift(0)
        setPlaybackTempo(1)
        // Keep roomStore.playState in sync for recovery effect
        useRoomStore.getState().updateRoom({
          playState: {
            isPlaying: data.playState.isPlaying,
            currentTime: data.playState.currentTime,
            serverTimestamp: data.playState.serverTimestamp,
          },
        })
      }, delay)
    }

    // -- RESUME -------------------------------------------------------------
    const onResume = (data: { playState: ScheduledPlayState }) => {
      clearScheduled()
      const id = ++actionIdRef.current
      const delay = scheduleDelay(data.playState.serverTimeToExecute)

      if (howlRef.current) {
        schedulePlayback(data.playState.currentTime, data.playState.serverTimeToExecute)
      }

      scheduledTimerRef.current = setTimeout(() => {
        if (actionIdRef.current !== id) return // stale callback
        if (!howlRef.current) return
        smoothedDriftRef.current = 0
        emaColdStartRef.current = true
        setPlaybackTempo(1)
        // Keep roomStore.playState in sync for recovery effect
        useRoomStore.getState().updateRoom({
          playState: {
            isPlaying: data.playState.isPlaying,
            currentTime: data.playState.currentTime,
            serverTimestamp: data.playState.serverTimestamp,
          },
        })
      }, delay)
    }

    // -- NEW TRACK (PLAYER_PLAY) ---------------------------------------------
    // When a new track loads, cancel any pending action from the previous track
    // so it doesn't accidentally seek/pause/resume the new Howl instance.
    const onPlay = () => {
      clearScheduled()
      ++actionIdRef.current // invalidate any pending stale callbacks
      hardSeekCountRef.current = 0
      smoothedDriftRef.current = 0
      emaColdStartRef.current = true
      setPlaybackTempo(1)
    }

    // -- SYNC RESPONSE (proportional drift correction + EMA smoothing) ------
    const onSyncResponse = (data: { currentTime: number; isPlaying: boolean; serverTimestamp: number }) => {
      if (!howlRef.current) return
      if (!howlRef.current.playing()) return
      if (!isCalibrated()) return

      // Use NTP-calibrated server time for accurate delay estimation
      const networkDelaySec = Math.max(
        0,
        Math.min(MAX_NETWORK_DELAY_S, (getServerTime() - data.serverTimestamp) / 1000),
      )
      const expectedTime = data.currentTime + (data.isPlaying ? networkDelaySec : 0)

      const currentSeek = howlRef.current.seek() as number
      const rawDrift = currentSeek - expectedTime

      // EMA low-pass filter: smooths noisy measurements to prevent oscillation.
      // On cold start (after pause/resume/new-track), seed with raw value
      // directly so the first correction is immediate, not dampened by stale 0.
      if (emaColdStartRef.current) {
        smoothedDriftRef.current = rawDrift
        emaColdStartRef.current = false
      } else {
        smoothedDriftRef.current = DRIFT_SMOOTH_ALPHA * rawDrift + (1 - DRIFT_SMOOTH_ALPHA) * smoothedDriftRef.current
      }
      const sd = smoothedDriftRef.current
      const absDrift = Math.abs(sd)

      // Update store with smoothed value so UI shows stable drift reading
      usePlayerStore.getState().setSyncDrift(sd)

      // Adaptive hard-seek threshold: on high-latency links the NTP offset
      // error (asymmetric routing) and extrapolation jitter can trigger
      // unnecessary backward jumps on a static threshold.
      // Raising the threshold proportionally to the observed RTT avoids this.
      const rttBasedThreshold = (getMedianRTT() + DRIFT_SEEK_RTT_MARGIN_MS) / 1000
      const hardSeekThreshold = Math.max(DRIFT_SEEK_THRESHOLD_MS / 1000, rttBasedThreshold)

      if (absDrift > hardSeekThreshold) {
        // Require HARD_SEEK_CONFIRM_COUNT consecutive triggers to avoid
        // acting on a single noisy measurement.
        hardSeekCountRef.current++
        if (hardSeekCountRef.current < HARD_SEEK_CONFIRM_COUNT) return
        // Confirmed: large sustained drift — hard seek
        hardSeekCountRef.current = 0
        const howl = howlRef.current
        const soundId = soundIdRef.current
        const restoreVolume = usePlayerStore.getState().volume
        setPlaybackTempo(1)

        // Howler's HTML5 seek briefly pauses and asynchronously restarts the
        // media element. Pre-seek fading can therefore strand the sound at
        // volume 0 when playback is temporarily reported as paused or the
        // callback is cancelled. Seek directly and always restore the latest
        // user volume so a correction can never leave the track muted.
        if (soundId === undefined) howl.seek(expectedTime)
        else howl.seek(expectedTime, soundId)
        if (soundId === undefined) howl.volume(restoreVolume)
        else howl.volume(restoreVolume, soundId)
        setCurrentTime(expectedTime)
        smoothedDriftRef.current = 0
        emaColdStartRef.current = true
      } else if (absDrift > DRIFT_DEAD_ZONE_MS / 1000) {
        hardSeekCountRef.current = 0
        const adjustment = clamp(sd * DRIFT_TEMPO_KP, MAX_TEMPO_ADJUSTMENT)
        setPlaybackTempo(1 - adjustment)
      } else {
        hardSeekCountRef.current = 0
        setPlaybackTempo(1)
      }
    }

    socket.on(EVENTS.PLAYER_SEEK, onSeek)
    socket.on(EVENTS.PLAYER_PAUSE, onPause)
    socket.on(EVENTS.PLAYER_RESUME, onResume)
    socket.on(EVENTS.PLAYER_PLAY, onPlay)
    socket.on(EVENTS.PLAYER_SYNC_RESPONSE, onSyncResponse)

    return () => {
      clearScheduled()
      socket.off(EVENTS.PLAYER_SEEK, onSeek)
      socket.off(EVENTS.PLAYER_PAUSE, onPause)
      socket.off(EVENTS.PLAYER_RESUME, onResume)
      socket.off(EVENTS.PLAYER_PLAY, onPlay)
      socket.off(EVENTS.PLAYER_SYNC_RESPONSE, onSyncResponse)
    }
  }, [
    socket,
    howlRef,
    soundIdRef,
    setCurrentTime,
    schedulePlayback,
    cancelScheduledPlayback,
    pausePlayback,
    setPlaybackTempo,
  ])

  // -----------------------------------------------------------------------
  // Every client, including the room host, follows the server-owned timeline.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const requestSyncIfPlaying = () => {
      if (!socket.connected || !howlRef.current?.playing()) return
      socket.emit(EVENTS.PLAYER_SYNC_REQUEST)
    }

    let visibilityFollowUp: ReturnType<typeof setTimeout> | null = null
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      requestSyncIfPlaying()
      // A second close sample confirms a real post-background drift without
      // returning to the old constant one-request-per-second traffic pattern.
      visibilityFollowUp = setTimeout(requestSyncIfPlaying, 250)
    }
    const interval = setInterval(requestSyncIfPlaying, syncPacketIntervalSeconds * 1000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(interval)
      if (visibilityFollowUp) clearTimeout(visibilityFollowUp)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [socket, howlRef, syncPacketIntervalSeconds])
}
