import { SERVER_URL } from '@/lib/config'
import {
  evaluateLyricAnimationQuality,
  normalizeLyricTimeline,
  repairLyricTimeline,
  type LyricAnimationQuality,
} from '@/lib/lyricTimeline'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseTTML, parseYrc } from '@applemusic-like-lyrics/lyric'
import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import type { Track } from '@music-together/shared'
import { useCallback, useEffect, useRef } from 'react'

/** 支持 TTML 的平台 → TTML DB 文件夹映射 */
const TTML_FOLDER_MAP: Record<string, string> = {
  netease: 'ncm-lyrics',
  tencent: 'qq-lyrics',
}

/** TTML 请求超时（ms） */
const TTML_TIMEOUT_MS = 8_000
const QUALITY_GRACE_MS = 200
const LYRIC_CACHE_TTL_MS = 30 * 60 * 1_000
const LYRIC_CACHE_MAX = 30

interface LyricData {
  lyric: string
  tlyric: string
  romalrc: string
  yrc: string
  wordByWord?: AMLLLyricLine[]
}

interface LyricSupplementCandidate extends LyricData {
  source: 'netease' | 'kugou' | 'tencent'
}

interface LyricSupplementData extends LyricData {
  source: 'netease' | 'kugou' | 'tencent' | null
  candidates?: LyricSupplementCandidate[]
}

interface PreparedLyricRequest {
  key: string
  startedAt: number
  controller: AbortController
  ttmlPromise: Promise<AMLLLyricLine[] | null>
  lyricPromise: Promise<LyricData | null>
}

interface LyricPresentation {
  source: 'none' | 'native' | 'ttml'
  lines: AMLLLyricLine[] | null
  lyric: string
  tlyric: string
  unresolvedCount: number
  quality: LyricAnimationQuality
}

interface CachedLyricPresentation {
  expiresAt: number
  value: LyricPresentation
}

const lyricPresentationCache = new Map<string, CachedLyricPresentation>()

/**
 * 将 @applemusic-like-lyrics/lyric 的 LyricLine 转为 @applemusic-like-lyrics/core 的 LyricLine
 * 两者接口略有差异（core 的 LyricWord 多 obscene 字段）
 */
function toCoreLyricLines(lyricLines: ReturnType<typeof parseTTML>['lines']): AMLLLyricLine[] {
  return lyricLines.map((line) => ({
    words: line.words.map((w) => ({
      word: w.word,
      startTime: w.startTime,
      endTime: w.endTime,
      romanWord: w.romanWord ?? '',
      obscene: false,
    })),
    translatedLyric: line.translatedLyric ?? '',
    romanLyric: line.romanLyric ?? '',
    startTime: line.startTime,
    endTime: line.endTime,
    isBG: line.isBG ?? false,
    isDuet: line.isDuet ?? false,
  }))
}

/**
 * parseYrc 返回的是裸 LyricLine[]（无 .lines 包装）
 * 直接转为 core 格式
 */
function yrcToCoreLyricLines(lines: ReturnType<typeof parseYrc>): AMLLLyricLine[] {
  return lines.map((line) => ({
    words: line.words.map((w) => ({
      word: w.word,
      startTime: w.startTime,
      endTime: w.endTime,
      romanWord: w.romanWord ?? '',
      obscene: false,
    })),
    translatedLyric: line.translatedLyric ?? '',
    romanLyric: line.romanLyric ?? '',
    startTime: line.startTime,
    endTime: line.endTime,
    isBG: line.isBG ?? false,
    isDuet: line.isDuet ?? false,
  }))
}

