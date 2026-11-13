import { getServerTime, isCalibrated } from '@/lib/clockSync'
import { PLATFORM_LABELS } from '@/lib/platform'
import { PLAYER_PLAY_DEDUP_MS } from '@/lib/constants'
import { setPendingAutomixPlan, setPendingAutomixTransition } from '@/lib/playbackTransition'
import { storage } from '@/lib/storage'
import { consumePlaybackReattach } from '@/lib/playbackContinuity'
import { takeOfflineBufferCopy } from '@/lib/offlineTrackBuffer'
import { useSocketContext } from '@/providers/socket-context'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaybackFailureStore } from '@/stores/playbackFailureStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSleepTimerStore } from '@/stores/sleepTimerStore'
import type {
  AutomixTransitionPayload,
  PlaybackFailureEvent,
  ScheduledPlayState,
  Track,
} from '@music-together/shared'
import { EVENTS, getPlaybackRevision, isStalePlaybackAction } from '@music-together/shared'
import { useCallback, useEffect, useRef } from 'react'
import { useHowl } from './useHowl'
import { useLyric } from './useLyric'
import { useMediaSession } from './useMediaSession'
import { usePlayerSync } from './usePlayerSync'
import { useSleepTimer } from './useSleepTimer'
import { useNextTrackPreload } from './useNextTrackPreload'
import { useAutomixStemPrep } from './useAutomixStemPrep'
import { useAnalysisModelAutoLoad } from './useAnalysisModelAutoLoad'
import { useAutomixProfilePrefetch } from './useAutomixProfilePrefetch'
import { useCurrentTrackBuffer } from './useCurrentTrackBuffer'
import { useAutomixLyricEvidence } from './useAutomixLyricEvidence'
import { getScheduledPlaybackPosition } from '@/lib/playbackSync'
import { getProxiedCoverUrl } from '@/lib/cover'
import { predictNextTrack } from '@/lib/nextTrack'
import type { MediaFailureKind } from '@/lib/mediaFailure'
import { toast } from 'sonner'

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
  const offlineRecoveryPendingRef = useRef(false)
  const recoverFromLoadFailureRef = useRef<((kind: MediaFailureKind) => boolean) | null>(null)
  const recoverFromLoadFailure = useCallback(
    (kind: MediaFailureKind) => {
      const track = usePlayerStore.getState().currentTrack
      const roomTrackId = useRoomStore.getState().room?.currentTrack?.id
      if (!track || roomTrackId !== track.id) return false
      // A recovery is already in flight: keep suppressing the default skip until it settles.
      if (recoveryRef.current?.trackId === track.id) return true
      // 断线时 PLAYER_REFRESH_STREAM 发不出去，计时器也会误判成“刷新失败”而跳歌：
      // 等重新加入房间后再按原样处理这次失败。
      if (!socket.connected) {
        if (!offlineRecoveryPendingRef.current) {
          offlineRecoveryPendingRef.current = true
          const retry = () => {
            socket.off(EVENTS.ROOM_STATE, retry)
            offlineRecoveryPendingRef.current = false
            recoverFromLoadFailureRef.current?.(kind)
          }
          socket.on(EVENTS.ROOM_STATE, retry)
        }
        return true
      }
      const attempts = recoveryAttemptsRef.current?.trackId === track.id ? recoveryAttemptsRef.current.count : 0
      if (attempts >= 2) return false
      const nextAttempt = attempts + 1
      recoveryAttemptsRef.current = { trackId: track.id, count: nextAttempt }
      recoveryRef.current = { trackId: track.id }
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)

      if (nextAttempt === 1) {
        // 解码/格式不支持时先降一档；纯网络失败只换地址，避免无谓地降低整房间音质。
        const degrade = kind === 'decode' || kind === 'unsupported'
        console.warn(degrade ? '媒体格式失败，请求降档重新解析音源:' : '媒体加载失败，请求重新解析音源:', kind)
        socket.emit(EVENTS.PLAYER_REFRESH_STREAM, { trackId: track.id, degrade })
      } else {
        console.warn('音源刷新失败，请求跨源回退:', kind)
        socket.emit(EVENTS.PLAYER_REQUEST_SOURCE_FALLBACK, { trackId: track.id })
      }

      const failureMessage = track.vip
        ? `「${track.title}」可能需要登录或会员，已尝试降档与换源；可登录对应平台后重试`
        : `「${track.title}」加载失败，已跳到下一首`

      recoveryTimerRef.current = setTimeout(
        () => {
          recoveryTimerRef.current = null
          if (recoveryRef.current?.trackId !== track.id) return
          recoveryRef.current = null
          if (nextAttempt === 1) {
            // URL refresh did not help; try the same song on another provider before skipping.
            recoveryAttemptsRef.current = { trackId: track.id, count: 2 }
            recoveryRef.current = { trackId: track.id }
            console.warn('音源刷新超时，请求跨源回退')
            socket.emit(EVENTS.PLAYER_REQUEST_SOURCE_FALLBACK, { trackId: track.id })
            recoveryTimerRef.current = setTimeout(() => {
              recoveryTimerRef.current = null
              if (recoveryRef.current?.trackId !== track.id) return
              recoveryRef.current = null
              toast.error(failureMessage)
              autoNext()
            }, 15_000)
            return
          }
          toast.error(failureMessage)
          autoNext()
        },
        nextAttempt === 1 ? 8_000 : 15_000,
      )
      return true
    },
    [autoNext, socket],
  )
  useEffect(() => {
    recoverFromLoadFailureRef.current = recoverFromLoadFailure
  }, [recoverFromLoadFailure])

  const {
    howlRef,
    soundIdRef,
    loadTrack,
    preloadTrack,
    disposePreloaded,
    schedulePlayback,
    retargetScheduledPlayback,
    cancelScheduledPlayback,
    pausePlayback,
    stopPlayback,
    setPlaybackTempo,
  } = useHowl(autoNext, recoverFromLoadFailure)
  const { fetchLyric, prefetchLyric } = useLyric()

  useNextTrackPreload(preloadTrack, disposePreloaded)
  useAnalysisModelAutoLoad()
  useAutomixStemPrep()
  useAutomixProfilePrefetch()
  useCurrentTrackBuffer()
  useAutomixLyricEvidence()

  useSleepTimer(howlRef, pausePlayback)

  // Connect sync (handles SEEK, PAUSE, RESUME + conductor reporting)
  usePlayerSync(
    howlRef,
    soundIdRef,
    schedulePlayback,
    cancelScheduledPlayback,
    pausePlayback,
    setPlaybackTempo,
    retargetScheduledPlayback,
  )

  // 服务端排好的过渡落点：供分轨准备与执行按同一组参数工作。
  useEffect(() => {
    const onAutomixPlan = (plan: Parameters<typeof setPendingAutomixPlan>[0]): void => {
      setPendingAutomixPlan(plan)
    }
    socket.on(EVENTS.PLAYER_AUTOMIX_PLAN, onAutomixPlan)
    return () => {
      socket.off(EVENTS.PLAYER_AUTOMIX_PLAN, onAutomixPlan)
    }
  }, [socket])

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

  // 断线且音频停滞：本机已有整曲副本时，改用本地副本从当前位置继续播放。
  // 重连后同一首歌不会重新加载，进度由同步环接回房间时间线。
  useEffect(() => {
    let lastTime = -1
    let stalledSince = 0
    let swappedFor: string | null = null
    const timer = setInterval(() => {
      const { currentTrack, currentTime, isPlaying } = usePlayerStore.getState()
      if (socket.connected || !currentTrack || !isPlaying) {
        stalledSince = 0
        lastTime = -1
        return
      }
      const now = performance.now()
      if (Math.abs(currentTime - lastTime) > 0.05) {
        lastTime = currentTime
        stalledSince = now
        return
      }
      if (stalledSince === 0 || now - stalledSince < 3_000) return
      if (swappedFor === currentTrack.id) return
      const bytes = takeOfflineBufferCopy(currentTrack.id)
      if (!bytes) return
      swappedFor = currentTrack.id
      const blobUrl = URL.createObjectURL(new Blob([bytes]))
      preloadTrack(currentTrack, currentTrack.streamUrl ?? '', blobUrl)
      loadTrack(currentTrack, currentTime, false)
      schedulePlayback(currentTime, getServerTime())
      toast.info('网络中断，已改用本机缓冲继续播放')
    }, 1_000)
    return () => clearInterval(timer)
  }, [socket, loadTrack, preloadTrack, schedulePlayback])

  // Listen for PLAYER_PLAY events (new track load)
  useEffect(() => {
    const onPlayerPlay = (data: {
      track: Track
      playState: ScheduledPlayState
      automix?: AutomixTransitionPayload
    }) => {
      usePlaybackFailureStore.getState().dismiss()
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

      // 断线重连后的第一次回放：本机还留着同一首歌的已加载音频时，直接接回时间线，
      // 不重新加载，这样断线期间的缓冲和播放位置都不会丢。
      if (consumePlaybackReattach()) {
        const loaded = usePlayerStore.getState().currentTrack
        const howl = howlRef.current
        if (loaded?.id === data.track.id && howl && howl.state() === 'loaded') {
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
            // 仍在播放就交给同步环微调；只有本机已经停下（缓冲耗尽、曲终）才重新排期。
            if (!howl.playing()) {
              schedulePlayback(data.playState.currentTime, data.playState.serverTimeToExecute)
            } else {
              // 时钟重新校准约需 1 秒；校准后马上取两次样本，不等下一个常规周期再纠偏。
              for (const delay of [1_400, 2_400]) {
                setTimeout(() => {
                  if (socket.connected) socket.emit(EVENTS.PLAYER_SYNC_REQUEST)
                }, delay)
              }
            }
          } else {
            pausePlayback(data.playState.currentTime)
            usePlayerStore.getState().setCurrentTime(data.playState.currentTime)
          }
          return
        }
      }

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
      // 自动混音：这一次接歌用服务端下发的过渡参数，房间内所有人一致。
      setPendingAutomixTransition(data.automix)
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
  }, [socket, loadTrack, fetchLyric, prefetchLyric, schedulePlayback, pausePlayback, howlRef])

  // Server parked the room on a track it could not resolve: stop the local
  // recovery/skip timers and explain the reason with actionable choices.
  useEffect(() => {
    const onPlaybackFailure = (data: PlaybackFailureEvent) => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
      recoveryRef.current = null
      recoveryAttemptsRef.current = null
      usePlayerStore.getState().setIsPlaying(false)
      usePlaybackFailureStore.getState().show(data)
    }
    socket.on(EVENTS.PLAYER_PLAYBACK_FAILURE, onPlaybackFailure)
    return () => {
      socket.off(EVENTS.PLAYER_PLAYBACK_FAILURE, onPlaybackFailure)
    }
  }, [socket])

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
    const onSourceSwitched = (data: { track: Track; currentTime: number; isPlaying: boolean }) => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
      recoveryRef.current = null
      recoveryAttemptsRef.current = null
      useRoomStore.getState().updateRoom({ currentTrack: data.track })
      usePlayerStore.getState().setCurrentTrack(data.track)
      loadTrack(data.track, data.currentTime, data.isPlaying)
      fetchLyric(data.track)
      if (data.isPlaying) schedulePlayback(data.currentTime, getServerTime(), () => fetchLyric(data.track))
      toast.success(`已切换到${PLATFORM_LABELS[data.track.source]}：${data.track.title}`, {
        id: 'manual-source-switch',
      })
    }

    socket.on(EVENTS.PLAYER_SOURCE_SWITCHED, onSourceSwitched)
    return () => socket.off(EVENTS.PLAYER_SOURCE_SWITCHED, onSourceSwitched)
  }, [socket, loadTrack, fetchLyric, schedulePlayback])

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
        schedulePlayback(getScheduledPlaybackPosition(playState.currentTime, playState.serverTimestamp, now), now)
      }
    }
  }, [socket, schedulePlayback])

  const pause = useCallback(() => {
    socket.emit(EVENTS.PLAYER_PAUSE)
  }, [socket])

  const requestSeek = useCallback(
    (time: number) =>
      socket.emit(EVENTS.PLAYER_SEEK, {
        currentTime: time,
        trackId: usePlayerStore.getState().currentTrack?.id,
      }),
    [socket],
  )

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
