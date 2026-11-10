import { useEffect } from 'react'
import { prefetchNearby } from '@/lib/prefetchService'
import { useRoomStore } from '@/stores/roomStore'

const PREFETCH_INTERVAL_MS = 15_000

/** 弱网/省流量时不做额外解析，避免与当前播放抢带宽。 */
function networkAllowsPrefetch(): boolean {
  if (typeof document !== 'undefined' && document.hidden) return false
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  if (!connection) return true
  if (connection.saveData) return false
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g'
}

/** 队列附近（前 2 后 1）的播放地址预热；真正的音频字节由处理链按需写入。 */
export function useNearbyPrefetch(): void {
  useEffect(() => {
    let disposed = false
    const tick = (): void => {
      if (disposed || !networkAllowsPrefetch()) return
      void prefetchNearby(useRoomStore.getState().room)
    }
    const interval = setInterval(tick, PREFETCH_INTERVAL_MS)
    tick()
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [])
}