/** 解析 LRC 格式歌词为 {timeMs, text} 数组 */
function parseLRC(lrc: string): { timeMs: number; text: string }[] {
  const lines: { timeMs: number; text: string }[] = []
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
  let match
  while ((match = regex.exec(lrc)) !== null) {
    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
    const timeMs = (minutes * 60 + seconds) * 1000 + ms
    const text = match[4].trim()
    if (text) lines.push({ timeMs, text })
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}

/**
 * 将 LRC 格式的辅助歌词（翻译/罗马音）按时间戳合并到 AMLL LyricLine 的指定字段。
 * 匹配策略：精确匹配 → ±500ms 容差（适配不同平台的时间轴偏差）。
 * 直接修改传入的 lines 数组（避免不必要的拷贝）。
 */
function mergeLRCIntoLines(lines: AMLLLyricLine[], lrc: string, field: 'translatedLyric' | 'romanLyric'): void {
  if (!lrc) return
  const parsed = parseLRC(lrc)
  if (parsed.length === 0) return

  // 构建时间→文本映射（key = 毫秒取整到 100ms，加速查找）
  const map = new Map<number, string>()
  for (const item of parsed) {
    map.set(Math.round(item.timeMs / 100), item.text)
  }

  const TOLERANCE_STEPS = 5 // ±500ms，每步 100ms
  for (const line of lines) {
    // 跳过已有内容的行（TTML 自带时不覆盖）
    if (line[field]) continue

    const key = Math.round(line.startTime / 100)
    const exact = map.get(key)
    if (exact) {
      line[field] = exact
      continue
    }
    // 容差匹配
    for (let offset = 1; offset <= TOLERANCE_STEPS; offset++) {
      const near = map.get(key + offset) ?? map.get(key - offset)
      if (near) {
        line[field] = near
        break
      }
    }
  }
}

function cloneLyricLines(lines: readonly AMLLLyricLine[]): AMLLLyricLine[] {
  return lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
}

function hasUsablePlatformLyric(data: LyricData | null): data is LyricData {
  return !!data && !!(data.lyric || data.yrc || data.wordByWord?.length)
}

function buildNativePresentation(
  data: LyricData | null,
  comparisonCharacterCount = 0,
  referenceLrc = data?.lyric ?? '',
): LyricPresentation {
  let lines: AMLLLyricLine[] | null = null

  if (data?.wordByWord?.length) {
    const nativeLines = cloneLyricLines(data.wordByWord)
    mergeLRCIntoLines(nativeLines, data.tlyric, 'translatedLyric')
    mergeLRCIntoLines(nativeLines, data.romalrc, 'romanLyric')
    const normalized = normalizeLyricTimeline(nativeLines)
    if (normalized.length > 0) lines = normalized
  } else if (data?.yrc) {
    try {
      const parsed = parseYrc(data.yrc)
      if (parsed.length > 0) {
        const nativeLines = yrcToCoreLyricLines(parsed)
        mergeLRCIntoLines(nativeLines, data.tlyric, 'translatedLyric')
        mergeLRCIntoLines(nativeLines, data.romalrc, 'romanLyric')
        const normalized = normalizeLyricTimeline(nativeLines)
        if (normalized.length > 0) lines = normalized
      }
    } catch {
      // Invalid word-by-word data still falls back to the provider's LRC.
    }
  }

  return {
    source: hasUsablePlatformLyric(data) ? 'native' : 'none',
    lines,
    lyric: data?.lyric ?? '',
    tlyric: data?.tlyric ?? '',
    unresolvedCount: 0,
    quality: evaluateLyricAnimationQuality(lines ?? [], referenceLrc, comparisonCharacterCount),
  }
}

function createTtmlPresentation(
  lines: AMLLLyricLine[],
  unresolvedCount: number,
  lyricData: LyricData | null,
  comparisonCharacterCount = 0,
): LyricPresentation {
  return {
    source: 'ttml',
    lines: lines.length > 0 ? lines : null,
    lyric: lyricData?.lyric ?? '',
    tlyric: lyricData?.tlyric ?? '',
    unresolvedCount,
    quality: evaluateLyricAnimationQuality(lines, lyricData?.lyric, comparisonCharacterCount),
  }
}

function buildTtmlPresentation(
  rawTtmlLines: AMLLLyricLine[] | null,
  lyricData: LyricData | null,
  comparisonCharacterCount = 0,
): LyricPresentation | null {
  if (!rawTtmlLines?.length) return null
  const primarySources = lyricData?.lyric ? [{ lrc: lyricData.lyric }] : []
  const repaired = repairLyricTimeline(rawTtmlLines, primarySources)
  return createTtmlPresentation(repaired.lines, repaired.unresolvedCount, lyricData, comparisonCharacterCount)
}

function chooseBetweenPresentations(native: LyricPresentation, ttml: LyricPresentation): LyricPresentation {
  const nativeStructure = native.quality.duetLineCount + native.quality.backgroundLineCount
  const ttmlStructure = ttml.quality.duetLineCount + ttml.quality.backgroundLineCount
  if (nativeStructure !== ttmlStructure) {
    return ttmlStructure > nativeStructure ? ttml : native
  }
  if (native.quality.hasWordAnimation !== ttml.quality.hasWordAnimation) {
    return native.quality.hasWordAnimation ? native : ttml
  }
  if (native.quality.hasWordAnimation && native.quality.confidence > ttml.quality.confidence + 0.03) {
    return native
  }
  return ttml
}

function selectPreferredPresentation(
  rawTtmlLines: AMLLLyricLine[] | null,
  lyricData: LyricData | null,
): LyricPresentation {
  const preliminaryNative = buildNativePresentation(lyricData)
  const preliminaryTtml = buildTtmlPresentation(rawTtmlLines, lyricData)
  if (!preliminaryTtml?.lines?.length) return preliminaryNative

  const comparisonCharacterCount = Math.max(
    preliminaryNative.quality.meaningfulCharacterCount,
    preliminaryTtml.quality.meaningfulCharacterCount,
  )
  const native = buildNativePresentation(lyricData, comparisonCharacterCount)
  const ttml = buildTtmlPresentation(rawTtmlLines, lyricData, comparisonCharacterCount)!
  return chooseBetweenPresentations(native, ttml)
}

function isPresentationBetter(next: LyricPresentation, current: LyricPresentation): boolean {
  const nextStructure = next.quality.duetLineCount + next.quality.backgroundLineCount
  const currentStructure = current.quality.duetLineCount + current.quality.backgroundLineCount
  if (currentStructure > 0 && nextStructure === 0) return false
  if (nextStructure > 0 && currentStructure === 0) {
    return next.quality.validTimingCoverage >= 0.85 && next.quality.textCoverage >= 0.5
  }
  if (next.quality.hasWordAnimation !== current.quality.hasWordAnimation) {
    return next.quality.hasWordAnimation
  }
  if (next.quality.hasWordAnimation) {
    return next.quality.confidence > current.quality.confidence + 0.03
  }
  if (!current.lines?.length && next.lines?.length) return true
  return next.unresolvedCount < current.unresolvedCount
}

function getCachedPresentation(key: string): LyricPresentation | null {
  const cached = lyricPresentationCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    lyricPresentationCache.delete(key)
    return null
  }
  lyricPresentationCache.delete(key)
  lyricPresentationCache.set(key, cached)
  return cached.value
}

