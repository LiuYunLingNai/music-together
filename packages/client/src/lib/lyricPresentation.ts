import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import { parseEslrc, parseQrc, parseTTML, parseYrc } from '@applemusic-like-lyrics/lyric'
import type { LyricWordFormat, MusicSource } from '@music-together/shared'
import { findHiddenLeadingStaffIndexes } from './lyrics/staffCredits'
import type { LyricPreferredSource } from './storage'
import {
  enrichLyricAuxiliary,
  enrichLyricStructure,
  evaluateLyricAnimationQuality,
  measureTimelineAgreement,
  repairLyricTimeline,
  type LyricAnimationQuality,
} from './lyricTimeline'

const TIMELINE_ALIGNED_TOLERANCE_MS = 120
const UNALIGNED_SWITCH_MARGIN = 0.05

/** AMLL line extended with the TTML structure fields Folia's visuals consume. */
export interface LyricLine extends AMLLLyricLine {
  songPart?: string
  blockIndex?: number
}

const STAFF_MIN_DWELL_MS = 1_500
const STAFF_TAIL_MARGIN_MS = 1_000

/** Hide a leading credit block when the intro cannot hold it, as Folia's smart policy does. */
function hideLeadingStaffLines(lines: LyricLine[]): LyricLine[] {
  const removed = findHiddenLeadingStaffIndexes(
    lines.map((line) => ({
      fullText: (line.words ?? []).map((word) => word.word ?? '').join(''),
      startTime: line.startTime,
    })),
    STAFF_MIN_DWELL_MS,
    STAFF_TAIL_MARGIN_MS,
  )
  return removed ? lines.filter((_, index) => !removed.has(index)) : lines
}

export interface LyricData {
  lyric: string
  tlyric: string
  romalrc: string
  yrc: string
  wordByWord?: AMLLLyricLine[]
  /** Structured word-timing payload; `wordFormat` selects the parser. */
  wordLyric?: string
  wordFormat?: LyricWordFormat
}

export type LyricOrigin = 'platform' | 'ttml' | 'supplement'

export interface LyricPresentation {
  source: 'none' | 'native' | 'ttml'
  /** Where the winning lines came from; kept through rescoring and caching. */
  origin?: LyricOrigin
  /** Platform that supplied a native or supplement result. */
  provider?: MusicSource
  lines: LyricLine[] | null
  lyric: string
  tlyric: string
  unresolvedCount: number
  quality: LyricAnimationQuality
}

/** TTML and YRC parser lines share the same conversion to the core's word shape. */
export function toCoreLyricLines(lines: ReturnType<typeof parseTTML>['lines']): LyricLine[] {
  return lines.map((line) => {
    // The TTML parser carries structure fields that AMLL's base type omits.
    const structured = line as typeof line & { songPart?: string; blockIndex?: number }
    return {
      words: line.words.map((word) => ({
        word: word.word,
        startTime: word.startTime,
        endTime: word.endTime,
        romanWord: word.romanWord ?? '',
        obscene: false,
      })),
      translatedLyric: line.translatedLyric ?? '',
      romanLyric: line.romanLyric ?? '',
      startTime: line.startTime,
      endTime: line.endTime,
      isBG: line.isBG ?? false,
      isDuet: line.isDuet ?? false,
      ...(structured.songPart ? { songPart: structured.songPart } : {}),
      ...(structured.blockIndex !== undefined ? { blockIndex: structured.blockIndex } : {}),
    }
  })
}

export function hasUsablePlatformLyric(data: LyricData | null): data is LyricData {
  return !!data && !!(data.lyric || data.yrc || data.wordLyric || data.wordByWord?.length)
}

function hasTimedWords(lines: AMLLLyricLine[]): boolean {
  return lines.some(
    (line) =>
      line.endTime > line.startTime &&
      line.words.some(
        (word) => Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.endTime > word.startTime,
      ),
  )
}

function parseStructuredWordLines(data: LyricData | null): AMLLLyricLine[] | null {
  const text = data?.wordLyric
  if (!text || !data?.wordFormat) return null
  try {
    let lines: AMLLLyricLine[]
    switch (data.wordFormat) {
      case 'yrc':
        lines = toCoreLyricLines(parseYrc(text))
        break
      case 'qrc':
        lines = toCoreLyricLines(parseQrc(text))
        break
      case 'ttml':
        lines = toCoreLyricLines(parseTTML(text).lines)
        break
      case 'enhanced-lrc':
        lines = toCoreLyricLines(parseEslrc(text))
        break
      case 'krc':
        return null
    }
    return hasTimedWords(lines) ? lines : null
  } catch {
    return null
  }
}

