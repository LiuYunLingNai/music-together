import { SERVER_URL } from '@/lib/config'
import { getPersistedLyricPresentation, savePersistedLyricPresentation } from '@/lib/lyricPresentationCache'
import { getLyricSourceOverride, subscribeLyricSourceOverride } from '@/lib/lyricSourceOverride'
import { enrichLyricAuxiliary, needsLyricAuxiliary, repairLyricTimeline } from '@/lib/lyricTimeline'
import type { LyricPreferredSource } from '@/lib/storage'
import {
  createLyricPresentationBuilder,
  createTtmlPresentation,
  hasUsablePlatformLyric,
  isPresentationBetter,
  markSupplementPresentation,
  parseTtmlLyricLines,
  preserveTtmlStructure,
  type LyricData,
  type LyricPresentation,
} from '@/lib/lyricPresentation'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import { isPureMusicLyricText, type Track } from '@music-together/shared'
import { useCallback, useEffect, useRef } from 'react'

/** 支持 TTML 的平台 → TTML DB 文件夹映射 */
const TTML_FOLDER_MAP: Record<string, string> = {
  netease: 'ncm-lyrics',
  tencent: 'qq-lyrics',
}

/** AMLL 静态歌词库会拦截浏览器 Origin，直连必然失败；自定义源才尝试直连。 */
const AMLL_STATIC_HOSTS = new Set(['amlldb.bikonoo.com', 'api.beta.amllhub.bikonoo.com'])

