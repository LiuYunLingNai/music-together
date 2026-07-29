import { useCallback, useEffect, useRef } from 'react'
import { Howl } from 'howler'
import type { Track } from '@music-together/shared'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { CURRENT_TIME_THROTTLE_MS } from '@/lib/constants'
import { toast } from 'sonner'
import { getServerTime } from '@/lib/clockSync'
import { SERVER_URL } from '@/lib/config'
import { attachTimeStretch, prepareDirectStreamForTimeStretch, type TimeStretchController } from '@/lib/timeStretch'

/** Max wait (ms) for Howler `unlock` event before giving up and skipping */
const PLAY_ERROR_TIMEOUT_MS = 3000

/** If playback reports playing() but currentTime doesn't advance for this
 *  many milliseconds, treat it as stalled (network drop mid-stream). */
const STALLED_TIMEOUT_MS = 8000

/** Short fade after a scheduled start masks the decoder's final seek. */
const SCHEDULED_START_FADE_MS = 120
const TRACK_CROSSFADE_MS = 80

interface ScheduledStart {
  howl: Howl
  targetTime: number
  executeAt: number
  onCommit?: () => void
}

/**
 * Manages a Howl audio instance with two-phase loading strategy:
 * Phase 1: Create Howl with volume=0 (silent)
 * Phase 2: onload → seek to target → delay → fade-in unmute
 */
