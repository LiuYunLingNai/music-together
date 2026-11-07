import { useCallback, useEffect, useRef } from 'react'
import { Howl, Howler } from 'howler'
import type { Track } from '@music-together/shared'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { CURRENT_TIME_THROTTLE_MS } from '@/lib/constants'
import { toast } from 'sonner'
import { getServerTime } from '@/lib/clockSync'
import { SERVER_URL } from '@/lib/config'
import {
  attachTimeStretch,
  prepareDirectStreamForTimeStretch,
  releaseTimeStretch,
  type TimeStretchController,
} from '@/lib/timeStretch'
import { setHowlPosition } from '@/lib/howlPosition'
import { registerActivePlaybackStop } from '@/lib/audioPlaybackLifecycle'
import { lyricPlayerBridge } from '@/lib/lyricPlayerBridge'
import { getScheduledPlaybackPosition } from '@/lib/playbackSync'
import { hideLoading, showLoading } from '@/components/Player/mineradio/particles/loadingState'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'
import { useSleepTimerStore } from '@/stores/sleepTimerStore'
import { classifyMediaElementFailure, isRecoverableStreamFailure, type MediaFailureKind } from '@/lib/mediaFailure'

/** Max wait (ms) for Howler `unlock` event before giving up and skipping */
const PLAY_ERROR_TIMEOUT_MS = 3000

/** HTMLMediaElement may wait forever when an upstream audio proxy cannot connect. */
const LOAD_TIMEOUT_MS = 18_000
/** A dead stream must not freeze the room for long, but a slow CDN may buffer for a while. */
const STALLED_TIMEOUT_MS = 8_000
/** While the element is visibly rebuffering, give it more time instead of reloading. */
const BUFFERING_TIMEOUT_MS = 30_000

/** Howler keeps the HTML5 element on its first sound. */
function mediaElementOf(howl: Howl): HTMLMediaElement | null {
  const sound = (howl as unknown as { _sounds?: Array<{ _node?: HTMLMediaElement }> })._sounds?.[0]
  return sound?._node ?? null
}

/**
 * Howler uses `canplaythrough` by default for HTML5 Audio. With a proxied
 * Kugou stream that means waiting until the browser estimates the entire
 * track can play uninterrupted, which can be tens of seconds when the server
 * → CDN link is slow. `canplay` starts as soon as the media element has a
 * usable buffer; the existing stalled-stream recovery still handles a later
 * network interruption.
 */
;(Howler as typeof Howler & { _canPlayEvent: 'canplay' | 'canplaythrough' })._canPlayEvent = 'canplay'

/** Short fade after a scheduled start masks the decoder's final seek. */
const SCHEDULED_START_FADE_MS = 120
const DEFAULT_TRACK_CROSSFADE_MS = 80
const trackCrossfadeMs = (): number => useAudioSettingsStore.getState().crossfadeMs ?? DEFAULT_TRACK_CROSSFADE_MS

interface ScheduledStart {
  howl: Howl
  targetTime: number
  executeAt: number
  onCommit?: () => void
}

interface PreloadedHowl {
  key: string
  howl: Howl
  canTimeStretch: boolean
}

/** 手动换源保持 trackId 不变但换 URL，必须把流地址一起放进预热身份。 */
function preloadKey(track: Track, streamUrl: string): string {
  return JSON.stringify([track.id, track.source, track.urlId, streamUrl])
}

const streamFormatFor = (track: Track): string[] =>
  track.source === 'bilibili' ? [track.streamFormat ?? 'm4a'] : ['flac', 'm4a', 'ogg', 'mp3']

function buildPlaybackUrl(track: Track, streamUrl: string): string {
  const roomId = useRoomStore.getState().room?.id ?? ''
  if (track.source === 'bilibili') {
    return `${SERVER_URL}/api/music/bilibili-audio-proxy?url=${encodeURIComponent(streamUrl)}&bvid=${encodeURIComponent(track.urlId)}&roomId=${encodeURIComponent(roomId)}`
  }
  if (track.source === 'kugou' || track.source === 'kugou_concept') {
    return `${SERVER_URL}/api/music/kugou-audio-proxy?url=${encodeURIComponent(streamUrl)}`
  }
  return streamUrl
}

