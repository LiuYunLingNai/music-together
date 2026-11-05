import { getServerTime, isCalibrated } from '@/lib/clockSync'
import { PLAYER_PLAY_DEDUP_MS } from '@/lib/constants'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/socket-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSleepTimerStore } from '@/stores/sleepTimerStore'
import type { RoomState, ScheduledPlayState, Track } from '@music-together/shared'
import { EVENTS, getPlaybackRevision, isStalePlaybackAction } from '@music-together/shared'
import { useCallback, useEffect, useRef } from 'react'
import { useHowl } from './useHowl'
import { useLyric } from './useLyric'
import { useMediaSession } from './useMediaSession'
import { usePlayerSync } from './usePlayerSync'
import { useSleepTimer } from './useSleepTimer'
import { getScheduledPlaybackPosition } from '@/lib/playbackSync'
import { getProxiedCoverUrl } from '@/lib/cover'
import type { MediaFailureKind } from '@/lib/mediaFailure'
import { toast } from 'sonner'

/** 预言服务端下一首（`queueService.getNextTrack` 的客户端镜像）；shuffle 由服务端随机，不猜。 */
function predictNextTrack(room: RoomState | null): Track | null {
  if (!room || room.queue.length === 0) return null
  const currentIndex = room.currentTrack
    ? room.queue.findIndex((track) => track.id === room.currentTrack?.id)
    : -1
  if (room.playMode === 'loop-one') return room.currentTrack ?? room.queue[0] ?? null
  if (room.playMode === 'shuffle') return null
  const nextIndex = currentIndex + 1
  if (nextIndex < room.queue.length) return room.queue[nextIndex] ?? null
  return room.playMode === 'loop-all' ? (room.queue[0] ?? null) : null
}