export function useHowl(onTrackEnd: () => void) {
  const howlRef = useRef<Howl | null>(null)
  const soundIdRef = useRef<number | undefined>(undefined)
  const animFrameRef = useRef<number>(0)
  const syncReadyRef = useRef(false)
  const unmuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTimeUpdateRef = useRef(0)
  const stalledRef = useRef<{ lastSeek: number; since: number }>({ lastSeek: -1, since: 0 })
  const trackTitleRef = useRef<string>('')
  const retryRef = useRef(false)
  const scheduledStartRef = useRef<ScheduledStart | null>(null)
  const scheduledStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outgoingHowlRef = useRef<Howl | null>(null)
  const outgoingCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preparedTrackRef = useRef<Track | null>(null)
  const stretchRef = useRef<TimeStretchController | null>(null)
  const stretchReadyRef = useRef<Promise<TimeStretchController | null> | null>(null)

  // Use selectors for the one reactive value we need (volume sync effect)
  const volume = usePlayerStore((s) => s.volume)
  const playbackTempoSyncEnabled = useSettingsStore((s) => s.playbackTempoSyncEnabled)

  // Throttled time update loop with stalled detection
  const startTimeUpdate = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    stalledRef.current = { lastSeek: -1, since: 0 }
    const update = () => {
      if (howlRef.current && howlRef.current.playing()) {
        const now = performance.now()
        if (now - lastTimeUpdateRef.current >= CURRENT_TIME_THROTTLE_MS) {
          lastTimeUpdateRef.current = now
          const seekVal = howlRef.current.seek() as number
          usePlayerStore.getState().setCurrentTime(seekVal)

          // Stalled detection: if currentTime hasn't moved for STALLED_TIMEOUT_MS
          // while playing() is true, the stream likely broke mid-playback.
          const st = stalledRef.current
          if (Math.abs(seekVal - st.lastSeek) < 0.05) {
            if (st.since > 0 && now - st.since > STALLED_TIMEOUT_MS) {
              console.warn('Playback stalled, skipping track')
              toast.error('播放中断，已跳到下一首')
              stalledRef.current = { lastSeek: -1, since: 0 }
              onTrackEnd()
              return
            }
            // still stalled but not timed out yet — keep since
          } else {
            // time moved — reset stalled tracker
            stalledRef.current = { lastSeek: seekVal, since: now }
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(update)
    }
    animFrameRef.current = requestAnimationFrame(update)
  }, [onTrackEnd])

  const stopTimeUpdate = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
  }, [])

  const cancelScheduledPlayback = useCallback(() => {
    if (scheduledStartTimerRef.current) {
      clearTimeout(scheduledStartTimerRef.current)
      scheduledStartTimerRef.current = null
    }
    scheduledStartRef.current = null
  }, [])

  const disposeHowl = useCallback((howl: Howl | null) => {
    if (!howl) return
    try {
      howl.unload()
    } catch {
      /* ignore */
    }
  }, [])

  const pausePlayback = useCallback(
    (position: number) => {
      const pendingStart = scheduledStartRef.current
      cancelScheduledPlayback()
      const howl = howlRef.current
      if (howl) {
        if (howl.playing()) howl.pause(soundIdRef.current)
        howl.seek(position, soundIdRef.current)
      }
      if (pendingStart && preparedTrackRef.current) {
        usePlayerStore.getState().setCurrentTrack(preparedTrackRef.current)
        usePlayerStore.getState().setCurrentTime(position)
        const duration = howl?.duration()
        if (duration && Number.isFinite(duration)) usePlayerStore.getState().setDuration(duration)
        pendingStart.onCommit?.()
      }

      // A pause received during a pending track transition also stops the
      // outgoing track at the shared pause instant.
      if (outgoingCleanupTimerRef.current) {
        clearTimeout(outgoingCleanupTimerRef.current)
        outgoingCleanupTimerRef.current = null
      }
      disposeHowl(outgoingHowlRef.current)
      outgoingHowlRef.current = null
    },
    [cancelScheduledPlayback, disposeHowl],
  )

  const stopPlayback = useCallback(() => {
    cancelScheduledPlayback()
    if (outgoingCleanupTimerRef.current) {
      clearTimeout(outgoingCleanupTimerRef.current)
      outgoingCleanupTimerRef.current = null
    }
    const current = howlRef.current
    const outgoing = outgoingHowlRef.current
    disposeHowl(current)
    if (outgoing !== current) disposeHowl(outgoing)
    howlRef.current = null
    outgoingHowlRef.current = null
    preparedTrackRef.current = null
    soundIdRef.current = undefined
    stopTimeUpdate()
  }, [cancelScheduledPlayback, disposeHowl, stopTimeUpdate])

  const schedulePlayback = useCallback(
    (targetTime: number, executeAt: number, onCommit?: () => void) => {
      cancelScheduledPlayback()
      const howl = howlRef.current
      if (!howl) return

      // Keep the decoder silent until its position has been aligned. Slow
      // clients join the live timeline late instead of playing stale audio.
      howl.volume(0)
      scheduledStartRef.current = { howl, targetTime, executeAt, onCommit }

      const start = () => {
        scheduledStartTimerRef.current = null
        void (async () => {
          await stretchReadyRef.current
          if (scheduledStartRef.current?.howl !== howl || howlRef.current !== howl) return
          if (soundIdRef.current !== undefined) howl.play(soundIdRef.current)
          else soundIdRef.current = howl.play()
        })()
      }

      const delay = Math.max(0, executeAt - getServerTime())
      scheduledStartTimerRef.current = setTimeout(start, delay)
    },
    [cancelScheduledPlayback],
  )

  // Load and play a track
  const loadTrack = useCallback(
    (track: Track, seekTo?: number, deferCommit = false) => {
      cancelScheduledPlayback()
      if (unmuteTimerRef.current) {
        clearTimeout(unmuteTimerRef.current)
        unmuteTimerRef.current = null
      }
      // Clear any pending play-error timeout from the previous track so it
      // doesn't fire onTrackEnd() and skip the new track being loaded.
      if (playErrorTimerRef.current) {
        clearTimeout(playErrorTimerRef.current)
        playErrorTimerRef.current = null
      }

      if (howlRef.current) {
        // Keep one audible outgoing track alive while the replacement loads.
        // If another replacement arrives before commit, discard only the
        // superseded silent candidate.
        const outgoing = outgoingHowlRef.current
        if (outgoing && howlRef.current !== outgoing) {
          disposeHowl(howlRef.current)
        } else {
          outgoingHowlRef.current = howlRef.current
        }
        stopTimeUpdate()
      }

      syncReadyRef.current = false
      soundIdRef.current = undefined
      trackTitleRef.current = track.title
      preparedTrackRef.current = track
      stretchRef.current = null
      stretchReadyRef.current = null
      retryRef.current = false

      if (!track.streamUrl) return

      const currentVolume = usePlayerStore.getState().volume
      const playbackUrl =
        track.source === 'bilibili'
          ? `${SERVER_URL}/api/music/bilibili-audio-proxy?url=${encodeURIComponent(track.streamUrl)}&bvid=${encodeURIComponent(track.urlId)}`
          : track.source === 'kugou' || track.source === 'kugou_concept'
            ? `${SERVER_URL}/api/music/kugou-audio-proxy?url=${encodeURIComponent(track.streamUrl)}`
            : track.streamUrl
      const streamFormat = track.source === 'bilibili' ? ['m4a'] : ['flac', 'm4a', 'ogg', 'mp3']

      // Howler creates its HTMLMediaElement synchronously inside the
      // constructor. Configure CORS before it assigns the direct CDN URL so
      // Web Audio is allowed to consume the stream.
      const canTimeStretch = prepareDirectStreamForTimeStretch(playbackUrl)

      const howl = new Howl({
        src: [playbackUrl],
        html5: true,
        format: streamFormat,
        volume: 0,
        onload: () => {
          if (howlRef.current !== howl) return // Stale instance guard
          const d = howl.duration()
          if (!deferCommit && Number.isFinite(d) && d > 0) {
            usePlayerStore.getState().setDuration(d)
          }
          if (seekTo && seekTo > 0) howl.seek(seekTo)
          if (scheduledStartRef.current?.howl === howl) howl.volume(0)
          else howl.volume(currentVolume)
          if (!deferCommit) usePlayerStore.getState().setCurrentTime(seekTo ?? 0)
          syncReadyRef.current = true
        },
        onplay: (soundId) => {
          if (howlRef.current !== howl) return

          const scheduledStart = scheduledStartRef.current
          if (scheduledStart?.howl === howl) {
            const lateBy = Math.max(0, (getServerTime() - scheduledStart.executeAt) / 1000)
            const alignedTime = scheduledStart.targetTime + lateBy
            howl.volume(0, soundId)
            howl.seek(alignedTime, soundId)
            usePlayerStore.getState().setCurrentTrack(track)
            usePlayerStore.getState().setCurrentTime(alignedTime)
            const duration = howl.duration()
            if (Number.isFinite(duration) && duration > 0) {
              usePlayerStore.getState().setDuration(duration)
            }
            scheduledStart.onCommit?.()
            scheduledStartRef.current = null
            const outgoing = outgoingHowlRef.current
            if (outgoing && outgoing !== howl) {
              outgoingHowlRef.current = null
              outgoing.fade(outgoing.volume(), 0, TRACK_CROSSFADE_MS)
              if (outgoingCleanupTimerRef.current) clearTimeout(outgoingCleanupTimerRef.current)
              outgoingCleanupTimerRef.current = setTimeout(() => {
                outgoingCleanupTimerRef.current = null
                disposeHowl(outgoing)
              }, TRACK_CROSSFADE_MS)
            }
            if (unmuteTimerRef.current) clearTimeout(unmuteTimerRef.current)
            unmuteTimerRef.current = setTimeout(() => {
              if (howlRef.current !== howl) return
              const latestVolume = usePlayerStore.getState().volume
              howl.fade(0, latestVolume, SCHEDULED_START_FADE_MS, soundId)
              syncReadyRef.current = true
            }, 20)
          }
          usePlayerStore.getState().setIsPlaying(true)
          const dur = howl.duration()
          if (Number.isFinite(dur) && dur > 0) {
            usePlayerStore.getState().setDuration(dur)
          }
          startTimeUpdate()
        },
        onpause: () => {
          if (howlRef.current !== howl) return
          usePlayerStore.getState().setIsPlaying(false)
          stopTimeUpdate()
        },
        onend: () => {
          if (howlRef.current !== howl) return
          usePlayerStore.getState().setIsPlaying(false)
          stopTimeUpdate()
          onTrackEnd()
        },
        onloaderror: (_id, msg) => {
          // If a newer track has been loaded, this Howl is stale — ignore.
          if (howlRef.current !== howl) return
          if (!retryRef.current) {
            retryRef.current = true
            console.warn('Howl load error, retrying:', msg)
            howl.load()
            return
          }
          retryRef.current = false
          console.error('Howl load error (after retry):', msg)
          toast.error(`「${trackTitleRef.current}」加载失败，已跳到下一首`)
          onTrackEnd()
        },
        onplayerror: function (soundId: number) {
          // Try to recover via Howler unlock; give up after timeout
          if (playErrorTimerRef.current) clearTimeout(playErrorTimerRef.current)
          playErrorTimerRef.current = setTimeout(() => {
            playErrorTimerRef.current = null
            console.warn('Howl unlock timeout, skipping track')
            toast.error('播放失败，已跳到下一首')
            onTrackEnd()
          }, PLAY_ERROR_TIMEOUT_MS)
          howl.once('unlock', () => {
            if (howlRef.current !== howl) return // Already switched or unmounted
            if (playErrorTimerRef.current) {
              clearTimeout(playErrorTimerRef.current)
              playErrorTimerRef.current = null
            }
            howl.play(soundId)
          })
        },
      })

      howlRef.current = howl
      stretchReadyRef.current = (canTimeStretch ? attachTimeStretch(howl) : Promise.resolve(null)).then(
        (controller) => {
          if (howlRef.current === howl) stretchRef.current = controller
          controller?.setEnabled(useSettingsStore.getState().playbackTempoSyncEnabled)
          return controller
        },
      )
      if (!deferCommit) usePlayerStore.getState().setCurrentTrack(track)
    },
    [cancelScheduledPlayback, disposeHowl, onTrackEnd, startTimeUpdate, stopTimeUpdate],
  )

  // Volume sync
  useEffect(() => {
    if (howlRef.current && syncReadyRef.current) {
      howlRef.current.volume(volume)
    }
  }, [volume])

  useEffect(() => {
    const controller = stretchRef.current
    if (!controller) return
    if (!playbackTempoSyncEnabled) controller.reset()
    controller.setEnabled(playbackTempoSyncEnabled)
  }, [playbackTempoSyncEnabled])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unmuteTimerRef.current) {
        clearTimeout(unmuteTimerRef.current)
        unmuteTimerRef.current = null
      }
      stopPlayback()
      if (playErrorTimerRef.current) {
        clearTimeout(playErrorTimerRef.current)
        playErrorTimerRef.current = null
      }
      if (outgoingCleanupTimerRef.current) {
        clearTimeout(outgoingCleanupTimerRef.current)
        outgoingCleanupTimerRef.current = null
      }
    }
  }, [stopPlayback])

  const setPlaybackTempo = useCallback((tempo: number) => {
    stretchRef.current?.setTempo(tempo)
  }, [])

  return {
    howlRef,
    soundIdRef,
    loadTrack,
    schedulePlayback,
    cancelScheduledPlayback,
    pausePlayback,
    stopPlayback,
    setPlaybackTempo,
  }
}
