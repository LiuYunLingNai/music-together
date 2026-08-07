import { SERVER_URL } from '@/lib/config'
import type { PlatformRecommendation } from '@music-together/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

function appendTencentRecommendationPages(
  current: PlatformRecommendation[],
  incoming: PlatformRecommendation[],
): PlatformRecommendation[] {
  const incomingTencent = incoming.find((item) => item.platform === 'tencent')
  if (!incomingTencent) return current

  const currentTencent = current.find((item) => item.platform === 'tencent')
  if (!currentTencent) return [...current, incomingTencent]

  const trackKeys = new Set<string>()
  const tracks = [...currentTencent.tracks, ...incomingTencent.tracks].filter((track) => {
    const key = `${track.source}:${track.sourceId}`
    if (trackKeys.has(key)) return false
    trackKeys.add(key)
    return true
  })
  const playlistKeys = new Set<string>()
  const playlists = [...(currentTencent.playlists ?? []), ...(incomingTencent.playlists ?? [])].filter((playlist) => {
    const key = `${playlist.source}:${playlist.id}`
    if (playlistKeys.has(key)) return false
    playlistKeys.add(key)
    return true
  })
  const mergedTencent: PlatformRecommendation = {
    ...incomingTencent,
    tracks,
    playlists,
    unavailableReason: tracks.length > 0 || playlists.length > 0 ? undefined : incomingTencent.unavailableReason,
  }

  return current.map((item) => (item.platform === 'tencent' ? mergedTencent : item))
}

export function useRecommendations(roomId?: string) {
  const [recommendations, setRecommendations] = useState<PlatformRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const tencentPaginationRef = useRef<PlatformRecommendation['pagination']>(undefined)

  useEffect(
    () => () => {
      abortRef.current?.abort()
      abortRef.current = null
    },
    [],
  )

  const request = useCallback(
    (append: boolean) => {
      abortRef.current?.abort()
      if (!roomId) {
        abortRef.current = null
        tencentPaginationRef.current = undefined
        setRecommendations([])
        setLoading(false)
        setLoadingMore(false)
        setLoaded(true)
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      const pagination = tencentPaginationRef.current
      const params = new URLSearchParams({
        roomId,
        limit: '50',
        radarPage: String(pagination?.tracks?.nextPage ?? 1),
        playlistOffset: String(pagination?.playlists?.nextOffset ?? 0),
        refresh: String(Date.now()),
      })
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
          const tencent = nextRecommendations.find((item) => item.platform === 'tencent')
          tencentPaginationRef.current = tencent?.pagination
          setRecommendations((current) =>
            append ? appendTencentRecommendationPages(current, nextRecommendations) : nextRecommendations,
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
  const loadMore = useCallback(() => request(true), [request])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    tencentPaginationRef.current = undefined
    setRecommendations([])
    setLoading(false)
    setLoadingMore(false)
    setLoaded(false)
  }, [])

  return { recommendations, loading, loadingMore, loaded, load, loadMore, reset }
}
