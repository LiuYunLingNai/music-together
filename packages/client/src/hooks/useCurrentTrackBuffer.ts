import { useEffect } from 'react'
import { fetchAudioBytes } from '@/lib/audioBytes'
import { clearOfflineBuffer, hasOfflineBuffer, holdOfflineBuffer } from '@/lib/offlineTrackBuffer'
import { playbackUrlFor, trackCacheKey } from '@/lib/playbackSource'
import { useAudioSettingsStore } from '@/stores/audioSettingsStore'
import { usePlayerStore } from '@/stores/playerStore'

/** 让出起播阶段的带宽，等当前曲目稳定播放后再整首取回。 */
const START_DELAY_MS = 4_000
/** 低于这个体积多半是试听片段或错误页（约 32kbps 的 80%）。 */
const MIN_BYTES_PER_SECOND = 3_200

function networkAllowsFullFetch(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection
  if (!connection) return true
  if (connection.saveData) return false
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g'
}

/** 开启「断网保护」时，在后台把当前歌曲整首取回本机。 */
export function useCurrentTrackBuffer(): void {
  const enabled = useAudioSettingsStore((state) => state.bufferCurrentTrack)
  const track = usePlayerStore((state) => state.currentTrack)
  const trackId = track?.id
  const streamUrl = track?.streamUrl

  useEffect(() => {
    if (!enabled || !track || !streamUrl || !networkAllowsFullFetch()) {
      clearOfflineBuffer()
      return
    }
    if (hasOfflineBuffer(track.id)) return
    clearOfflineBuffer()

    const controller = new AbortController()
    const timer = setTimeout(() => {
      void fetchAudioBytes(trackCacheKey(track), playbackUrlFor(track, streamUrl), { signal: controller.signal }).then(
        (bytes) => {
          if (!bytes || controller.signal.aborted) return
          if (track.duration > 0 && bytes.byteLength < track.duration * MIN_BYTES_PER_SECOND) return
          holdOfflineBuffer(track.id, bytes)
        },
      )
    }, START_DELAY_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // track 对象的其它字段变化（歌词、元数据）不应重新取数。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, trackId, streamUrl])
}
