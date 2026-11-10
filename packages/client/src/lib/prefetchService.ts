import type { RoomState, Track } from '@music-together/shared'
import { predictPreviousTrack, predictUpcomingTracks } from './nextTrack'
import { resolveStreamUrl, trackCacheKey } from './playbackSource'
import { getDirectCoverUrl } from './cover'
import { notePlayback } from './playbackDiagnostics'

/**
 * 轻资源预取：前 2 后 1 的播放地址。
 *
 * 只预热服务端与客户端的 URL 缓存，不在这里整曲下载音频；音频缓存由
 * `audioBytes` / `mediaCache` 在处理链里按需写入。B 站地址每次起播都会重新
 * 解析且不进服务端缓存，跳过以免无谓打上游。
 */

const URL_TTL_MS = 20 * 60_000
const PREFETCH_NEXT = 2
const PREFETCH_PREV = 1
const MAX_ENTRIES = 60

interface PrefetchEntry {
  url: string
  fetchedAt: number
}

const entries = new Map<string, PrefetchEntry>()
const prefetchedCovers = new Set<string>()
let generation = 0
let running = false

/** 静态封面预热：减少快速切歌时新图尚未解码而露出旧图的窗口。 */
function prefetchCover(track: Track): void {
  if (!track.cover) return
  const key = trackCacheKey(track)
  if (prefetchedCovers.has(key)) return
  prefetchedCovers.add(key)
  if (prefetchedCovers.size > 200) prefetchedCovers.clear()
  const image = new Image()
  image.decoding = 'async'
  image.src = getDirectCoverUrl(track.cover)
}

const keyOf = (track: Track): string => trackCacheKey(track)

const valid = (entry: PrefetchEntry | undefined): entry is PrefetchEntry =>
  Boolean(entry) && Date.now() - entry!.fetchedAt < URL_TTL_MS

export function getPrefetchedUrl(track: Track): string | null {  const entry = entries.get(keyOf(track))
  if (!valid(entry)) {
    if (entry) entries.delete(keyOf(track))
    return null
  }
  entry.fetchedAt = Date.now()
  return entry.url
}

function remember(track: Track, url: string): void {
  const key = keyOf(track)
  entries.delete(key)
  entries.set(key, { url, fetchedAt: Date.now() })
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

export function clearPrefetchCache(): void {
  generation += 1
  entries.clear()
}

/**
 * 按当前队列预热附近三首的地址。重复调用会作废上一轮尚未返回的结果。
 */
export async function prefetchNearby(room: RoomState | null): Promise<void> {
  if (running || !room || !room.currentTrack) return
  running = true
  try {
    const round = ++generation
    const upcoming = predictUpcomingTracks(room, PREFETCH_NEXT)
    const previous = PREFETCH_PREV > 0 ? predictPreviousTrack(room) : null
    const targets = [...upcoming, ...(previous ? [previous] : [])].filter(
      (track) => track.source !== 'bilibili' && !track.streamUrl,
    )

    for (const track of targets) {
      if (round !== generation) return
      prefetchCover(track)
      if (getPrefetchedUrl(track)) continue
      notePlayback('prefetchRequests')
      const url = await resolveStreamUrl(track, { purpose: 'prefetch' })
      // 新一轮预取已经开始，旧结果不再写入。
      if (round !== generation) return
      if (url) remember(track, url)
    }
  } finally {
    running = false
  }
}
