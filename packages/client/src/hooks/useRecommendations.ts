import { SERVER_URL } from '@/lib/config'
import type { PlatformRecommendation } from '@music-together/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export function useRecommendations(roomId?: string) {
  const [recommendations, setRecommendations] = useState<PlatformRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const load = useCallback(() => {
    abortRef.current?.abort()
    if (!roomId) {
      setRecommendations([])
      setLoaded(true)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    const params = new URLSearchParams({ roomId, limit: '50', refresh: String(Date.now()) })
    setLoading(true)

    fetch(`${SERVER_URL}/api/music/recommendations?${params}`, {
      signal: controller.signal,
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Recommendations failed: ${response.status}`)
        return response.json() as Promise<{ recommendations?: PlatformRecommendation[] }>
      })
      .then((data) => setRecommendations(data.recommendations ?? []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setRecommendations([])
        toast.error('加载平台推荐失败，请稍后重试')
      })
      .finally(() => {
        if (abortRef.current === controller) {
          setLoading(false)
          setLoaded(true)
        }
      })
  }, [roomId])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setRecommendations([])
    setLoading(false)
    setLoaded(false)
  }, [])

  return { recommendations, loading, loaded, load, reset }
}
