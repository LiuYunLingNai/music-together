import { useEffect } from 'react'
import type { Track } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { predictNextTrack } from '@/lib/nextTrack'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { getPrefetchedUrl } from '@/lib/prefetchService'
import { getCachedAudioBytes } from '@/lib/mediaCache'
import { fetchAudioBytes } from '@/lib/audioBytes'
import { trackCacheKey, playbackUrlFor, resolveStreamUrl } from '@/lib/playbackSource'
import { notePlayback } from '@/lib/playbackDiagnostics'

/** 提前多久开始解析并缓冲下一首。 */
const PRELOAD_LEAD_SECONDS = 25
/** 媒体缓存开启时，提前把下一首整曲取回本地，普通听歌也能享受缓存。 */
const CACHE_FILL_LEAD_SECONDS = 90
/** 低于这个剩余时间就不再启动整曲缓存，避免和 25 秒的预加载抢带宽。 */
const CACHE_FILL_MIN_REMAINING_SECONDS = 40
const LOOKUP_TIMEOUT_MS = 4000

/**
 * 弱网下不预热：同时拉两条流会把当前曲目挤到缓冲不足，
 * 反而造成可感知的断顿。
 */
function networkAllowsPreload(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  if (!connection) return true
  if (connection.saveData) return false
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g'
}

/**
 * 播放接近尾声时预热下一首。服务端的 URL 缓存与并发合并保证多客户端只打一次上游。
 * Bilibili 的播放地址依赖个人 cookie 且由服务端随房间状态下发，这里跳过。
 */
export function useNextTrackPreload(
  preloadTrack: (track: Track, streamUrl: string, directUrl?: string) => void,
  disposePreloaded: () => void,
): void {
  useEffect(() => {
    let disposed = false
    let inFlightFor: string | null = null
    let loadedFor: string | null = null
    let cacheFillFor: string | null = null
    let controller: AbortController | null = null
    let cacheFillController: AbortController | null = null

    const tick = (): void => {
      if (disposed) return
      const { preloadNextTrack } = useAudioSettingsStore.getState()
      const room = useRoomStore.getState().room
      const { currentTime, duration, isPlaying } = usePlayerStore.getState()
      const current = room?.currentTrack
      const next = predictNextTrack(room)
      const usable =
        preloadNextTrack &&
        networkAllowsPreload() &&
        Boolean(room) &&
        Boolean(current) &&
        Boolean(next) &&
        next!.id !== current!.id &&
        next!.source !== 'bilibili' &&
        isPlaying &&
        room!.playState.isPlaying

      if (!usable) {
        if (loadedFor) disposePreloaded()
        loadedFor = null
        inFlightFor = null
        cacheFillFor = null
        cacheFillController?.abort()
        cacheFillController = null
        return
      }
      if (loadedFor && loadedFor !== next!.id) {
        disposePreloaded()
        loadedFor = null
      }
      if (cacheFillFor && cacheFillFor !== next!.id) {
        // 快速切歌时别让上一首的整曲下载继续抢当前播放的带宽。
        cacheFillController?.abort()
        cacheFillController = null
        cacheFillFor = null
      }
      if (inFlightFor && inFlightFor !== next!.id) inFlightFor = null
      if (loadedFor === next!.id) return

      const remaining = duration - currentTime
      if (!Number.isFinite(remaining) || remaining > PRELOAD_LEAD_SECONDS) {
        // 媒体缓存开启时，提前把下一首整曲取回本地；缓存命中时几乎不花时间。
        const settings = useAudioSettingsStore.getState()
        const cacheFillEnabled = settings.mediaCacheEnabled && settings.mediaCacheLimitMb > 0
        if (
          cacheFillEnabled &&
          Number.isFinite(remaining) &&
          remaining <= CACHE_FILL_LEAD_SECONDS &&
          remaining > CACHE_FILL_MIN_REMAINING_SECONDS &&
          cacheFillFor !== next!.id
        ) {
          cacheFillFor = next!.id
          const fillController = new AbortController()
          cacheFillController = fillController
          void (async () => {
            const raw = getPrefetchedUrl(next!) ?? (await resolveStreamUrl(next!, { purpose: 'prefetch' }))
            if (!raw || disposed || fillController.signal.aborted) return
            await fetchAudioBytes(trackCacheKey(next!), playbackUrlFor(next!, raw), {
              persist: true,
              statedDurationSec: next!.duration,
              signal: fillController.signal,
            })
          })()
        }
        return
      }
      if (inFlightFor === next!.id) return

      const trackId = next!.id
      // 附近预取已经拿到直链时直接复用，避免再打一次 /api/music/url。
      const prefetchedUrl = getPrefetchedUrl(next!)
      if (prefetchedUrl) {
        notePlayback('prefetchHits')
        loadedFor = trackId
        preloadTrack(next!, prefetchedUrl)
        return
      }
      const roomId = room!.id
      const params = new URLSearchParams({
        source: next!.source,
        urlId: next!.urlId,
        bitrate: String(room!.audioQuality),
        roomId,
      })
      const loadFromNetwork = (): void => {
        inFlightFor = trackId
        controller?.abort()
        const requestController = new AbortController()
        controller = requestController
        const timer = setTimeout(() => requestController.abort(), LOOKUP_TIMEOUT_MS)
        void fetch(`${SERVER_URL}/api/music/url?${params}`, {
          credentials: 'include',
          signal: requestController.signal,
        })
          .then(async (response) => {
            if (!response.ok) return null
            const data = (await response.json()) as { url?: string | null }
            return data.url ?? null
          })
          .catch(() => null)
          .then((url) => {
            clearTimeout(timer)
            if (disposed || inFlightFor !== trackId) return
            inFlightFor = null
            if (!url) return
            loadedFor = trackId
            preloadTrack(next!, url)
          })
      }

      // 播放侧只认解码校验过的整曲；预取写入的字节可能只是试听片段。
      inFlightFor = trackId
      void getCachedAudioBytes(trackCacheKey(next!), { requireValidated: true }).then((bytes) => {
        if (disposed || inFlightFor !== trackId) return
        if (!bytes) {
          loadFromNetwork()
          return
        }
        inFlightFor = null
        loadedFor = trackId
        notePlayback('blobPreloads')
        const blobUrl = URL.createObjectURL(new Blob([bytes]))
        preloadTrack(next!, next!.streamUrl ?? '', blobUrl)
      })
    }

    const interval = setInterval(tick, 1000)
    tick()
    return () => {
      disposed = true
      clearInterval(interval)
      controller?.abort()
      controller = null
      cacheFillController?.abort()
      cacheFillController = null
      disposePreloaded()
    }
  }, [disposePreloaded, preloadTrack])
}
