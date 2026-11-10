import type { Track } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { useRoomStore } from '@/stores/roomStore'

/**
 * 播放源与派生分析源的唯一出口。
 *
 * 酷狗与 B 站必须走本机代理（CK 钥匙 / 防盗链 / 解密），其余平台直连。
 * 播放、拍点分析、画像、分轨都从播放用的同一份 URL 取数，规则只在这里维护。
 */

const LOOKUP_TIMEOUT_MS = 4000

export const playbackUrlFor = (track: Track, streamUrl: string): string => {
  if (!streamUrl) return streamUrl
  const roomId = useRoomStore.getState().room?.id ?? ''
  if (track.source === 'bilibili') {
    return `${SERVER_URL}/api/music/bilibili-audio-proxy?url=${encodeURIComponent(streamUrl)}&bvid=${encodeURIComponent(track.urlId)}&roomId=${encodeURIComponent(roomId)}`
  }
  if (track.source === 'kugou' || track.source === 'kugou_concept') {
    return `${SERVER_URL}/api/music/kugou-audio-proxy?url=${encodeURIComponent(streamUrl)}`
  }
  return streamUrl
}

/** 分析侧使用与播放完全相同的地址；代理规则分开导出，避免调用方各自拼接。 */
export const analysisUrlFor = playbackUrlFor

/**
 * 稳定曲目键：持久化缓存与取数复用都按它对齐，绝不能带会过期的流地址。
 * 时长/音质/格式属于 representation：换源、降档或试听片段不能命中旧分析。
 */
export const trackCacheKey = (
  track: Pick<Track, 'source' | 'urlId' | 'lyricId' | 'title' | 'duration' | 'streamFormat'>,
): string => {
  const identity = track.lyricId ?? track.urlId ?? track.title
  const quality = useRoomStore.getState().room?.audioQuality ?? ''
  return `${track.source}:${identity}:${Math.round(track.duration ?? 0)}:${quality}:${track.streamFormat ?? ''}`
}

/** 解析一首曲目的可播放地址；优先用房间状态里已经带上的 streamUrl。 */
export async function resolveTrackUrl(
  track: Track,
  options: { purpose?: 'play' | 'prefetch' } = {},
): Promise<string | null> {
  const raw = track.streamUrl ?? (await resolveStreamUrl(track, options))
  return raw ? playbackUrlFor(track, raw) : null
}

/** 解析上游直链（未套代理）；预取与预热共用。 */
export async function resolveStreamUrl(
  track: Track,
  options: { purpose?: 'play' | 'prefetch' } = {},
): Promise<string | null> {
  if (track.streamUrl) return track.streamUrl
  const room = useRoomStore.getState().room
  if (!room) return null
  const params = new URLSearchParams({
    source: track.source,
    urlId: track.urlId,
    bitrate: String(room.audioQuality),
    roomId: room.id,
  })
  if (options.purpose === 'prefetch') params.set('purpose', 'prefetch')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const response = await fetch(`${SERVER_URL}/api/music/url?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const data = (await response.json()) as { url?: string | null }
    return data.url ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