function prefetchCover(track: Track): void {
  if (!track.cover || typeof Image === 'undefined') return
  const image = new Image()
  image.decoding = 'async'
  // 与播放页读的是同一个地址（跨域封面经服务端代理），否则预热的是另一条 URL。
  image.src = getProxiedCoverUrl(track.cover)
  void image.decode().catch(() => undefined)
}

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
  const loadingRef = useRef<{ trackId: string; revision: number; ts: number; serverTimestamp: number } | null>(null)
  // Set by recovery effect to signal onPlayerPlay that this track was already
  // loaded by reconnect recovery — the subsequent PLAYER_PLAY from
  // syncPlaybackToSocket should be skipped to avoid a double-load.
  const recoveredTrackIdRef = useRef<string | null>(null)

  // 带上当前曲目：请求在服务端排队期间歌曲自然播完的话，这次切歌会被丢弃，
  // 否则刚开始的新歌会被一起跳掉。
  const next = useCallback(() => {
    useSleepTimerStore.getState().clearLocalHold()
    const trackId = useRoomStore.getState().room?.currentTrack?.id
    socket.emit(EVENTS.PLAYER_NEXT, trackId ? { trackId } : {})
  }, [socket])

  // Auto-next on song end: only the current conductor (hostId) emits PLAYER_NEXT.
  // The conductor is auto-elected by the server (owner > admin > member).
  // Other clients silently wait to prevent duplicate PLAYER_NEXT events.
  const autoNext = useCallback(() => {
    const { room } = useRoomStore.getState()
    const myId = storage.getUserId()
    if (room?.hostId === myId) {
      socket.emit(EVENTS.PLAYER_NEXT, room.currentTrack?.id ? { trackId: room.currentTrack.id } : {})
    }
  }, [socket])

  // A dead CDN URL (MediaError 2/3/4) is not a reason to skip the song: ask the
  // server to re-resolve its stream URL and reload at the shared timeline.
  const recoveryRef = useRef<{ trackId: string } | null>(null)
  const recoveryAttemptsRef = useRef<{ trackId: string; count: number } | null>(null)
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recoverFromLoadFailure = useCallback(
    (kind: MediaFailureKind) => {
      const track = usePlayerStore.getState().currentTrack
      const roomTrackId = useRoomStore.getState().room?.currentTrack?.id
      if (!track || roomTrackId !== track.id) return false
      if (recoveryRef.current?.trackId === track.id) return false
      const attempts = recoveryAttemptsRef.current?.trackId === track.id ? recoveryAttemptsRef.current.count : 0
      if (attempts >= 1) return false
      recoveryAttemptsRef.current = { trackId: track.id, count: attempts + 1 }
      recoveryRef.current = { trackId: track.id }
      console.warn('媒体加载失败，请求重新解析音源:', kind)
      socket.emit(EVENTS.PLAYER_REFRESH_STREAM, { trackId: track.id })
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = setTimeout(() => {
        recoveryTimerRef.current = null
        if (recoveryRef.current?.trackId !== track.id) return
        recoveryRef.current = null
        toast.error(`「${track.title}」加载失败，已跳到下一首`)
        autoNext()
      }, 12_000)
      return true
    },
    [autoNext, socket],
  )

  const {
    howlRef,
    soundIdRef,
    loadTrack,
    schedulePlayback,
    cancelScheduledPlayback,
    pausePlayback,
    stopPlayback,
    setPlaybackTempo,
  } = useHowl(autoNext, recoverFromLoadFailure)
  const { fetchLyric, prefetchLyric } = useLyric()

  useSleepTimer(howlRef, pausePlayback)

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
      recoveryRef.current = null
      recoveryAttemptsRef.current = null
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
      const currentPlayState = useRoomStore.getState().room?.playState
      const incomingRevision = getPlaybackRevision(data.playState)
      const currentRevision = currentPlayState ? getPlaybackRevision(currentPlayState) : 0
      if (currentPlayState && isStalePlaybackAction(data.playState, currentPlayState)) return
      // Deduplicate: ignore if the same track with the same serverTimestamp
      // was requested within the dedup window.  Comparing serverTimestamp
      // ensures that a legitimate replay of the same track (e.g. loop mode)
      // with a different serverTimestamp is not discarded.
      const now = Date.now()
      if (
        loadingRef.current?.trackId === data.track.id &&
        loadingRef.current.revision === incomingRevision &&
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
        loadingRef.current = {
          trackId: data.track.id,
          revision: incomingRevision,
          ts: now,
          serverTimestamp: data.playState.serverTimestamp,
        }
        useRoomStore.getState().updateRoom({
          currentTrack: data.track,
          playState: {
            isPlaying: data.playState.isPlaying,
            currentTime: data.playState.currentTime,
            serverTimestamp: data.playState.serverTimestamp,
            revision: data.playState.revision ?? currentRevision,
          },
        })
        if (data.playState.isPlaying) {
          schedulePlayback(data.playState.currentTime, data.playState.serverTimeToExecute, () => {
            fetchLyric(data.track)
          })
        }
        return
      }
      loadingRef.current = {
        trackId: data.track.id,
        revision: incomingRevision,
        ts: now,
        serverTimestamp: data.playState.serverTimestamp,
      }

      // Keep roomStore in sync so recovery effect sees the correct currentTrack
      useRoomStore.getState().updateRoom({
        currentTrack: data.track,
        playState: {
          isPlaying: data.playState.isPlaying,
          currentTime: data.playState.currentTime,
          serverTimestamp: data.playState.serverTimestamp,
          revision: data.playState.revision ?? currentRevision,
        },
      })

      // Start downloading immediately, while remaining silent. Playback is
      // committed at the shared server time. If this device buffers past the
      // deadline, schedulePlayback aligns it before the fade-in.
      loadTrack(data.track, data.playState.currentTime, data.playState.isPlaying)
      prefetchLyric(data.track)
      const upcoming = predictNextTrack(useRoomStore.getState().room)
      if (upcoming && upcoming.id !== data.track.id) {
        prefetchLyric(upcoming)
        prefetchCover(upcoming)
      }
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
  }, [socket, loadTrack, fetchLyric, prefetchLyric, schedulePlayback])

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

  // Server re-resolved the stream URL after our media element failed: reload
  // the same track at the room's current position.
  useEffect(() => {
    const onStreamRefreshed = (data: { track: Track }) => {
      const pending = recoveryRef.current
      if (!pending || pending.trackId !== data.track.id) return
      recoveryRef.current = null
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
      const playState = useRoomStore.getState().room?.playState
      const now = getServerTime()
      const position = playState?.isPlaying
        ? getScheduledPlaybackPosition(playState.currentTime, playState.serverTimestamp, now)
        : usePlayerStore.getState().currentTime
      useRoomStore.getState().updateRoom({ currentTrack: data.track })
      usePlayerStore.getState().setCurrentTrack(data.track)
      loadTrack(data.track, position, playState?.isPlaying === true)
      if (playState?.isPlaying) schedulePlayback(position, now)
      toast.success(`「${data.track.title}」播放地址已刷新`)
    }
    socket.on(EVENTS.PLAYER_STREAM_REFRESHED, onStreamRefreshed)
    return () => socket.off(EVENTS.PLAYER_STREAM_REFRESHED, onStreamRefreshed)
  }, [socket, loadTrack, schedulePlayback])

  useEffect(() => {
    return () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
    }
  }, [])

  // Recovery: auto-sync player state from room state when desync is detected
  // (e.g. after HMR resets stores, or reconnection where PLAYER_PLAY was missed)
  useEffect(() => {
    let recoveredKey: string | null = null

    const recover = () => {
      const { room } = useRoomStore.getState()

      // When room becomes null (disconnect), reset flag so next reconnect can recover
      if (!room) {
        recoveredKey = null
        return
      }
      const playerTrack = usePlayerStore.getState().currentTrack
      const roomTrack = room.currentTrack
      const recoveryKey = roomTrack
        ? `${roomTrack.id}:${room.playState.revision ?? room.playState.serverTimestamp}`
        : `empty:${room.playState.revision ?? room.playState.serverTimestamp}`

      // Server has cleared the track (queue empty / cleared) — reset client
      if (!roomTrack && playerTrack) {
        if (recoveredKey === recoveryKey) return
        recoveredKey = recoveryKey
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
        if (
          loadingRef.current?.trackId === roomTrack.id &&
          loadingRef.current.revision === (room.playState.revision ?? 0) &&
          howlRef.current
        ) {
          return
        }

        if (recoveredKey === recoveryKey) return
        recoveredKey = recoveryKey
        const ps = room.playState
        const elapsed = ps.isPlaying && isCalibrated() ? (getServerTime() - ps.serverTimestamp) / 1000 : 0
        const recoveredTime = ps.currentTime + Math.max(0, elapsed)
        recoveredTrackIdRef.current = roomTrack.id
        loadTrack(roomTrack, recoveredTime, ps.isPlaying)
        prefetchLyric(roomTrack)
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
  }, [loadTrack, fetchLyric, prefetchLyric, schedulePlayback, stopPlayback])

  // -----------------------------------------------------------------------
  // Controls — emit to server only.  Server broadcasts ScheduledPlayState
  // to ALL clients (including us) via scheduled execution.
  // -----------------------------------------------------------------------
  const play = useCallback(() => {
    const wasHeld = useSleepTimerStore.getState().localHold
    useSleepTimerStore.getState().clearLocalHold()
    socket.emit(EVENTS.PLAYER_PLAY)
    // 房间仍在播放时服务端会忽略 PLAYER_PLAY；睡眠保持的本机需要自己接回时间线。
    if (wasHeld) {
      const playState = useRoomStore.getState().room?.playState
      if (playState?.isPlaying) {
        const now = getServerTime()
        schedulePlayback(
          getScheduledPlaybackPosition(playState.currentTime, playState.serverTimestamp, now),
          now,
        )
      }
    }
  }, [socket, schedulePlayback])

  const pause = useCallback(() => {
    socket.emit(EVENTS.PLAYER_PAUSE)
  }, [socket])

  const requestSeek = useCallback((time: number) => socket.emit(EVENTS.PLAYER_SEEK, { currentTime: time }), [socket])

  const seek = useCallback(
    (time: number) => {
      useSleepTimerStore.getState().clearLocalHold()
      // Progress controls retain an optimistic preview while the server
      // schedules the authoritative seek for every room client.
      usePlayerStore.getState().setCurrentTime(time)
      requestSeek(time)
    },
    [requestSeek],
  )

  const prev = useCallback(() => {
    useSleepTimerStore.getState().clearLocalHold()
    socket.emit(EVENTS.PLAYER_PREV)
  }, [socket])

  // MediaSession: hardware media keys + OS media notification bar.
  // Permission-aware: mirrors PlayerControls fallback-to-vote behaviour.
  useMediaSession({ play, pause, next, prev, seek })

  return { play, pause, seek, requestSeek, next, prev }
}
