import { SERVER_URL } from '@/lib/config'
import type { MusicSource, PlatformRecommendation } from '@music-together/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

function appendRecommendationPages(
  current: PlatformRecommendation[],
  incoming: PlatformRecommendation[],
): PlatformRecommendation[] {
  const merged = [...current]
  for (const incomingItem of incoming) {
    const index = merged.findIndex((item) => item.platform === incomingItem.platform)
    if (index < 0) {
      merged.push(incomingItem)
      continue
    }

    const currentItem = merged[index]!
    const trackKeys = new Set<string>()
    const tracks = [...currentItem.tracks, ...incomingItem.tracks].filter((track) => {
      const key = `${track.source}:${track.sourceId}`
      if (trackKeys.has(key)) return false
      trackKeys.add(key)
      return true
    })
    const playlistKeys = new Set<string>()
    const playlists = [...(currentItem.playlists ?? []), ...(incomingItem.playlists ?? [])].filter((playlist) => {
      const key = `${playlist.source}:${playlist.id}`
      if (playlistKeys.has(key)) return false
      playlistKeys.add(key)
      return true
    })
    merged[index] = {
      ...incomingItem,
      tracks,
      playlists,
      unavailableReason: tracks.length > 0 || playlists.length > 0 ? undefined : incomingItem.unavailableReason,
    }
  }
  return merged
}

export function useRecommendations(roomId?: string) {
  const [recommendations, setRecommendations] = useState<PlatformRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const paginationRef = useRef<Partial<Record<MusicSource, PlatformRecommendation['pagination']>>>({})

  useEffect(
    () => () => {
      abortRef.current?.abort()
      abortRef.current = null
    },
    [],
  )

  const request = useCallback(
    (append: boolean, platform?: MusicSource) => {
      abortRef.current?.abort()
      if (!roomId) {
        abortRef.current = null
        paginationRef.current = {}
        setRecommendations([])
        setLoading(false)
        setLoadingMore(false)
        setLoaded(true)
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      if (!append) paginationRef.current = {}
      const tencentPagination = paginationRef.current.tencent
      const neteasePagination = paginationRef.current.netease
      const params = new URLSearchParams({
        roomId,
        limit: '50',
        radarPage: String(tencentPagination?.tracks?.nextPage ?? 1),
        playlistOffset: String(tencentPagination?.playlists?.nextOffset ?? 0),
        neteasePlaylistOffset: String(neteasePagination?.playlists?.nextOffset ?? 0),
        refresh: String(Date.now()),
      })
      if (append && platform) params.set('platform', platform)
      setLoading(!append)
      setLoadingMore(append)

      fetch(`${SERVER_URL}/api/music/recommendations?${params}`, {
        signal: controller.signal,
        credentials: 'include',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Recommendations failed: ${response.status}`)
          return response.json() as Promise<{ recommendations?: PlatformRecommendation[] }>
        })
        .then((data) => {
          const nextRecommendations = data.recommendations ?? []
          for (const recommendation of nextRecommendations) {
            paginationRef.current[recommendation.platform] = recommendation.pagination
          }
          setRecommendations((current) =>
            append ? appendRecommendationPages(current, nextRecommendations) : nextRecommendations,
          )
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          toast.error('加载平台推荐失败，请稍后重试')
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null
            setLoading(false)
            setLoadingMore(false)
            setLoaded(true)
          }
        })
    },
    [roomId],
  )

  const load = useCallback(() => request(false), [request])
  const loadMore = useCallback((platform: MusicSource) => request(true, platform), [request])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    paginationRef.current = {}
    setRecommendations([])
    setLoading(false)
    setLoadingMore(false)
    setLoaded(false)
  }, [])

  return { recommendations, loading, loadingMore, loaded, load, loadMore, reset }
}
