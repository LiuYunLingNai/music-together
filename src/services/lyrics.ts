import type { Track } from '../domain/types'
import { prepareLyricGroups } from '../lyrics/engine'
import { parseServerLyrics, parseTtml } from '../lyrics/parser'
import { useAppStore } from '../store/app-store'
import { fetchServerLyrics } from './api'

let prefetchController: AbortController | undefined
export function cancelLyrics(): void {
  lyricVersion++
  lyricController?.abort()
  prefetchController?.abort()
}

let lyricVersion = 0
let lyricController: AbortController | undefined
const lyricCache = new Map<string, { expires: number; groups: ReturnType<typeof prepareLyricGroups>; source: string }>()

export async function loadLyrics(track: Track, prefetch = false): Promise<void> {
  const version = prefetch ? lyricVersion : ++lyricVersion
  if (!prefetch) lyricController?.abort()
  const controller = new AbortController()
  if (prefetch) { prefetchController?.abort(); prefetchController = controller }
  else lyricController = controller
  const state = useAppStore.getState()
  if (!prefetch) state.set({ lyricsLoading: true, lyricsError: undefined, lyricGroups: [] })
  const source = track.metadataSource ?? track.source
  const ttmlId = track.metadataSource ? track.lyricId : track.sourceId
  const settings = state.lyricSettings
  const key = JSON.stringify([state.serverUrl, source, track.lyricId, ttmlId, settings.ttmlEnabled, settings.ttmlDbUrl])
  const cached = lyricCache.get(key)
  if (cached && cached.expires > Date.now()) {
    lyricCache.delete(key)
    lyricCache.set(key, cached)
    if (!prefetch) state.set({ lyricGroups: cached.groups, lyricSource: cached.source, lyricsLoading: false })
    return
  }
  const isCurrent = () => !controller.signal.aborted && (prefetch || (
    version === lyricVersion && useAppStore.getState().serverUrl === state.serverUrl &&
    useAppStore.getState().room?.id === state.room?.id && useAppStore.getState().room?.currentTrack?.id === track.id
  ))
  let bestScore = -1
  const publish = (lines: ReturnType<typeof parseTtml>, sourceLabel: string) => {
    if (!isCurrent() || !lines.length) return
    const score = lines.some((line) => line.words.length > 1) ? 2 : 0
    const rank = score + (sourceLabel === 'TTML' ? 1 : 0)
    if (rank <= bestScore) return
    bestScore = rank
    const groups = prepareLyricGroups(lines)
    if (!prefetch) state.set({ lyricGroups: groups, lyricSource: sourceLabel, lyricsLoading: false, lyricsError: undefined })
    lyricCache.delete(key)
    lyricCache.set(key, { groups, source: sourceLabel, expires: Date.now() + 30 * 60_000 })
    while (lyricCache.size > 30) lyricCache.delete(lyricCache.keys().next().value!)
  }
  const ttmlUrl = source === 'netease'
    ? settings.ttmlDbUrl.replace('%s', encodeURIComponent(ttmlId ?? ''))
    : source === 'tencent'
      ? `https://amlldb.bikonoo.com/qq-lyrics/${encodeURIComponent(ttmlId ?? '')}.ttml`
      : ''
  const ttmlTask = async () => {
    if (!settings.ttmlEnabled || !ttmlUrl || !ttmlId) return
    try {
      const response = await fetch(ttmlUrl, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      if (response.ok) {
        const lines = parseTtml(await response.text())
        publish(lines, 'TTML')
      }
    } catch {
      // Platform lyrics below are the offline-compatible fallback.
    }
  }
  const platformTask = async () => {
    if (!track.lyricId) return
    const parsed = parseServerLyrics(await fetchServerLyrics(state.serverUrl, source, track.lyricId,
      AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])))
    publish(parsed.lines, parsed.source)
  }
  await Promise.allSettled([ttmlTask(), platformTask()])
  if (!prefetch && isCurrent() && bestScore < 0) state.set({ lyricsLoading: false, lyricsError: '暂无可用歌词，请稍后重试' })
}
