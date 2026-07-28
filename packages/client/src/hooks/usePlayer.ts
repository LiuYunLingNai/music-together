import { getServerTime } from '@/lib/clockSync'
import { PLAYER_PLAY_DEDUP_MS } from '@/lib/constants'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/socket-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import type { ScheduledPlayState, Track } from '@music-together/shared'
import { EVENTS } from '@music-together/shared'
import { useCallback, useEffect, useRef } from 'react'
import { useHowl } from './useHowl'
import { useLyric } from './useLyric'
import { useMediaSession } from './useMediaSession'
import { usePlayerSync } from './usePlayerSync'

/**
 * Composing hook: useHowl + useLyric + usePlayerSync.
 * Provides unified playback controls.
 *
 * Architecture: **Scheduled Execution**.
 * All player actions (play, pause, seek, resume) are emitted to the server
 * which broadcasts a `ScheduledPlayState` to ALL clients (including the
 * initiator). Clients then execute the action at the scheduled server-time
 * so that every device acts in unison.
 */
export function usePlayer() {
  const { socket } = useSocketContext()
  const loadingRef = useRef<{ trackId: string; ts: number; serverTimestamp: number } | null>(null)
  // Set by recovery effect to signal onPlayerPlay that this track was already
  // loaded by reconnect recovery — the subsequent PLAYER_PLAY from
  // syncPlaybackToSocket should be skipped to avoid a double-load.
  const recoveredTrackIdRef = useRef<string | null>(null)

  const next = useCallback(() => socket.emit(EVENTS.PLAYER_NEXT), [socket])

  // Auto-next on song end: only the current conductor (hostId) emits PLAYER_NEXT.
  // The conductor is auto-elected by the server (owner > admin > member).
  // Other clients silently wait to prevent duplicate PLAYER_NEXT events.
  const autoNext = useCallback(() => {
    const { room } = useRoomStore.getState()
    const myId = storage.getUserId()
    if (room?.hostId === myId) {
      socket.emit(EVENTS.PLAYER_NEXT)
    }
  }, [socket])

  const {
    howlRef,
    soundIdRef,
    loadTrack,
    schedulePlayback,
    cancelScheduledPlayback,
    pausePlayback,
    stopPlayback,
    setPlaybackTempo,
  } = useHowl(autoNext)
  const { fetchLyric } = useLyric()

  // Connect sync (handles SEEK, PAUSE, RESUME + conductor reporting)
  usePlayerSync(howlRef, soundIdRef, schedulePlayback, cancelScheduledPlayback, pausePlayback, setPlaybackTempo)

  // Reset dedup ref on disconnect so reconnect PLAYER_PLAY is never blocked
  useEffect(() => {
    const onDisconnect = () => {
      loadingRef.current = null
      recoveredTrackIdRef.current = null
    }
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('disconnect', onDisconnect)
    }
  }, [socket])

  // Listen for PLAYER_PLAY events (new track load)
  useEffect(() => {
    const onPlayerPlay = (data: { track: Track; playState: ScheduledPlayState }) => {
      // Deduplicate: ignore if the same track with the same serverTimestamp
      // was requested within the dedup window.  Comparing serverTimestamp
      // ensures that a legitimate replay of the same track (e.g. loop mode)
      // with a different serverTimestamp is not discarded.
      const now = Date.now()
      if (
        loadingRef.current?.trackId === data.track.id &&
        loadingRef.current.serverTimestamp === data.playState.serverTimestamp &&
        now - loadingRef.current.ts < PLAYER_PLAY_DEDUP_MS
      ) {
        return
      }
      // Recovery already loaded this track (reconnect: ROOM_STATE → recovery
      // loadTrack → PLAYER_PLAY from syncPlaybackToSocket).  The serverTimestamp
      // differs (syncPlaybackToSocket computes a new scheduleTime) so the normal
      // dedup above doesn't catch it.  Skip the redundant load but update
      // roomStore with the authoritative scheduled playState.
      if (recoveredTrackIdRef.current === data.track.id) {
        recoveredTrackIdRef.current = null
        loadingRef.current = { trackId: data.track.id, ts: now, serverTimestamp: data.playState.serverTimestamp }
        useRoomStore.getState().updateRoom({
          currentTrack: data.track,
          playState: {
            isPlaying: data.playState.isPlaying,
            currentTime: data.playState.currentTime,
            serverTimestamp: data.playState.serverTimestamp,
          },
        })
        if (data.playState.isPlaying) {
          schedulePlayback(data.playState.currentTime, data.playState.serverTimeToExecute, () => {
            fetchLyric(data.track)
          })
        }
        return
      }
      loadingRef.current = { trackId: data.track.id, ts: now, serverTimestamp: data.playState.serverTimestamp }

      // Keep roomStore in sync so recovery effect sees the correct currentTrack
      useRoomStore.getState().updateRoom({
        currentTrack: data.track,
        playState: {
          isPlaying: data.playState.isPlaying,
          currentTime: data.playState.currentTime,
          serverTimestamp: data.playState.serverTimestamp,
        },
      })

      // Start downloading immediately, while remaining silent. Playback is
      // committed at the shared server time. If this device buffers past the
      // deadline, schedulePlayback aligns it before the fade-in.
      loadTrack(data.track, data.playState.currentTime, data.playState.isPlaying)
      if (data.playState.isPlaying) {
        schedulePlayback(data.playState.currentTime, data.playState.serverTimeToExecute, () => {
          fetchLyric(data.track)
        })
      } else {
        fetchLyric(data.track)
      }
    }

    socket.on(EVENTS.PLAYER_PLAY, onPlayerPlay)

    return () => {
      socket.off(EVENTS.PLAYER_PLAY, onPlayerPlay)
    }
  }, [socket, loadTrack, fetchLyric, schedulePlayback])

  useEffect(() => {
    const onTrackMetadataUpdated = (data: { track: Track }) => {
      const currentTrack = usePlayerStore.getState().currentTrack
      if (currentTrack?.id !== data.track.id) return
      usePlayerStore.getState().setCurrentTrack(data.track)
      useRoomStore.getState().updateRoom({ currentTrack: data.track })
      fetchLyric(data.track)
    }

    socket.on(EVENTS.PLAYER_TRACK_METADATA_UPDATED, onTrackMetadataUpdated)
    return () => socket.off(EVENTS.PLAYER_TRACK_METADATA_UPDATED, onTrackMetadataUpdated)
  }, [socket, fetchLyric])

  // Recovery: auto-sync player state from room state when desync is detected
  // (e.g. after HMR resets stores, or reconnection where PLAYER_PLAY was missed)
  useEffect(() => {
    let hasRecovered = false

    const recover = () => {
      const { room } = useRoomStore.getState()

      // When room becomes null (disconnect), reset flag so next reconnect can recover
      if (!room) {
        hasRecovered = false
        return
      }

      if (hasRecovered) return
      const playerTrack = usePlayerStore.getState().currentTrack
      const roomTrack = room.currentTrack

      // Server has cleared the track (queue empty / cleared) — reset client
      if (!roomTrack && playerTrack) {
        hasRecovered = true
        stopPlayback()
        usePlayerStore.getState().reset()
        return
      }

      // Server has track but client doesn't (HMR reset / missed PLAYER_PLAY)
      if (roomTrack?.streamUrl && (!playerTrack || !howlRef.current)) {
        // Skip if onPlayerPlay is already handling this track — its updateRoom()
        // call triggers this subscription synchronously before loadTrack runs,
        // so playerTrack/howlRef are still stale. Checking loadingRef avoids
        // a redundant double-load.
        // However, if howlRef is null despite loadingRef pointing to this track,
        // the previous loadTrack failed (e.g. !streamUrl) and we should retry.
        if (loadingRef.current?.trackId === roomTrack.id && howlRef.current) return

        hasRecovered = true
        const ps = room.playState
        const elapsed = ps.isPlaying ? (getServerTime() - ps.serverTimestamp) / 1000 : 0
        const recoveredTime = ps.currentTime + Math.max(0, elapsed)
        recoveredTrackIdRef.current = roomTrack.id
        loadTrack(roomTrack, recoveredTime, ps.isPlaying)
        if (ps.isPlaying) {
          schedulePlayback(recoveredTime, getServerTime(), () => fetchLyric(roomTrack))
        } else {
          fetchLyric(roomTrack)
        }
      }
    }

    // Check immediately (covers HMR where roomStore already has data)
    recover()

    // Subscribe for future changes (covers reconnect where ROOM_STATE arrives later)
    const unsubscribe = useRoomStore.subscribe(recover)
    return unsubscribe
    // `socket` intentionally excluded — effect subscribes to roomStore, not socket directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTrack, fetchLyric, schedulePlayback, stopPlayback])

  // -----------------------------------------------------------------------
  // Controls — emit to server only.  Server broadcasts ScheduledPlayState
  // to ALL clients (including us) via scheduled execution.
  // -----------------------------------------------------------------------
  const play = useCallback(() => {
    socket.emit(EVENTS.PLAYER_PLAY)
  }, [socket])

  const pause = useCallback(() => {
    socket.emit(EVENTS.PLAYER_PAUSE)
  }, [socket])

  const seek = useCallback(
    (time: number) => {
      // Optimistic local update for the progress bar UI
      usePlayerStore.getState().setCurrentTime(time)
      socket.emit(EVENTS.PLAYER_SEEK, { currentTime: time })
    },
    [socket],
  )

  const prev = useCallback(() => socket.emit(EVENTS.PLAYER_PREV), [socket])

  // MediaSession: hardware media keys + OS media notification bar.
  // Permission-aware: mirrors PlayerControls fallback-to-vote behaviour.
  useMediaSession({ play, pause, next, prev, seek })

  return { play, pause, seek, next, prev }
}