function prepareNativePresentation(data: LyricData | null): LyricPresentation {
  let lines: AMLLLyricLine[] | null = null
  let unresolvedCount = 0
  // The platform's LRC repairs native timing just as it repairs TTML timing.
  const repairSources = data?.lyric ? [{ lrc: data.lyric }] : []
  const normalize = (linesToFix: AMLLLyricLine[]) => {
    const repaired = repairLyricTimeline(linesToFix, repairSources)
    unresolvedCount = repaired.unresolvedCount
    return enrichLyricAuxiliary(repaired.lines, [data!]).lines
  }
  const structured = parseStructuredWordLines(data)
  if (structured?.length) {
    const normalized = normalize(structured)
    if (normalized.length > 0) lines = normalized
  } else if (data?.wordByWord?.length) {
    const normalized = normalize(data.wordByWord)
    if (normalized.length > 0) lines = normalized
  } else if (data?.yrc) {
    try {
      const parsed = parseYrc(data.yrc)
      if (parsed.length > 0) {
        const normalized = normalize(toCoreLyricLines(parsed))
        if (normalized.length > 0) lines = normalized
      }
    } catch {
      // Invalid word-by-word data still falls back to the provider's LRC.
    }
  }
  const visibleLines = lines ? hideLeadingStaffLines(lines) : null
  return {
    source: hasUsablePlatformLyric(data) ? 'native' : 'none',
    origin: 'platform',
    lines: visibleLines,
    lyric: data?.lyric ?? '',
    tlyric: data?.tlyric ?? '',
    unresolvedCount,
    quality: evaluateLyricAnimationQuality(visibleLines ?? [], data?.lyric ?? ''),
  }
}

/** Tag a native presentation built from another platform's lyric as a supplement result. */
export function markSupplementPresentation(presentation: LyricPresentation, provider: MusicSource): LyricPresentation {
  return { ...presentation, origin: 'supplement', provider }
}

export function createTtmlPresentation(
  lines: AMLLLyricLine[],
  unresolvedCount: number,
  lyricData: LyricData | null,
  comparisonCharacterCount = 0,
): LyricPresentation {
  const enrichedLines = lyricData ? enrichLyricAuxiliary(lines, [lyricData]).lines : lines
  const visibleLines = hideLeadingStaffLines(enrichedLines)
  return {
    source: 'ttml',
    origin: 'ttml',
    lines: visibleLines.length > 0 ? visibleLines : null,
    lyric: lyricData?.lyric ?? '',
    tlyric: lyricData?.tlyric ?? '',
    unresolvedCount,
    quality: evaluateLyricAnimationQuality(visibleLines, lyricData?.lyric, comparisonCharacterCount),
  }
}

function rescorePresentation(
  presentation: LyricPresentation,
  comparisonCharacterCount: number,
  referenceLrc = presentation.lyric,
): LyricPresentation {
  if (comparisonCharacterCount === 0 && referenceLrc === presentation.lyric) return presentation
  return {
    ...presentation,
    quality: evaluateLyricAnimationQuality(presentation.lines ?? [], referenceLrc, comparisonCharacterCount),
  }
}

function chooseBetweenPresentations(
  native: LyricPresentation,
  ttml: LyricPresentation,
  preferredSource: LyricPreferredSource = 'auto',
): LyricPresentation {
  const nativeStructure = native.quality.duetLineCount + native.quality.backgroundLineCount
  const ttmlStructure = ttml.quality.duetLineCount + ttml.quality.backgroundLineCount
  const nativeStructureUsable = native.quality.validTimingCoverage >= 0.85 && native.quality.textCoverage >= 0.8
  const ttmlStructureUsable = ttml.quality.validTimingCoverage >= 0.85 && ttml.quality.textCoverage >= 0.8
  if (nativeStructure !== ttmlStructure) {
    if (ttmlStructure > nativeStructure && ttmlStructureUsable) return ttml
    if (nativeStructure > ttmlStructure && nativeStructureUsable) return native
  }
  // Preference is a tie-break: when both sides have the same word-timing capability,
  // the user's source wins; a side that lacks word animation still loses to one that has it.
  if (native.quality.hasWordAnimation === ttml.quality.hasWordAnimation) {
    if (preferredSource === 'ttml' && ttml.lines?.length) return ttml
    if (preferredSource === 'platform' && native.lines?.length) return native
  }
  if (native.quality.hasWordAnimation !== ttml.quality.hasWordAnimation) {
    return native.quality.hasWordAnimation ? native : ttml
  }
  if (native.quality.hasWordAnimation && native.quality.confidence > ttml.quality.confidence + 0.03) {
    return native
  }
  return ttml
}

