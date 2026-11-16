import { SERVER_URL } from '@/lib/config'
import type { Track } from '@music-together/shared'
import { useEffect, useState } from 'react'
import { useRoomStore } from '@/stores/roomStore'

interface DynamicCoverState {
  key: string
  url: string | null
}

/** 让播放先起步（推流、歌词），顺手跳过快速切歌时不会真正停留的曲目。 */
const LOOKUP_DELAY_MS = 350
/** 歌手名不会包含这个分隔符，用它把数组压成稳定的依赖值。 */
const ARTIST_SEPARATOR = '\u0001'

/**
 * 解析当前歌曲的动态封面（视频封面），对齐上游 `musicCoverIsVideoAtom`。
 * 上游只读取本地音乐文件；这里向服务端按音源歌曲 id + 元数据查询，无动态封面时返回 null。
 * 纯旁路：不 await 播放链路，结果晚到就晚到，静态封面先显示。
 */
export function useDynamicCover(track: Track | null | undefined, enabled = true): string | null {
  const source = track?.source
  const id = track?.urlId
  const roomId = useRoomStore((state) => state.room?.id)
  const title = track?.title ?? ''
  const artists = track?.artist.join(ARTIST_SEPARATOR) ?? ''
  const album = track?.album ?? ''
  const duration = track?.duration ?? 0
  // B 站曲目本身就是视频源，没有动态封面语义。
  const key = source && id && source !== 'bilibili' ? `${source}:${id}` : null
  const [state, setState] = useState<DynamicCoverState | null>(null)

  useEffect(() => {
    if (!enabled || !key || !source || !id) return

    const controller = new AbortController()
    const params = new URLSearchParams({ source, id })
    if (roomId) params.set('roomId', roomId)
    if (title) params.set('title', title)
    for (const artist of artists ? artists.split(ARTIST_SEPARATOR) : []) params.append('artists', artist)
    if (album) params.set('album', album)
    if (duration > 0) params.set('duration', String(duration))

    const timer = window.setTimeout(() => {
      fetch(`${SERVER_URL}/api/music/dynamic-cover?${params.toString()}`, {
        signal: controller.signal,
        credentials: 'include',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { url?: string | null } | null) => {
          if (controller.signal.aborted) return
          setState({ key, url: body?.url ?? null })
        })
        .catch(() => {})
    }, LOOKUP_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [enabled, key, source, id, roomId, title, artists, album, duration])

  // 换歌后旧结果不能沿用，等新歌的查询落地再显示。
  return enabled && key && state?.key === key ? state.url : null
}