function isAmllStaticUrl(rawUrl: string): boolean {
  try {
    return AMLL_STATIC_HOSTS.has(new URL(rawUrl).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Resolve `%s` (track id) and `%f` (platform folder); keep the old ncm-lyrics rewrite for stored templates. */
function buildTtmlUrl(template: string, folder: string, lyricTrackId: string): string {
  const withFolder = template.includes('%f') ? template.replace('%f', folder) : template.replace('ncm-lyrics', folder)
  return withFolder.replace('%s', lyricTrackId)
}

/** Reject a TTML document whose lines clearly belong to another recording. */
function isPlausibleTtml(lines: AMLLLyricLine[], durationSeconds: number): boolean {
  const lastEnd = lines.reduce((latest, line) => Math.max(latest, line.endTime || line.startTime || 0), 0)
  if (lastEnd <= 0) return false
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return true
  if (lastEnd > (durationSeconds + 90) * 1_000) return false
  if (lines.length >= 3 && durationSeconds > 120 && lastEnd < durationSeconds * 0.35 * 1_000) return false
  return true
}

function parsePlausibleTtml(text: string, durationSeconds: number): AMLLLyricLine[] | null {
  if (!text.includes('<tt') && !text.includes('<?xml')) return null
  try {
    const lines = parseTtmlLyricLines(text)
    if (!lines.length || !isPlausibleTtml(lines, durationSeconds)) return null
    return lines
  } catch {
    return null
  }
}

/** TTML 请求超时（ms） */
const TTML_TIMEOUT_MS = 8_000
const TTML_PROXY_TIMEOUT_MS = 7_000
const QUALITY_GRACE_MS = 200
const LYRIC_CACHE_TTL_MS = 30 * 60 * 1_000
const NEGATIVE_LYRIC_CACHE_TTL_MS = 60 * 1_000
const LYRIC_CACHE_MAX = 30

interface LyricSupplementCandidate extends LyricData {
  source: 'netease' | 'kugou' | 'tencent'
}

interface LyricSupplementData extends LyricData {
  source: 'netease' | 'kugou' | 'tencent' | null
  candidates?: LyricSupplementCandidate[]
}

async function fetchLyricSupplement(
  track: Track,
  signal: AbortSignal,
): Promise<LyricSupplementData | null> {
  const params = new URLSearchParams({
    source: track.metadataSource ?? track.source,
    lyricId: track.lyricId!,
    title: track.title,
    duration: String(track.duration),
  })
  for (const artist of track.artist) params.append('artists', artist)
  try {
    const response = await fetch(`${SERVER_URL}/api/music/lyric-supplement?${params}`, {
      signal,
      credentials: 'include',
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

function linesHaveWordTiming(lines: AMLLLyricLine[] | null): boolean {
  return Boolean(
    lines?.some((line) =>
      line.words.some((word) => Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.endTime > word.startTime),
    ),
  )
}

interface PreparedLyricRequest {
  key: string
  startedAt: number
  controller: AbortController
  ttmlPromise: Promise<AMLLLyricLine[] | null>
  lyricPromise: Promise<LyricData | null>
  supplementPromise: Promise<LyricSupplementData | null> | null
}

interface CachedLyricPresentation {
  expiresAt: number
  value: LyricPresentation
}

const lyricPresentationCache = new Map<string, CachedLyricPresentation>()

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

function cachePresentation(key: string, value: LyricPresentation, ttlMs = LYRIC_CACHE_TTL_MS, persist = false): void {
  lyricPresentationCache.delete(key)
  lyricPresentationCache.set(key, { value, expiresAt: Date.now() + ttlMs })
  while (lyricPresentationCache.size > LYRIC_CACHE_MAX) {
    const oldestKey = lyricPresentationCache.keys().next().value
    if (!oldestKey) break
    lyricPresentationCache.delete(oldestKey)
  }
  if (persist) void savePersistedLyricPresentation(key, value)
}

function hasUsablePresentation(presentation: LyricPresentation): boolean {
  return !!presentation.lines?.length || !!presentation.lyric || !!presentation.tlyric
}

function ttmlSignal(controller: AbortController, timeoutMs: number): AbortSignal {
  const timeoutSignal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : null
  const SignalFactory = AbortSignal as typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }
  return timeoutSignal && typeof SignalFactory.any === 'function'
    ? SignalFactory.any([controller.signal, timeoutSignal])
    : controller.signal
}

/** Prefer the server proxy (shared cache + allow-list); fall back to the configured host for custom libraries. */
async function fetchAmllTtml(
  platform: 'ncm' | 'qq',
  musicId: string,
  controller: AbortController,
  track?: Track,
): Promise<string | null> {
  const params = new URLSearchParams({ platform, id: musicId })
  if (track) {
    params.set('title', track.title)
    for (const artist of track.artist ?? []) params.append('artists', artist)
    if (track.album) params.set('album', track.album)
    if (track.duration) params.set('duration', String(track.duration))
  }
  try {
    const response = await fetch(`${SERVER_URL}/api/music/amll-ttml?${params.toString()}`, {
      signal: ttmlSignal(controller, TTML_PROXY_TIMEOUT_MS),
      credentials: 'include',
    })
    if (!response.ok) return null
    const text = await response.text()
    return text.includes('<tt') || text.includes('<?xml') ? text : null
  } catch {
    return null
  }
}

async function fetchTtmlText(url: string, controller: AbortController): Promise<string | null> {
  const canUseDirect = !isAmllStaticUrl(url)
  try {
    const proxy = await fetch(`${SERVER_URL}/api/music/ttml?url=${encodeURIComponent(url)}`, {
      signal: ttmlSignal(controller, TTML_PROXY_TIMEOUT_MS),
      credentials: 'include',
    })
    if (proxy.ok) {
      const text = await proxy.text()
      if (text.includes('<tt') || text.includes('<?xml')) return text
    }
    if (proxy.status === 429 || !canUseDirect) return null
  } catch {
    if (!canUseDirect) return null
    // Fall through to the direct request; the proxy may not be deployed or the host may be custom.
  }

  try {
    const direct = await fetch(url, {
      signal: ttmlSignal(controller, TTML_TIMEOUT_MS),
      cache: 'force-cache',
    })
    return direct.ok ? await direct.text() : null
  } catch {
    return null
  }
}

function lyricRequestKey(
  track: Track,
  ttmlEnabled: boolean,
  ttmlDbUrl: string,
  preferredSource: LyricPreferredSource,
): string {
  const override = getLyricSourceOverride(track)
  const lyricSource = override?.kind === 'platform' ? override.source : (track.metadataSource ?? track.source)
  const lyricTrackId =
    override?.kind === 'platform' ? override.lyricId : track.metadataSource ? track.lyricId : track.sourceId
  const overrideKey = override
    ? override.kind === 'ttml'
      ? `ttml:${override.platform}:${override.id}`
      : `platform:${override.source}:${override.lyricId}`
    : 'auto'
  return [
    lyricSource,
    track.lyricId ?? '',
    lyricTrackId ?? '',
    track.title,
    track.artist.join('\u0001'),
    track.duration,
    ttmlEnabled ? ttmlDbUrl : 'ttml-disabled',
    preferredSource,
    overrideKey,
  ].join('\u0002')
}

export function useLyric() {
  const setLyric = usePlayerStore((s) => s.setLyric)
  const setTtmlLines = usePlayerStore((s) => s.setTtmlLines)
  const setLyricLoading = usePlayerStore((s) => s.setLyricLoading)
  const setLyricProvenance = usePlayerStore((s) => s.setLyricProvenance)
  const publishProvenance = useCallback(
    (presentation: LyricPresentation) => {
      if (presentation.source === 'none') {
        setLyricProvenance(null, null, null)
        return
      }
      setLyricProvenance(
        presentation.origin ?? (presentation.source === 'ttml' ? 'ttml' : 'platform'),
        presentation.provider ?? null,
        presentation.quality.confidence,
      )
    },
    [setLyricProvenance],
  )
  const preparedRef = useRef<PreparedLyricRequest | null>(null)
  const requestVersionRef = useRef(0)

  useEffect(
    () => () => {
      preparedRef.current?.controller.abort()
    },
    [],
  )

  const prepareLyric = useCallback((track: Track): PreparedLyricRequest => {
    const { ttmlEnabled, ttmlDbUrl, lyricPreferredSource } = useSettingsStore.getState()
    const key = lyricRequestKey(track, ttmlEnabled, ttmlDbUrl, lyricPreferredSource)
    if (preparedRef.current?.key === key && !preparedRef.current.controller.signal.aborted) {
      return preparedRef.current
    }

    preparedRef.current?.controller.abort()
    const override = getLyricSourceOverride(track)
    const ttmlOverride = override?.kind === 'ttml' ? override : null
    const lyricSource = override?.kind === 'platform' ? override.source : (track.metadataSource ?? track.source)
    const folder = TTML_FOLDER_MAP[lyricSource]
    const lyricTrackId =
      override?.kind === 'platform' ? override.lyricId : track.metadataSource ? track.lyricId : track.sourceId
    const controller = new AbortController()
    const ttmlPromise = (async (): Promise<AMLLLyricLine[] | null> => {
      if (ttmlOverride) {
        const text = await fetchAmllTtml(ttmlOverride.platform, ttmlOverride.id, controller)
        return text ? parsePlausibleTtml(text, track.duration) : null
      }
      if (override || !ttmlEnabled || !folder || !lyricTrackId) return null
      try {
        const ttmlUrl = buildTtmlUrl(ttmlDbUrl, folder, lyricTrackId)
        const text = await fetchTtmlText(ttmlUrl, controller)
        let lines = text ? parsePlausibleTtml(text, track.duration) : null
        if (!lines) {
          const platform = lyricSource === 'netease' ? 'ncm' : lyricSource === 'tencent' ? 'qq' : null
          if (platform) {
            const amllText = await fetchAmllTtml(platform, lyricTrackId, controller, track)
            if (amllText) lines = parsePlausibleTtml(amllText, track.duration)
          }
        }
        return lines
      } catch {
        return null
      }
    })()

    const lyricPromise = (async (): Promise<LyricData | null> => {
      if (ttmlOverride) return null
      const lyricId = override?.kind === 'platform' ? override.lyricId : track.lyricId
      if (!lyricId) return null
      try {
        const response = await fetch(
          `${SERVER_URL}/api/music/lyric?source=${lyricSource}&lyricId=${encodeURIComponent(lyricId)}`,
          { signal: controller.signal, credentials: 'include' },
        )
        return response.ok ? await response.json() : null
      } catch {
        return null
      }
    })()

    const canPrefetchSupplement =
      !override && !ttmlOverride && !!track.lyricId && track.artist.length > 0 && track.duration > 0
    // 预取阶段就把补充请求挂上去：主源都没有逐词时，等切歌时它已经跑了一半，
    // 不必等主源返回后才串行发起。TTML 或平台任一有逐词就不补；主源超过
    // 400ms 仍未齐时先让补充请求起跑，避免慢 TTML 把整条链路拖住。
    let supplementStarted = false
    const startSupplement = (): Promise<LyricSupplementData | null> | null => {
      if (supplementStarted) return null
      supplementStarted = true
      return fetchLyricSupplement(track, controller.signal)
    }
    const supplementPromise = canPrefetchSupplement
      ? (async (): Promise<LyricSupplementData | null> => {
          const primary = Promise.all([ttmlPromise, lyricPromise]).then(([lines, data]) => {
            if (linesHaveWordTiming(lines)) return null
            if (data && (data.yrc || data.wordLyric || data.wordByWord?.length)) return null
            return startSupplement()
          })
          const late = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), 400))
          const winner = await Promise.race([primary, late])
          return winner === 'late' ? startSupplement() : winner
        })().catch(() => null)
      : null

    const request = { key, startedAt: Date.now(), controller, ttmlPromise, lyricPromise, supplementPromise }
    preparedRef.current = request
    return request
  }, [])

  const prefetchLyric = useCallback(
    (track: Track) => {
      const { ttmlEnabled, ttmlDbUrl, lyricPreferredSource } = useSettingsStore.getState()
      const key = lyricRequestKey(track, ttmlEnabled, ttmlDbUrl, lyricPreferredSource)
      if (getCachedPresentation(key)) return
      void getPersistedLyricPresentation(key).then((persisted) => {
        if (persisted) {
          cachePresentation(key, persisted)
          return
        }
        if (!getCachedPresentation(key)) prepareLyric(track)
      })
    },
    [prepareLyric],
  )

  const fetchLyric = useCallback(
    async (track: Track) => {
      const version = ++requestVersionRef.current
      const override = getLyricSourceOverride(track)
      const { buildNativePresentation, buildTtmlPresentation, selectPreferredPresentation } =
        createLyricPresentationBuilder()
      const { ttmlEnabled, ttmlDbUrl, lyricPreferredSource } = useSettingsStore.getState()
      const key = lyricRequestKey(track, ttmlEnabled, ttmlDbUrl, lyricPreferredSource)

      setTtmlLines(null)
      setLyric('', '')
      setLyricLoading(true)
      setLyricProvenance(null, null, null)

      const cached = getCachedPresentation(key)
      if (cached) {
        if (preparedRef.current?.key !== key) {
          preparedRef.current?.controller.abort()
          preparedRef.current = null
        }
        setTtmlLines(cached.lines)
        setLyric(cached.lyric, cached.tlyric)
        publishProvenance(cached)
        setLyricLoading(false)
        return
      }

      const persisted = await getPersistedLyricPresentation(key)
      if (version !== requestVersionRef.current) return
      if (persisted) {
        if (preparedRef.current?.key !== key) {
          preparedRef.current?.controller.abort()
          preparedRef.current = null
        }
        cachePresentation(key, persisted)
        setTtmlLines(persisted.lines)
        setLyric(persisted.lyric, persisted.tlyric)
        publishProvenance(persisted)
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
        initialPresentation = selectPreferredPresentation(...completeWithinGrace.value, lyricPreferredSource)
      } else if (firstCandidate?.type === 'ttml') {
        initialPresentation = selectPreferredPresentation(firstCandidate.lines, null, lyricPreferredSource)
      } else {
        initialPresentation = buildNativePresentation(firstCandidate?.data ?? null)
      }

      setTtmlLines(initialPresentation.lines)
      setLyric(initialPresentation.lyric, initialPresentation.tlyric)
      publishProvenance(initialPresentation)
      setLyricLoading(false)

      const canSupplement =
        !override &&
        !isPureMusicLyricText(initialPresentation.lyric) &&
        !!track.lyricId &&
        track.artist.length > 0 &&
        track.duration > 0
      const requestSupplement = (): Promise<LyricSupplementData | null> =>
        fetchLyricSupplement(track, request.controller.signal)
      // Start matching while a slow TTML provider is still pending. Only one supplement request is used.
      const earlySupplement =
        canSupplement &&
        (!initialPresentation.quality.hasWordAnimation || needsLyricAuxiliary(initialPresentation.lines ?? []))
          ? (request.supplementPromise ?? requestSupplement())
          : null
      let baseCompleted = false
      const earlyPublication = earlySupplement
        ?.then((supplement) => {
          if (!supplement || !isCurrent() || baseCompleted) return
          const candidates = supplement.candidates?.length
            ? supplement.candidates
            : supplement.source
              ? [supplement]
              : []
          const characterCount = Math.max(
            initialPresentation.quality.meaningfulCharacterCount,
            ...candidates.map((candidate) => buildNativePresentation(candidate).quality.meaningfulCharacterCount),
          )
          const referenceLrc =
            firstCandidate?.type === 'platform' ? firstCandidate.data.lyric : initialPresentation.lyric
          const best = candidates
            .map((candidate) => buildNativePresentation(candidate, characterCount, referenceLrc))
            .filter((candidate) => candidate.quality.hasWordAnimation)
            .sort((a, b) => b.quality.confidence - a.quality.confidence)[0]
          if (best && isPresentationBetter(best, initialPresentation)) {
            initialPresentation = best
            setTtmlLines(best.lines)
            setLyric(best.lyric, best.tlyric)
          }
        })
        .catch(() => {
          /* An unusable supplement must not block the base lyrics. */
        })
      const [rawTtmlLines, lyricData] = completeWithinGrace?.value ?? (await completeBasePromise)
      baseCompleted = true
      if (!isCurrent()) return

      const baseTtmlPresentation = buildTtmlPresentation(rawTtmlLines, lyricData)
      let preferredPresentation = selectPreferredPresentation(rawTtmlLines, lyricData, lyricPreferredSource)
      preferredPresentation = preserveTtmlStructure(preferredPresentation, baseTtmlPresentation)
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
        publishProvenance(preferredPresentation)
      }

      const needsSupplement =
        canSupplement &&
        (!preferredPresentation.quality.hasWordAnimation ||
          (baseTtmlPresentation?.unresolvedCount ?? 0) > 0 ||
          needsLyricAuxiliary(preferredPresentation.lines ?? []))
      let supplementHandled = false
      if (needsSupplement) {
        try {
          const supplement = await (earlySupplement ?? requestSupplement())
          if (supplement) {
            supplementHandled = true
            const supplementCandidates: LyricSupplementCandidate[] = supplement.candidates?.length
              ? supplement.candidates
              : supplement.source
                ? [{ ...supplement, source: supplement.source }]
                : []
            const preliminarySupplements = supplementCandidates.map((candidate) =>
              markSupplementPresentation(buildNativePresentation(candidate), candidate.source),
            )
            const comparisonCharacterCount = Math.max(
              preferredPresentation.quality.meaningfulCharacterCount,
              ...preliminarySupplements.map((presentation) => presentation.quality.meaningfulCharacterCount),
            )
            const supplementalPresentations = supplementCandidates.map((candidate) =>
              preserveTtmlStructure(
                markSupplementPresentation(
                  buildNativePresentation(candidate, comparisonCharacterCount, lyricData?.lyric ?? ''),
                  candidate.source,
                ),
                baseTtmlPresentation,
              ),
            )
            const supplementalPresentation = supplementalPresentations
              .filter((presentation) => presentation.quality.hasWordAnimation)
              .sort((left, right) => right.quality.confidence - left.quality.confidence)[0]

            if (supplementalPresentation && isPresentationBetter(supplementalPresentation, preferredPresentation)) {
              preferredPresentation = supplementalPresentation
              if (isCurrent()) {
                setTtmlLines(preferredPresentation.lines)
                setLyric(preferredPresentation.lyric, preferredPresentation.tlyric)
                publishProvenance(preferredPresentation)
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
                if (isCurrent()) {
                  setTtmlLines(preferredPresentation.lines)
                  publishProvenance(preferredPresentation)
                }
              }
            }

            if (preferredPresentation.lines?.length) {
              const auxiliary = enrichLyricAuxiliary(preferredPresentation.lines, [
                ...(initialPresentation.lines ? [{ lines: initialPresentation.lines }] : []),
                ...(baseTtmlPresentation?.lines ? [{ lines: baseTtmlPresentation.lines }] : []),
                ...(lyricData ? [lyricData] : []),
                ...supplementCandidates,
              ])
              if (auxiliary.changed) {
                preferredPresentation = { ...preferredPresentation, lines: auxiliary.lines }
                if (isCurrent()) {
                  setTtmlLines(auxiliary.lines)
                  publishProvenance(preferredPresentation)
                }
              }
            }
          }
        } catch {
          if (!isCurrent()) return
        }
        // 服务端补充可能刚好超时，后台任务稍后会成功；客户端只补一次，
        // 不重新走完整歌词请求，避免闪烁。
        if (!supplementHandled) {
          window.setTimeout(() => {
            if (!isCurrent()) return
            void requestSupplement().then((late) => {
              if (!late || !isCurrent()) return
              const candidates = late.candidates?.length
                ? late.candidates
                : late.source
                  ? [{ ...late, source: late.source }]
                  : []
              if (candidates.length === 0) return
              const characterCount = Math.max(
                preferredPresentation.quality.meaningfulCharacterCount,
                ...candidates.map(
                  (candidate) => buildNativePresentation(candidate).quality.meaningfulCharacterCount,
                ),
              )
              const presentations = candidates.map((candidate) =>
                preserveTtmlStructure(
                  markSupplementPresentation(
                    buildNativePresentation(candidate, characterCount, lyricData?.lyric ?? ''),
                    candidate.source,
                  ),
                  baseTtmlPresentation,
                ),
              )
              const best = presentations
                .filter((presentation) => presentation.quality.hasWordAnimation)
                .sort((left, right) => right.quality.confidence - left.quality.confidence)[0]
              if (best && isPresentationBetter(best, preferredPresentation)) {
                preferredPresentation = best
                setTtmlLines(best.lines)
                setLyric(best.lyric, best.tlyric)
                publishProvenance(best)
              }
            })
          }, 1500)
        }
      }

      if (!isCurrent()) return
      await earlyPublication
      if (!isCurrent()) return
      if (isPresentationBetter(initialPresentation, preferredPresentation)) preferredPresentation = initialPresentation
      const usable = hasUsablePresentation(preferredPresentation)
      cachePresentation(key, preferredPresentation, usable ? LYRIC_CACHE_TTL_MS : NEGATIVE_LYRIC_CACHE_TTL_MS, usable)
      publishProvenance(preferredPresentation)
      if (preparedRef.current === request) preparedRef.current = null
    },
    [prepareLyric, publishProvenance, setLyric, setLyricLoading, setLyricProvenance, setTtmlLines],
  )

  useEffect(
    () =>
      subscribeLyricSourceOverride(() => {
        const track = usePlayerStore.getState().currentTrack
        if (track) void fetchLyric(track)
      }),
    [fetchLyric],
  )

  return { fetchLyric, prefetchLyric }
}
