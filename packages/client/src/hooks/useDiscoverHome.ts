import { getMusicJson } from '@/lib/musicApi'
import { DISCOVER_SOURCES } from '@music-together/shared'
import type { DiscoverHome, MusicSource } from '@music-together/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

const EMPTY_HOME: DiscoverHome = { radar: [], artists: [], albums: [], failed: [] }

/** 账号主页的公共发现区块（雷达歌单、热门歌手、新碟）；`enabled` 为真且平台支持时才请求。 */
export function useDiscoverHome(source: MusicSource, enabled: boolean) {
  const supported = DISCOVER_SOURCES.includes(source)
  const [home, setHome] = useState<DiscoverHome>(EMPTY_HOME)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setFailed(false)
    getMusicJson<DiscoverHome>('discover/home', { source }, controller.signal)
      .then((data) => {
        setHome(data)
        setLoaded(true)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setFailed(true)
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null
          setLoading(false)
        }
      })
  }, [source])

  useEffect(() => {
    if (!supported || !enabled || loaded) return
    const frame = requestAnimationFrame(load)
    return () => cancelAnimationFrame(frame)
  }, [supported, enabled, loaded, load])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { supported, home, loading: loading || (supported && enabled && !loaded && !failed), failed, reload: load }
}
