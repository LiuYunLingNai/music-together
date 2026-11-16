import type { Track } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { useRoomStore } from '@/stores/roomStore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * 当前曲目在听众自己网易云账号里的喜欢状态。
 * 只有网易云数字 id 可写；其他平台隐藏入口，避免误导。
 */
export function useTrackLike(track: Track | null | undefined) {
  const roomId = useRoomStore((state) => state.room?.id ?? null)
  const available = Boolean(track && track.source === 'netease' && /^\d+$/.test(track.urlId) && roomId)
  const id = track?.urlId ?? ''
  const [liked, setLiked] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 用户刚点过喜欢：在途的 GET 回来时不能把它覆盖回旧值。 */
  const mutatedRef = useRef(false)

  useEffect(() => {
    if (!available || !roomId) return
    mutatedRef.current = false
    const controller = new AbortController()
    const params = new URLSearchParams({ source: 'netease', id, roomId })
    fetch(`${SERVER_URL}/api/music/liked?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { liked?: boolean } | null) => {
        if (!controller.signal.aborted && !mutatedRef.current) setLiked(body?.liked === true)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [available, id, roomId])

  const toggle = useCallback(async () => {
    if (!available || !roomId || busy) return
    mutatedRef.current = true
    const next = !liked
    setLiked(next)
    setBusy(true)
    try {
      const response = await fetch(`${SERVER_URL}/api/music/liked`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'netease', id, roomId, liked: next }),
      })
      if (!response.ok) {
        setLiked(!next)
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? '喜欢操作失败')
      }
    } catch {
      setLiked(!next)
      toast.error('喜欢操作失败')
    } finally {
      setBusy(false)
    }
  }, [available, busy, id, liked, roomId])

  return { available, liked, busy, toggle }
}
