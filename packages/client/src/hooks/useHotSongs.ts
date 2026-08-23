import { useCallback, useEffect, useRef, useState } from 'react'
import type { HotSongsSource, Track } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'

interface HotSongsResponse {
  id: string
  source: HotSongsSource
  name: string
  tracks: Track[]
  total: number
  offset: number
  hasMore: boolean
}

interface HotSongsState {
  roomId: string | null
  source: HotSongsSource
  refreshToken: number
  tracks: Track[]
  name: string
  error: string | null
  hasMore: boolean
}

const SOURCE_NAMES: Record<HotSongsSource, string> = {
  netease: '网易云热歌榜',
  tencent: 'QQ 音乐热歌榜',
  kugou: '酷狗热歌榜',
}

export function useHotSongs(roomId: string | undefined, source: HotSongsSource, pageSize = 30, enabled = true) {
  const [state, setState] = useState<HotSongsState>({
    roomId: null,
    source: 'netease',
    refreshToken: -1,
    tracks: [],
    name: SOURCE_NAMES.netease,
    error: null,
    hasMore: false,
  })
  const [refreshRequest, setRefreshRequest] = useState<{ source: HotSongsSource | null; token: number }>({
    source: null,
    token: 0,
  })
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null)
  const loadingMoreRef = useRef(false)
  const loadMoreControllerRef = useRef<AbortController | null>(null)
  const refreshToken = refreshRequest.source === source ? refreshRequest.token : 0
  const requestKey = `${roomId ?? ''}:${source}:${refreshToken}`

  useEffect(() => {
    loadMoreControllerRef.current?.abort()
    loadingMoreRef.current = false
    if (!roomId || !enabled) return
    const controller = new AbortController()

    const params = new URLSearchParams({ roomId, source, limit: String(pageSize), offset: '0' })
    if (refreshToken > 0) params.set('refresh', 'true')

    fetch(`${SERVER_URL}/api/music/hot?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
      cache: refreshToken === 0 ? 'default' : 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '热歌榜加载失败')
        return (await response.json()) as HotSongsResponse
      })
      .then((data) =>
        setState({
          roomId,
          source,
          refreshToken,
          tracks: data.tracks,
          name: data.name,
          error: null,
          hasMore: data.hasMore,
        }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          roomId,
          source,
          refreshToken,
          tracks: [],
          name: SOURCE_NAMES[source],
          error: error instanceof Error ? error.message : '热歌榜加载失败',
          hasMore: false,
        })
      })

    return () => {
      controller.abort()
      loadMoreControllerRef.current?.abort()
      loadingMoreRef.current = false
    }
  }, [roomId, pageSize, refreshToken, enabled, source])

  const refresh = useCallback(
    () =>
      setRefreshRequest((current) => ({
        source,
        token: current.source === source ? current.token + 1 : 1,
      })),
    [source],
  )

  const loadMore = useCallback(() => {
    if (!enabled || !roomId || loadingMoreRef.current) return
    if (state.roomId !== roomId || state.source !== source || state.refreshToken !== refreshToken) return
    if (!state.hasMore) return

    const controller = new AbortController()
    loadMoreControllerRef.current?.abort()
    loadMoreControllerRef.current = controller
    loadingMoreRef.current = true
    setLoadingMoreKey(requestKey)

    const params = new URLSearchParams({
      roomId,
      source,
      limit: String(pageSize),
      offset: String(state.tracks.length),
    })

    fetch(`${SERVER_URL}/api/music/hot?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '加载更多失败')
        return (await response.json()) as HotSongsResponse
      })
      .then((data) => {
        setState((current) => {
          if (current.roomId !== roomId || current.source !== source || current.refreshToken !== refreshToken) return current
          return {
            ...current,
            tracks: [...current.tracks, ...data.tracks],
            error: null,
            hasMore: data.hasMore,
          }
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => {
          if (current.roomId !== roomId || current.source !== source || current.refreshToken !== refreshToken) return current
          return { ...current, error: error instanceof Error ? error.message : '加载更多失败' }
        })
      })
      .finally(() => {
        if (loadMoreControllerRef.current !== controller) return
        loadMoreControllerRef.current = null
        loadingMoreRef.current = false
        setLoadingMoreKey(null)
      })
  }, [enabled, pageSize, refreshToken, requestKey, roomId, source, state])

  const isCurrentRequest = state.roomId === roomId && state.source === source && state.refreshToken === refreshToken
  return {
    tracks: isCurrentRequest ? state.tracks : [],
    name: isCurrentRequest ? state.name : SOURCE_NAMES[source],
    error: isCurrentRequest ? state.error : null,
    hasMore: isCurrentRequest && state.hasMore,
    loading: enabled && Boolean(roomId) && !isCurrentRequest,
    loadingMore: loadingMoreKey === requestKey,
    refresh,
    loadMore,
  }
}
