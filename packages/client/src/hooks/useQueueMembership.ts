import { trackKey } from '@/lib/utils'
import { useRoomStore } from '@/stores/roomStore'
import type { Track } from '@music-together/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const EMPTY_QUEUE: Track[] = []

/** 已发出但还没出现在队列里的歌曲，按「已添加」计的最长时间（服务端可能拒收）。 */
const PENDING_MS = 5_000

/**
 * 歌曲是否在房间队列中，供能往队列里加歌的列表使用。刚发出的歌曲立即算作已添加，
 * 进入队列后以队列为准（移出队列即可再添加），服务端未收下的几秒后恢复可添加。
 */
export function useQueueMembership() {
  const queue = useRoomStore((state) => state.room?.queue ?? EMPTY_QUEUE)
  const queueKeys = useMemo(() => new Set(queue.map(trackKey)), [queue])
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setPending((current) => {
        const stillPending = [...current].filter((key) => !queueKeys.has(key))
        return stillPending.length === current.size ? current : new Set(stillPending)
      }),
    )
    return () => cancelAnimationFrame(frame)
  }, [queueKeys])

  useEffect(() => {
    const active = timers.current
    return () => {
      for (const timer of active.values()) clearTimeout(timer)
      active.clear()
    }
  }, [])

  const isAdded = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      return queueKeys.has(key) || pending.has(key)
    },
    [queueKeys, pending],
  )

  const markPending = useCallback((tracks: Track[]) => {
    const keys = tracks.map(trackKey)
    setPending((current) => new Set([...current, ...keys]))
    for (const key of keys) {
      clearTimeout(timers.current.get(key))
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key)
          setPending((current) => {
            if (!current.has(key)) return current
            const next = new Set(current)
            next.delete(key)
            return next
          })
        }, PENDING_MS),
      )
    }
  }, [])

  return { queue, queueKeys, pending, isAdded, markPending }
}
