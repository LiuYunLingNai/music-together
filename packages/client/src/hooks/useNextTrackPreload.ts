import { useEffect } from 'react'
import type { Track } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { predictNextTrack } from '@/lib/nextTrack'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'

/** 提前多久开始解析并缓冲下一首。 */
const PRELOAD_LEAD_SECONDS = 25
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
  preloadTrack: (track: Track, streamUrl: string) => void,
  disposePreloaded: () => void,
): void {
  useEffect(() => {
    let disposed = false
    let inFlightFor: string | null = null
    let loadedFor: string | null = null
    let controller: AbortController | null = null

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
        return
      }
      if (loadedFor && loadedFor !== next!.id) {
        disposePreloaded()
        loadedFor = null
      }
      if (inFlightFor && inFlightFor !== next!.id) inFlightFor = null
      if (loadedFor === next!.id) return

      const remaining = duration - currentTime
      if (!Number.isFinite(remaining) || remaining > PRELOAD_LEAD_SECONDS) return
      if (inFlightFor === next!.id) return

      const trackId = next!.id
      const roomId = room!.id
      const params = new URLSearchParams({
        source: next!.source,
        urlId: next!.urlId,
        bitrate: String(room!.audioQuality),
        roomId,
      })
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

    const interval = setInterval(tick, 1000)
    tick()
    return () => {
      disposed = true
      clearInterval(interval)
      controller?.abort()
      controller = null
      disposePreloaded()
    }
  }, [disposePreloaded, preloadTrack])
}