/**
 * Manages a Howl audio instance with two-phase loading strategy:
 * Phase 1: Create Howl with volume=0 (silent)
 * Phase 2: onload → seek to target → delay → fade-in unmute
 */
export function useHowl(
  onTrackEnd: () => void,
  /** 返回 true 表示已接手恢复（重新解析音源），本次不再跳歌。 */
  onPlaybackFailure?: (kind: MediaFailureKind) => boolean,
) {
  const howlRef = useRef<Howl | null>(null)
  const soundIdRef = useRef<number | undefined>(undefined)
  const animFrameRef = useRef<number>(0)
  const syncReadyRef = useRef(false)
  const unmuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const preloadedRef = useRef<PreloadedHowl | null>(null)

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
        const seekVal = howlRef.current.seek() as number
        lyricPlayerBridge.setCurrentTime(seekVal)
        if (now - lastTimeUpdateRef.current >= CURRENT_TIME_THROTTLE_MS) {
          lastTimeUpdateRef.current = now
          usePlayerStore.getState().setCurrentTime(seekVal)

          // Stalled detection: if currentTime hasn't moved for a while while
          // playing() is true, the stream likely broke mid-playback. A visibly
          // rebuffering element gets a longer grace period so a slow CDN is
          // not mistaken for a dead URL (each false positive causes an audible
          // reload gap).
          const st = stalledRef.current
          if (Math.abs(seekVal - st.lastSeek) < 0.05) {
            const element = howlRef.current ? mediaElementOf(howlRef.current) : null
            const buffering = element ? element.readyState < element.HAVE_FUTURE_DATA : false
            const stallLimit = buffering ? BUFFERING_TIMEOUT_MS : STALLED_TIMEOUT_MS
            if (st.since > 0 && now - st.since > stallLimit) {
              stalledRef.current = { lastSeek: -1, since: 0 }
              if (isRecoverableStreamFailure('network') && onPlaybackFailure?.('network')) {
                console.warn('Playback stalled, refreshing stream URL')
                return
              }
              console.warn('Playback stalled, skipping track')
              toast.error('播放中断，已跳到下一首')
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
  }, [onPlaybackFailure, onTrackEnd])

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
    // ★ 先撤回本图发布的分析节点（audioTap 单例），再 unload ——
    //   旧歌的死 tap 不再锁死视觉层的频谱来源（节拍丢失加固）
    const finalizeTimeStretchRelease = releaseTimeStretch(howl)
    try {
      howl.unload()
    } catch {
      /* ignore */
    } finally {
      // 初始化尚未完成的元素必须在 unload 放回池后立即摘除，防止下一首歌
      // 复用它，同时旧异步任务又在后台给同一元素建图并覆盖全局 tap。
      finalizeTimeStretchRelease?.()
    }
    // 换歌/卸载时逐帧时钟也必须作废：`releaseTimeStretch` 之后 rAF 可能仍在
    // 旧 Howl 上跑一拍，留下上一首的位置。清掉后消费方立刻回退到 store。
    lyricPlayerBridge.clearFrameTime()
  }, [])

  /** 丢弃预热实例；它还没有接音频图，也不能动当前播放的逐帧时钟。 */
  const disposePreloaded = useCallback(() => {
    const preloaded = preloadedRef.current
    preloadedRef.current = null
    if (!preloaded) return
    releaseTimeStretch(preloaded.howl)
    try {
      preloaded.howl.unload()
    } catch {
      /* ignore */
    }
  }, [])

  const pausePlayback = useCallback(
    (position: number) => {
      // 用户暂停后，未完成的 unlock 超时不应再自动跳下一首。
      if (playErrorTimerRef.current) {
        clearTimeout(playErrorTimerRef.current)
        playErrorTimerRef.current = null
      }
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
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current)
      loadTimerRef.current = null
    }
    if (outgoingCleanupTimerRef.current) {
      clearTimeout(outgoingCleanupTimerRef.current)
      outgoingCleanupTimerRef.current = null
    }
    disposePreloaded()
    const current = howlRef.current
    const outgoing = outgoingHowlRef.current
    disposeHowl(current)
    if (outgoing !== current) disposeHowl(outgoing)
    howlRef.current = null
    outgoingHowlRef.current = null
    preparedTrackRef.current = null
    soundIdRef.current = undefined
    stopTimeUpdate()
    // 上游 `12-playback-switch-core.js:20`：`if (!isPlaying) hideLoading()`。
    // 停播后不可能再有内容到达，雾环必须撤掉 —— 否则停止播放时画面会
    // 永远留着一层雾。
    hideLoading()
  }, [cancelScheduledPlayback, disposeHowl, disposePreloaded, stopTimeUpdate])

  const schedulePlayback = useCallback(
    (targetTime: number, executeAt: number, onCommit?: () => void) => {
      cancelScheduledPlayback()
      // 睡眠定时器到期后，服务端随后下发的恢复播放不得把本机叫醒。
      if (useSleepTimerStore.getState().localHold) return
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
          // ★ Howler 对已经在播放的声音会**直接返回**（howler.js:810），不触发
          //   onplay。而 onplay 是恢复音量、清理 scheduledStartRef 的唯一入口，
          //   所以这条路径会让播放器永久静音（服务端现在也会忽略重复的恢复
          //   播放请求，但这里仍要兜住已经在播放的情况）。
          const soundId = soundIdRef.current
          if (soundId !== undefined && howl.playing(soundId)) {
            const scheduledStart = scheduledStartRef.current
            scheduledStartRef.current = null
            if (scheduledStart) {
              setHowlPosition(
                howl,
                getScheduledPlaybackPosition(scheduledStart.targetTime, scheduledStart.executeAt, getServerTime()),
                soundId,
              )
              scheduledStart.onCommit?.()
            }
            const latestVolume = usePlayerStore.getState().volume
            howl.volume(latestVolume, soundId)
            syncReadyRef.current = true
            return
          }
          if (soundId !== undefined) howl.play(soundId)
          else soundIdRef.current = howl.play()
        })()
      }

      const delay = Math.max(0, executeAt - getServerTime())
      scheduledStartTimerRef.current = setTimeout(start, delay)
    },
    [cancelScheduledPlayback],
  )

  const handleHowlLoad = useCallback((howl: Howl, seekTo: number | undefined, deferCommit: boolean) => {
    if (howlRef.current !== howl) return // Stale instance guard
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current)
      loadTimerRef.current = null
    }
    // 上游 `05-playback/14-player-controls.js` 的 5 处 `hideLoading()`
    // —— 音频可取即撤掉加载态雾环。上游的分支是"用户控制动作后"，
    // 本项目的对应物是"缓冲区间结束"（见 loadingState.ts 的驱动源说明）。
    hideLoading()
    const d = howl.duration()
    if (!deferCommit && Number.isFinite(d) && d > 0) {
      usePlayerStore.getState().setDuration(d)
    }
    if (seekTo && seekTo > 0) howl.seek(seekTo)
    if (scheduledStartRef.current?.howl === howl) howl.volume(0)
    else howl.volume(usePlayerStore.getState().volume)
    if (!deferCommit) usePlayerStore.getState().setCurrentTime(seekTo ?? 0)
    syncReadyRef.current = true
  }, [])

  const handleHowlPlay = useCallback(
    (howl: Howl, track: Track, soundId: number) => {
      if (howlRef.current !== howl) return

      // 上游 `14-player-controls.js:384` —— 播放态确立即撤加载态。
      // 与 onload 那一处重复是**有意的**：onload 之后仍要 seek/对齐/
      // 等 unlock，这段里雾环该继续显示；真正开播了才撤。
      hideLoading()
      const scheduledStart = scheduledStartRef.current
      if (scheduledStart?.howl === howl) {
        const alignedTime = getScheduledPlaybackPosition(
          scheduledStart.targetTime,
          scheduledStart.executeAt,
          getServerTime(),
        )
        howl.volume(0, soundId)
        setHowlPosition(howl, alignedTime, soundId)
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
          // outgoing 音量为 0 时 fade(0→0) 会让 Howler 的 fade tween 永久
          // 空转（同下方 unmute 处的注释）；直接 dispose 前不必渐弱。
          const crossfadeMs = trackCrossfadeMs()
          if (outgoing.volume() > 0 && crossfadeMs > 0) {
            outgoing.fade(outgoing.volume(), 0, crossfadeMs)
          }
          if (outgoingCleanupTimerRef.current) clearTimeout(outgoingCleanupTimerRef.current)
          outgoingCleanupTimerRef.current = setTimeout(() => {
            outgoingCleanupTimerRef.current = null
            disposeHowl(outgoing)
          }, crossfadeMs)
        }
        if (unmuteTimerRef.current) clearTimeout(unmuteTimerRef.current)
        unmuteTimerRef.current = setTimeout(() => {
          if (howlRef.current !== howl) return
          const latestVolume = usePlayerStore.getState().volume
          // ★ from === to 的 fade 必须短路：Howler 的 _startFadeInterval 在
          //   diff=0 时 steps=0 → 永不满足 clearInterval 条件 → **永久
          //   interval**，每 ~20ms 把 volume 写回 0，吞掉之后一切音量设置
          //   （实测：设置 0.8 后 100ms 内被写回）。latestVolume=0（静音用户）
          //   精确命中这个边界。直接定位到终值即可，无需 tween。
          if (latestVolume > 0) {
            const fadeMs = trackCrossfadeMs() || SCHEDULED_START_FADE_MS
            howl.fade(0, latestVolume, fadeMs, soundId)
          } else {
            howl.volume(0, soundId)
          }
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
    [disposeHowl, startTimeUpdate],
  )

  const handleHowlPause = useCallback(
    (howl: Howl) => {
      if (howlRef.current !== howl) return
      usePlayerStore.getState().setIsPlaying(false)
      stopTimeUpdate()
      // ★ 逐帧时钟必须**主动清空**，不能只靠 250ms 新鲜度窗口兜底。
      //   暂停后 rAF 停摆、`frameTimeStamp` 不再刷新，窗口内（最多 250ms）
      //   的消费方仍会读到"暂停前那一刻"的时间；紧接着拖动进度条时
      //   那条路径只更新 store（`usePlayer.seek`），于是节拍相机与 WebGL
      //   歌词会在这一小段里用**旧位置**推进。清掉即立刻回退到 store。
      //   只影响这条只读旁路时钟，不触碰播放语义。
      lyricPlayerBridge.clearFrameTime()
    },
    [stopTimeUpdate],
  )

  const handleHowlEnd = useCallback(
    (howl: Howl) => {
      if (howlRef.current !== howl) return
      usePlayerStore.getState().setIsPlaying(false)
      stopTimeUpdate()
      lyricPlayerBridge.clearFrameTime()
      onTrackEnd()
    },
    [onTrackEnd, stopTimeUpdate],
  )

  const handleHowlLoadError = useCallback(
    (howl: Howl, rawMessage: unknown) => {
      const msg = typeof rawMessage === 'number' || typeof rawMessage === 'string' ? rawMessage : String(rawMessage)
      // If a newer track has been loaded, this Howl is stale — ignore.
      if (howlRef.current !== howl) return
      if (!retryRef.current) {
        retryRef.current = true
        console.warn('Howl load error, retrying:', msg)
        howl.load()
        return
      }
      retryRef.current = false
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current)
        loadTimerRef.current = null
      }
      const { kind } = classifyMediaElementFailure(typeof msg === 'number' ? msg : null)
      if (isRecoverableStreamFailure(kind) && onPlaybackFailure?.(kind)) {
        console.warn('Howl load error, refreshing stream URL:', msg)
        return
      }
      // 上游 `13-playback-start-audio.js:1516,1541` 的 catch 里也有
      // `hideLoading()` —— 加载失败同样要撤掉加载态，否则雾环会一直飘。
      // （重试分支不撤：那次 `howl.load()` 仍有机会成功。）
      hideLoading()
      console.error('Howl load error (after retry):', msg)
      toast.error(`「${trackTitleRef.current}」加载失败，已跳到下一首`)
      onTrackEnd()
    },
    [onPlaybackFailure, onTrackEnd],
  )

  const handleHowlPlayError = useCallback(
    (howl: Howl, soundId: number) => {
      // Try to recover via Howler unlock; give up after timeout
      if (playErrorTimerRef.current) clearTimeout(playErrorTimerRef.current)
      playErrorTimerRef.current = setTimeout(() => {
        playErrorTimerRef.current = null
        // 停播/切歌后 howlRef 已换或已空：这次 unlock 失败与当前播放无关。
        if (howlRef.current !== howl) return
        console.warn('Howl unlock timeout, skipping track')
        toast.error('播放失败，已跳到下一首')
        onTrackEnd()
      }, PLAY_ERROR_TIMEOUT_MS)
      howl.once('unlock', () => {
        if (howlRef.current !== howl) return // Already switched or unmounted
        if (useSleepTimerStore.getState().localHold) return
        if (playErrorTimerRef.current) {
          clearTimeout(playErrorTimerRef.current)
          playErrorTimerRef.current = null
        }
        howl.play(soundId)
      })
    },
    [onTrackEnd],
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
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current)
        loadTimerRef.current = null
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

      const preloadIdentity = preloadKey(track, track.streamUrl)
      if (preloadedRef.current && preloadedRef.current.key !== preloadIdentity) disposePreloaded()
      const preloaded = preloadedRef.current

      if (preloaded) {
        preloadedRef.current = null
        const howl = preloaded.howl
        howl.on('load', () => handleHowlLoad(howl, seekTo, deferCommit))
        howl.on('play', (soundId) => handleHowlPlay(howl, track, soundId))
        howl.on('pause', () => handleHowlPause(howl))
        howl.on('end', () => handleHowlEnd(howl))
        howl.on('loaderror', (_id, msg) => handleHowlLoadError(howl, msg))
        howl.on('playerror', (soundId) => handleHowlPlayError(howl, soundId))
        howlRef.current = howl
        stretchReadyRef.current = (
          preloaded.canTimeStretch
            ? attachTimeStretch(howl, {
                tempoEnabled: useSettingsStore.getState().playbackTempoSyncEnabled,
              })
            : Promise.resolve(null)
        ).then((controller) => {
          if (howlRef.current === howl) stretchRef.current = controller
          controller?.setEnabled(useSettingsStore.getState().playbackTempoSyncEnabled)
          return controller
        })
        if (!deferCommit) usePlayerStore.getState().setCurrentTrack(track)
        if (howl.state() === 'loaded') {
          handleHowlLoad(howl, seekTo, deferCommit)
        } else {
          showLoading()
          loadTimerRef.current = setTimeout(() => {
            if (howlRef.current !== howl || syncReadyRef.current) return
            loadTimerRef.current = null
            hideLoading()
            disposeHowl(howl)
            if (howlRef.current === howl) howlRef.current = null
            toast.error(`「${trackTitleRef.current}」加载超时，已跳到下一首`)
            onTrackEnd()
          }, LOAD_TIMEOUT_MS)
        }
        return
      }

      // ★ 上游 `06-lyrics/03-podcast-playlist-loaders.js:39,71` 的
      //   `showLoading()` … `finally { hideLoading() }` 形态：开始取内容时
      //   点亮加载态雾环，取到就撤。上游用在播单列表加载；本项目的等价物
      //   是音频缓冲区间（Howl 的 onload/onplay 之前）。
      //
      //   放在 `streamUrl` 空值返回**之后**：没有流地址时根本不会开始加载，
      //   点亮雾环会永远停在那里（`hideLoading` 只由 onload/onplay 触发）。
      showLoading()

      const playbackUrl = buildPlaybackUrl(track, track.streamUrl)
      const streamFormat = streamFormatFor(track)

      // Howler creates its HTMLMediaElement synchronously inside the
      // constructor. Configure CORS before it assigns the direct CDN URL so
      // Web Audio is allowed to consume the stream.
      const canTimeStretch = prepareDirectStreamForTimeStretch(playbackUrl)

      const howl = new Howl({
        src: [playbackUrl],
        html5: true,
        format: streamFormat,
        volume: 0,
        onload: () => handleHowlLoad(howl, seekTo, deferCommit),
        onplay: (soundId) => handleHowlPlay(howl, track, soundId),
        onpause: () => handleHowlPause(howl),
        onend: () => handleHowlEnd(howl),
        onloaderror: (_id, msg) => handleHowlLoadError(howl, msg),
        onplayerror: (soundId: number) => handleHowlPlayError(howl, soundId),
      })

      howlRef.current = howl
      loadTimerRef.current = setTimeout(() => {
        if (howlRef.current !== howl || syncReadyRef.current) return
        loadTimerRef.current = null
        console.warn('Audio load timed out, skipping track')
        // 上游 `12-playback-switch-core.js:20` 的 `if (!isPlaying) hideLoading()`
        // —— 切歌/停播时撤掉加载态。超时放弃同理。
        hideLoading()
        disposeHowl(howl)
        if (howlRef.current === howl) howlRef.current = null
        toast.error(`「${trackTitleRef.current}」加载超时，已跳到下一首`)
        onTrackEnd()
      }, LOAD_TIMEOUT_MS)
      stretchReadyRef.current = (
        canTimeStretch
          ? attachTimeStretch(howl, {
              tempoEnabled: useSettingsStore.getState().playbackTempoSyncEnabled,
            })
          : Promise.resolve(null)
      ).then((controller) => {
        if (howlRef.current === howl) stretchRef.current = controller
        controller?.setEnabled(useSettingsStore.getState().playbackTempoSyncEnabled)
        return controller
      })
      if (!deferCommit) usePlayerStore.getState().setCurrentTrack(track)
    },
    [
      cancelScheduledPlayback,
      disposeHowl,
      disposePreloaded,
      handleHowlEnd,
      handleHowlLoad,
      handleHowlLoadError,
      handleHowlPause,
      handleHowlPlay,
      handleHowlPlayError,
      onTrackEnd,
      startTimeUpdate,
      stopTimeUpdate,
    ],
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

  useEffect(() => registerActivePlaybackStop(stopPlayback), [stopPlayback])

  const setPlaybackTempo = useCallback((tempo: number) => {
    stretchRef.current?.setTempo(tempo)
  }, [])

  /**
   * 预热下一首：只建 Howl（html5 渐进下载 + 静音），不接音频图。
   * 切歌时 `loadTrack` 认出同一 trackId 就接管这个实例，省掉 CDN 往返。
   */
  const preloadTrack = useCallback(
    (track: Track, streamUrl: string) => {
      if (!streamUrl) return
      const key = preloadKey(track, streamUrl)
      if (preloadedRef.current?.key === key) return
      disposePreloaded()
      const playbackUrl = buildPlaybackUrl(track, streamUrl)
      const canTimeStretch = prepareDirectStreamForTimeStretch(playbackUrl)
      const howl = new Howl({
        src: [playbackUrl],
        html5: true,
        format: streamFormatFor(track),
        volume: 0,
        preload: true,
      })
      preloadedRef.current = { key, howl, canTimeStretch }
      howl.once('loaderror', () => {
        if (preloadedRef.current?.howl !== howl) return
        preloadedRef.current = null
        releaseTimeStretch(howl)
        try {
          howl.unload()
        } catch {
          /* ignore */
        }
      })
    },
    [disposePreloaded],
  )

  return {
    howlRef,
    soundIdRef,
    loadTrack,
    preloadTrack,
    disposePreloaded,
    schedulePlayback,
    cancelScheduledPlayback,
    pausePlayback,
    stopPlayback,
    setPlaybackTempo,
  }
}
