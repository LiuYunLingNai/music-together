import { SERVER_URL } from '@/lib/config'
import type { MusicSource, UnifiedSearchGroup } from '@music-together/shared'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

const UNIFIED_PAGE_SIZE = 10

/** 跨源统一搜索：一次请求拿到四个平台的同曲分组。 */
export function useUnifiedSearch(roomId?: string) {
  const [groups, setGroups] = useState<UnifiedSearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [failedSources, setFailedSources] = useState<MusicSource[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const searchIdRef = useRef(0)

  const search = useCallback(
    async (keyword: string) => {
      const trimmed = keyword.trim()
      if (!trimmed) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const searchId = ++searchIdRef.current
      setLoading(true)
      try {
        const params = new URLSearchParams({ keyword: trimmed, limit: String(UNIFIED_PAGE_SIZE) })
        if (roomId) params.set('roomId', roomId)
        const response = await fetch(`${SERVER_URL}/api/music/search-all?${params}`, {
          signal: controller.signal,
          credentials: 'include',
        })
        if (!response.ok) throw new Error('unified search failed')
        const data = (await response.json()) as {
          groups?: UnifiedSearchGroup[]
          failedSources?: MusicSource[]
        }
        if (searchId !== searchIdRef.current) return
        setGroups(data.groups ?? [])
        setFailedSources(data.failedSources ?? [])
        setHasSearched(true)
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return
        if (searchId === searchIdRef.current) toast.error('统一搜索失败，请稍后重试')
      } finally {
        if (searchId === searchIdRef.current) setLoading(false)
      }
    },
    [roomId],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    searchIdRef.current += 1
    setGroups([])
    setHasSearched(false)
    setFailedSources([])
    setLoading(false)
  }, [])

  return { groups, loading, hasSearched, failedSources, search, reset }
}