/** Owned by one fetch operation; only scoring varies after parsing/repairing a candidate. */
export function createLyricPresentationBuilder() {
  const nativeCache = new Map<LyricData | null, LyricPresentation>()
  const ttmlCache = new Map<AMLLLyricLine[], Map<LyricData | null, LyricPresentation>>()

  const buildNativePresentation = (
    data: LyricData | null,
    comparisonCharacterCount = 0,
    referenceLrc = data?.lyric ?? '',
  ): LyricPresentation => {
    let prepared = nativeCache.get(data)
    if (!prepared) {
      prepared = prepareNativePresentation(data)
      nativeCache.set(data, prepared)
    }
    return rescorePresentation(prepared, comparisonCharacterCount, referenceLrc)
  }

  const buildTtmlPresentation = (
    rawTtmlLines: AMLLLyricLine[] | null,
    lyricData: LyricData | null,
    comparisonCharacterCount = 0,
  ): LyricPresentation | null => {
    if (!rawTtmlLines?.length) return null
    let byAuxiliary = ttmlCache.get(rawTtmlLines)
    if (!byAuxiliary) {
      byAuxiliary = new Map()
      ttmlCache.set(rawTtmlLines, byAuxiliary)
    }
    let prepared = byAuxiliary.get(lyricData)
    if (!prepared) {
      const primarySources = lyricData?.lyric ? [{ lrc: lyricData.lyric }] : []
      const repaired = repairLyricTimeline(rawTtmlLines, primarySources)
      prepared = createTtmlPresentation(repaired.lines, repaired.unresolvedCount, lyricData)
      byAuxiliary.set(lyricData, prepared)
    }
    return rescorePresentation(prepared, comparisonCharacterCount)
  }

  const selectPreferredPresentation = (
    rawTtmlLines: AMLLLyricLine[] | null,
    lyricData: LyricData | null,
    preferredSource: LyricPreferredSource = 'auto',
  ): LyricPresentation => {
    const preliminaryNative = buildNativePresentation(lyricData)
    const preliminaryTtml = buildTtmlPresentation(rawTtmlLines, lyricData)
    if (!preliminaryTtml?.lines?.length) return preliminaryNative
    const comparisonCharacterCount = Math.max(
      preliminaryNative.quality.meaningfulCharacterCount,
      preliminaryTtml.quality.meaningfulCharacterCount,
    )
    const native = buildNativePresentation(lyricData, comparisonCharacterCount)
    const ttml = buildTtmlPresentation(rawTtmlLines, lyricData, comparisonCharacterCount)!
    return chooseBetweenPresentations(native, ttml, preferredSource)
  }

  return { buildNativePresentation, buildTtmlPresentation, selectPreferredPresentation }
}

/** Insufficient samples are not evidence of misalignment. */
function timelinesAligned(a: LyricPresentation, b: LyricPresentation): boolean | null {
  if (!a.lines?.length || !b.lines?.length) return null
  const measured = measureTimelineAgreement(a.lines, b.lines)
  if (measured.agreement === null) return null
  return Math.abs(measured.offset) <= TIMELINE_ALIGNED_TOLERANCE_MS && measured.agreement >= 0.8
}

/** Preserve the existing structure priorities and stricter margin for mismatched timelines. */
export function isPresentationBetter(next: LyricPresentation, current: LyricPresentation): boolean {
  const nextStructure = next.quality.duetLineCount + next.quality.backgroundLineCount
  const currentStructure = current.quality.duetLineCount + current.quality.backgroundLineCount
  const currentStructureUsable = current.quality.validTimingCoverage >= 0.85 && current.quality.textCoverage >= 0.8
  if (currentStructure > 0 && nextStructure === 0 && currentStructureUsable) return false
  if (nextStructure > 0 && currentStructure === 0) {
    return next.quality.validTimingCoverage >= 0.85 && next.quality.textCoverage >= 0.8
  }
  if (next.quality.hasWordAnimation !== current.quality.hasWordAnimation) {
    return next.quality.hasWordAnimation
  }
  if (next.quality.hasWordAnimation) {
    const aligned = timelinesAligned(next, current)
    const margin = aligned === false ? 0.03 + UNALIGNED_SWITCH_MARGIN : 0.03
    return next.quality.confidence > current.quality.confidence + margin
  }
  if (!current.lines?.length && next.lines?.length) return true
  return next.unresolvedCount < current.unresolvedCount
}

export function preserveTtmlStructure(
  presentation: LyricPresentation,
  ttmlPresentation: LyricPresentation | null,
): LyricPresentation {
  if (!presentation.lines?.length || !ttmlPresentation?.lines?.length) return presentation
  if (ttmlPresentation.quality.duetLineCount + ttmlPresentation.quality.backgroundLineCount === 0) return presentation
  const result = enrichLyricStructure(presentation.lines, ttmlPresentation.lines)
  if (!result.changed) return presentation
  return {
    ...presentation,
    lines: result.lines,
    quality: evaluateLyricAnimationQuality(
      result.lines,
      presentation.lyric,
      presentation.quality.meaningfulCharacterCount,
    ),
  }
}
