import type { Track } from '../domain/types'
import { prepareLyricGroups } from '../lyrics/engine'
import { parseServerLyrics, parseTtml } from '../lyrics/parser'
import { enrichLyricLines, needsLyricSupplement, preferLyricCandidate } from '../lyrics/selection'
import { useAppStore } from '../store/app-store'
import { fetchLyricSupplement, fetchServerLyrics, type ServerLyrics } from './api'

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
  let bestLines: ReturnType<typeof parseTtml> = []
  let bestSource = ''
  let platformRaw: ServerLyrics | undefined
  let ttmlLines: ReturnType<typeof parseTtml> = []
  const commit = (lines: ReturnType<typeof parseTtml>, sourceLabel: string) => {
    if (!isCurrent() || !lines.length) return
    const groups = prepareLyricGroups(lines)
    if (!prefetch) state.set({ lyricGroups: groups, lyricSource: sourceLabel, lyricsLoading: false, lyricsError: undefined })
    lyricCache.delete(key)
    lyricCache.set(key, { groups, source: sourceLabel, expires: Date.now() + 30 * 60_000 })
    while (lyricCache.size > 30) lyricCache.delete(lyricCache.keys().next().value!)
  }
  const publish = (lines: ReturnType<typeof parseTtml>, sourceLabel: string) => {
    if (!isCurrent() || !lines.length) return
    if (bestLines.length && !preferLyricCandidate(bestLines, lines, platformRaw?.lyric, sourceLabel === 'TTML')) return
    bestLines = lines
    bestSource = sourceLabel
    commit(lines, sourceLabel)
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
        ttmlLines = parseTtml(await response.text())
        publish(ttmlLines, 'TTML')
      }
    } catch {
      // Platform lyrics below are the offline-compatible fallback.
    }
  }
  const platformTask = async () => {
    if (!track.lyricId) return
    platformRaw = await fetchServerLyrics(state.serverUrl, source, track.lyricId,
      AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]))
    const parsed = parseServerLyrics(platformRaw)
    publish(parsed.lines, parsed.source)
  }
  await Promise.allSettled([ttmlTask(), platformTask()])
  let candidates: ServerLyrics[] = []
  if (track.lyricId && track.artist.length && track.duration > 0 && needsLyricSupplement(bestLines, platformRaw?.lyric)) {
    try {
      const supplement = await fetchLyricSupplement(
        state.serverUrl,
        track,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      )
      candidates = supplement.candidates?.length ? supplement.candidates : supplement.source ? [supplement] : []
      for (const candidate of candidates) {
        const parsed = parseServerLyrics(candidate)
        publish(parsed.lines, `跨源 ${parsed.source}`)
      }
    } catch { /* Supplement failure keeps the selected base timeline. */ }
  }
  if (bestLines.length) {
    bestLines = enrichLyricLines(bestLines, [...(platformRaw ? [platformRaw] : []), ...candidates], ttmlLines)
    commit(bestLines, bestSource)
  }
  if (!prefetch && isCurrent() && !bestLines.length) state.set({ lyricsLoading: false, lyricsError: '暂无可用歌词，请稍后重试' })
}