function cachePresentation(key: string, value: LyricPresentation): void {
  lyricPresentationCache.delete(key)
  lyricPresentationCache.set(key, { value, expiresAt: Date.now() + LYRIC_CACHE_TTL_MS })
  while (lyricPresentationCache.size > LYRIC_CACHE_MAX) {
    const oldestKey = lyricPresentationCache.keys().next().value
    if (!oldestKey) break
    lyricPresentationCache.delete(oldestKey)
  }
}

function lyricRequestKey(track: Track, ttmlEnabled: boolean, ttmlDbUrl: string): string {
  const lyricSource = track.metadataSource ?? track.source
  const lyricTrackId = track.metadataSource ? track.lyricId : track.sourceId
  return [
    lyricSource,
    track.lyricId ?? '',
    lyricTrackId ?? '',
    track.title,
    track.artist.join('\u0001'),
    track.duration,
    ttmlEnabled ? ttmlDbUrl : 'ttml-disabled',
  ].join('\u0002')
}

export function useLyric() {
  const setLyric = usePlayerStore((s) => s.setLyric)
  const setTtmlLines = usePlayerStore((s) => s.setTtmlLines)
  const setLyricLoading = usePlayerStore((s) => s.setLyricLoading)
  const preparedRef = useRef<PreparedLyricRequest | null>(null)
  const requestVersionRef = useRef(0)

  useEffect(
    () => () => {
      preparedRef.current?.controller.abort()
    },
    [],
  )

  const prepareLyric = useCallback((track: Track): PreparedLyricRequest => {
    const { ttmlEnabled, ttmlDbUrl } = useSettingsStore.getState()
    const key = lyricRequestKey(track, ttmlEnabled, ttmlDbUrl)
    if (preparedRef.current?.key === key && !preparedRef.current.controller.signal.aborted) {
      return preparedRef.current
    }

    preparedRef.current?.controller.abort()
    const lyricSource = track.metadataSource ?? track.source
    const folder = TTML_FOLDER_MAP[lyricSource]
    const lyricTrackId = track.metadataSource ? track.lyricId : track.sourceId
    const controller = new AbortController()
    const ttmlPromise = (async (): Promise<AMLLLyricLine[] | null> => {
      if (!ttmlEnabled || !folder || !lyricTrackId) return null
      try {
        const ttmlUrl = ttmlDbUrl.replace('ncm-lyrics', folder).replace('%s', lyricTrackId)
        const timeoutSignal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TTML_TIMEOUT_MS) : null
        const SignalFactory = AbortSignal as typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }
        const signal =
          timeoutSignal && typeof SignalFactory.any === 'function'
            ? SignalFactory.any([controller.signal, timeoutSignal])
            : controller.signal
        const response = await fetch(ttmlUrl, { signal, cache: 'force-cache' })
        if (!response.ok) return null
        const text = await response.text()
        if (!text.includes('<tt') && !text.includes('<?xml')) return null
        const parsed = parseTTML(text)
        return parsed.lines.length > 0 ? toCoreLyricLines(parsed.lines) : null
      } catch {
        return null
      }
    })()

    const lyricPromise = (async (): Promise<LyricData | null> => {
      if (!track.lyricId) return null
      try {
        const response = await fetch(
          `${SERVER_URL}/api/music/lyric?source=${lyricSource}&lyricId=${encodeURIComponent(track.lyricId)}`,
          { signal: controller.signal, credentials: 'include' },
        )
        return response.ok ? await response.json() : null
      } catch {
        return null
      }
    })()

    const request = { key, startedAt: Date.now(), controller, ttmlPromise, lyricPromise }
    preparedRef.current = request
    return request
  }, [])

  const prefetchLyric = useCallback(
    (track: Track) => {
      const { ttmlEnabled, ttmlDbUrl } = useSettingsStore.getState()
      const key = lyricRequestKey(track, ttmlEnabled, ttmlDbUrl)
      if (!getCachedPresentation(key)) prepareLyric(track)
    },
    [prepareLyric],
  )

  const fetchLyric = useCallback(
    async (track: Track) => {
      const version = ++requestVersionRef.current
      const { ttmlEnabled, ttmlDbUrl } = useSettingsStore.getState()
      const key = lyricRequestKey(track, ttmlEnabled, ttmlDbUrl)

      setTtmlLines(null)
      setLyric('', '')
      setLyricLoading(true)

      const cached = getCachedPresentation(key)
      if (cached) {
        if (preparedRef.current?.key !== key) {
          preparedRef.current?.controller.abort()
          preparedRef.current = null
        }
        setTtmlLines(cached.lines)
        setLyric(cached.lyric, cached.tlyric)
        setLyricLoading(false)
        return
      }

      const request = prepareLyric(track)
      const isCurrent = () => version === requestVersionRef.current && !request.controller.signal.aborted
      const ttmlCandidate = request.ttmlPromise.then((lines) => {
        if (!lines?.length) throw new Error('TTML unavailable')
        return { type: 'ttml' as const, lines }
      })
      const platformCandidate = request.lyricPromise.then((data) => {
        if (!hasUsablePlatformLyric(data)) throw new Error('Platform lyric unavailable')
        return { type: 'platform' as const, data }
      })

      const firstCandidate = await Promise.any([ttmlCandidate, platformCandidate]).catch(() => null)
      if (!isCurrent()) return

      const completeBasePromise = Promise.all([request.ttmlPromise, request.lyricPromise])
      const graceRemainingMs = Math.max(0, request.startedAt + QUALITY_GRACE_MS - Date.now())
      const completeWithinGrace = await Promise.race([
        completeBasePromise.then((value) => ({ value })),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), graceRemainingMs)),
      ])
      if (!isCurrent()) return

      let initialPresentation: LyricPresentation
      if (completeWithinGrace) {
        initialPresentation = selectPreferredPresentation(...completeWithinGrace.value)
      } else if (firstCandidate?.type === 'ttml') {
        initialPresentation = selectPreferredPresentation(firstCandidate.lines, null)
      } else {
        initialPresentation = buildNativePresentation(firstCandidate?.data ?? null)
      }

      setTtmlLines(initialPresentation.lines)
      setLyric(initialPresentation.lyric, initialPresentation.tlyric)
      setLyricLoading(false)

      const canSupplement = !!track.lyricId && track.artist.length > 0 && track.duration > 0
      const requestSupplement = async (): Promise<LyricSupplementData | null> => {
        const params = new URLSearchParams({
          source: track.metadataSource ?? track.source,
          lyricId: track.lyricId!, title: track.title, duration: String(track.duration),
        })
        for (const artist of track.artist) params.append('artists', artist)
        try {
          const response = await fetch(`${SERVER_URL}/api/music/lyric-supplement?${params}`, {
            signal: request.controller.signal, credentials: 'include',
          })
          return response.ok ? await response.json() : null
        } catch { return null }
      }
      // Start matching while a slow TTML provider is still pending. Only one supplement request is used.
      const earlySupplement = canSupplement && !initialPresentation.quality.hasWordAnimation
        ? requestSupplement() : null
      let baseCompleted = false
      const earlyPublication = earlySupplement?.then((supplement) => {
        if (!supplement || !isCurrent() || baseCompleted) return
        const candidates = supplement.candidates?.length ? supplement.candidates : supplement.source ? [supplement] : []
        const characterCount = Math.max(initialPresentation.quality.meaningfulCharacterCount,
          ...candidates.map((candidate) => buildNativePresentation(candidate).quality.meaningfulCharacterCount))
        const referenceLrc = firstCandidate?.type === 'platform' ? firstCandidate.data.lyric : initialPresentation.lyric
        const best = candidates.map((candidate) => buildNativePresentation(candidate, characterCount, referenceLrc))
          .filter((candidate) => candidate.quality.hasWordAnimation)
          .sort((a, b) => b.quality.confidence - a.quality.confidence)[0]
        if (best && isPresentationBetter(best, initialPresentation)) {
          initialPresentation = best
          setTtmlLines(best.lines)
          setLyric(best.lyric, best.tlyric)
        }
      }).catch(() => { /* An unusable supplement must not block the base lyrics. */ })
      const [rawTtmlLines, lyricData] = completeWithinGrace?.value ?? (await completeBasePromise)
      baseCompleted = true
      if (!isCurrent()) return

      const baseTtmlPresentation = buildTtmlPresentation(rawTtmlLines, lyricData)
      let preferredPresentation = selectPreferredPresentation(rawTtmlLines, lyricData)
      if (isPresentationBetter(initialPresentation, preferredPresentation)) preferredPresentation = initialPresentation
      if (!completeWithinGrace) {
        if (isPresentationBetter(preferredPresentation, initialPresentation)) {
          setTtmlLines(preferredPresentation.lines)
        }
        if (
          preferredPresentation.lyric !== initialPresentation.lyric ||
          preferredPresentation.tlyric !== initialPresentation.tlyric
        ) {
          setLyric(preferredPresentation.lyric, preferredPresentation.tlyric)
        }
      }

      const needsSupplement =
        !preferredPresentation.quality.hasWordAnimation ||
        (baseTtmlPresentation?.unresolvedCount ?? 0) > 0
      if (needsSupplement && track.lyricId && track.artist.length > 0 && track.duration > 0) {
        try {
          const supplement = await (earlySupplement ?? requestSupplement())
          if (supplement) {
            const supplementCandidates: LyricData[] = supplement.candidates?.length
              ? supplement.candidates
              : supplement.source
                ? [supplement]
                : []
            const preliminarySupplements = supplementCandidates.map((candidate) =>
              buildNativePresentation(candidate),
            )
            const comparisonCharacterCount = Math.max(
              preferredPresentation.quality.meaningfulCharacterCount,
              ...preliminarySupplements.map((presentation) => presentation.quality.meaningfulCharacterCount),
            )
            const supplementalPresentations = supplementCandidates.map((candidate) =>
              buildNativePresentation(candidate, comparisonCharacterCount, lyricData?.lyric ?? ''),
            )
            const supplementalPresentation = supplementalPresentations
              .filter((presentation) => presentation.quality.hasWordAnimation)
              .sort((left, right) => right.quality.confidence - left.quality.confidence)[0]

            if (supplementalPresentation && isPresentationBetter(supplementalPresentation, preferredPresentation)) {
              preferredPresentation = supplementalPresentation
              if (isCurrent()) {
                setTtmlLines(preferredPresentation.lines)
                setLyric(preferredPresentation.lyric, preferredPresentation.tlyric)
              }
            }

            if (rawTtmlLines?.length && baseTtmlPresentation?.unresolvedCount) {
              const primarySources = lyricData?.lyric ? [{ lrc: lyricData.lyric }] : []
              const sources = [
                ...supplementalPresentations.flatMap((presentation) =>
                  presentation.lines?.length ? [{ wordByWord: presentation.lines }] : [],
                ),
                ...supplementCandidates.flatMap((candidate) => (candidate.lyric ? [{ lrc: candidate.lyric }] : [])),
                ...primarySources,
              ]
              const repaired = repairLyricTimeline(rawTtmlLines, sources)
              const repairedPresentation = createTtmlPresentation(
                repaired.lines,
                repaired.unresolvedCount,
                lyricData,
                comparisonCharacterCount,
              )
              if (isPresentationBetter(repairedPresentation, preferredPresentation)) {
                preferredPresentation = repairedPresentation
                if (isCurrent()) setTtmlLines(preferredPresentation.lines)
              }
            }
          }
        } catch {
          if (!isCurrent()) return
        }
      }

      if (!isCurrent()) return
      await earlyPublication
      if (!isCurrent()) return
      if (isPresentationBetter(initialPresentation, preferredPresentation)) preferredPresentation = initialPresentation
      cachePresentation(key, preferredPresentation)
      if (preparedRef.current === request) preparedRef.current = null
    },
    [prepareLyric, setLyric, setLyricLoading, setTtmlLines],
  )

  return { fetchLyric, prefetchLyric }
}
