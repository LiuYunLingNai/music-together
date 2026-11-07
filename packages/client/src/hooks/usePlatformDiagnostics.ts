import { SERVER_URL } from '@/lib/config'
import type { PlatformDiagnosticsReport } from '@music-together/shared'
import { useCallback, useRef, useState } from 'react'

export function usePlatformDiagnostics(roomId?: string) {
  const [report, setReport] = useState<PlatformDiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    if (!roomId) return
    inFlightRef.current?.abort()
    const controller = new AbortController()
    inFlightRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${SERVER_URL}/api/auth/platform-diagnostics?roomId=${encodeURIComponent(roomId)}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      const data = (await response.json()) as PlatformDiagnosticsReport & { error?: string }
      if (!response.ok) throw new Error(data.error ?? '诊断失败')
      setReport(data)
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      setError(err instanceof Error ? err.message : '诊断失败')
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null
        setLoading(false)
      }
    }
  }, [roomId])

  return { report, loading, error, run }
}
