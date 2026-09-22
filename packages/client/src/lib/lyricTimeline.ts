import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core'

const LRC_TIMESTAMP_PATTERN = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
const SPEAKER_PREFIX_PATTERN = /^[^:：]{1,16}[:：]\s*/
const LYRIC_CREDIT_PATTERN =
  /^(?:作?词|作?曲|编曲|制作人|监制|混音|母带|录音(?:师|棚)?|封面设计|吉他|贝斯|鼓|弦乐|和声|发行|出品|op|sp|isrc)\s*[:：]/iu

interface LyricCandidate {
  words: LyricWord[]
  startTime: number
  endTime: number
  normalizedText: string
  hasWordTiming: boolean
}

interface TimedLyricText {
  text: string
  startTime: number
  normalizedText: string
}

export interface LyricAuxiliarySource {
  lyric?: string
  tlyric?: string
  romalrc?: string
  lines?: readonly LyricLine[]
}

export interface LyricAuxiliaryResult {
  lines: LyricLine[]
  changed: boolean
  translationCoverage: number
  romanCoverage: number
}

export interface LyricStructureResult {
  lines: LyricLine[]
  changed: boolean
}

export interface LyricRepairSource {
  lrc?: string
  wordByWord?: readonly LyricLine[]
}

export interface LyricTimelineResult {
  lines: LyricLine[]
  unresolvedCount: number
}

export interface LyricAnimationQuality {
  hasWordAnimation: boolean
  confidence: number
  animationCoverage: number
  repeatedSectionCoverage: number
  textCoverage: number
  validTimingCoverage: number
  meaningfulCharacterCount: number
  duetLineCount: number
  backgroundLineCount: number
}

interface LyricGroup {
  lines: LyricLine[]
  originalIndex: number
  startTime: number
}

function isValidRange(startTime: number, endTime: number): boolean {
  return Number.isFinite(startTime) && Number.isFinite(endTime) && startTime >= 0 && endTime > startTime
}

function normalizeLyricText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SPEAKER_PREFIX_PATTERN, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function lineText(line: LyricLine): string {
  return line.words.map((word) => word.word).join('')
}

function parseTimedLyricText(lrc: string): TimedLyricText[] {
  const parsed: TimedLyricText[] = []
  LRC_TIMESTAMP_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LRC_TIMESTAMP_PATTERN.exec(lrc)) !== null) {
    const minutes = Number(match[1])
    const seconds = Number(match[2])
    const milliseconds = match[3] ? Number(match[3].padEnd(3, '0')) : 0
    const text = match[4].trim()
    const normalizedText = normalizeLyricText(text)
    if (text && normalizedText) {
      parsed.push({ text, normalizedText, startTime: (minutes * 60 + seconds) * 1_000 + milliseconds })
    }
  }
  return parsed.sort((left, right) => left.startTime - right.startTime)
}

function countNormalizedCharacters(value: string): number {
  return normalizeLyricText(value).length
}

function referenceText(lrc: string): string {
  return referenceLines(lrc).join('')
}

function referenceLines(lrc: string): string[] {
  const lines: string[] = []
  LRC_TIMESTAMP_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LRC_TIMESTAMP_PATTERN.exec(lrc)) !== null) {
    if (LYRIC_CREDIT_PATTERN.test(match[4].trim())) continue
    const text = normalizeLyricText(match[4])
    if (text) lines.push(text)
  }
  return lines
}

/** Line wrapping differs between providers, so compare the ordered lyric text rather than exact lines. */
function orderedTextCoverage(candidate: string, reference: string): number {
  if (!reference) return candidate ? 1 : 0
  if (!candidate) return 0

  const row = new Uint16Array(reference.length + 1)
  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex++) {
    let diagonal = 0
    for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex++) {
      const previous = row[referenceIndex]
      row[referenceIndex] =
        candidate[candidateIndex] === reference[referenceIndex - 1]
          ? diagonal + 1
          : Math.max(row[referenceIndex], row[referenceIndex - 1])
      diagonal = previous
    }
  }
  return row[reference.length] / reference.length
}

/**
 * Scores actual word animation data rather than trusting the source format.
 * A candidate must be substantially animated, correctly timed, and complete
 * enough compared with the provider's main LRC before it can outrank a
 * structurally richer line-timed source.
 */
export function evaluateLyricAnimationQuality(
  lines: readonly LyricLine[],
  referenceLrc = '',
  comparisonCharacterCount = 0,
): LyricAnimationQuality {
  let meaningfulCharacterCount = 0
  let animatedCharacterCount = 0
  let validTimingCharacterCount = 0
  let meaningfulLineCount = 0
  let animatedLineCount = 0
  let duetLineCount = 0
  let backgroundLineCount = 0
  const candidateLines: Array<{ text: string; animated: boolean }> = []

  for (const line of lines) {
    const normalizedLine = normalizeLyricText(lineText(line))
    if (!normalizedLine) continue
    meaningfulLineCount += 1
    if (line.isDuet) duetLineCount += 1
    if (line.isBG) backgroundLineCount += 1
    meaningfulCharacterCount += normalizedLine.length

    const meaningfulWords = line.words.filter((word) => countNormalizedCharacters(word.word) > 0)
    const timedWords = meaningfulWords.filter((word) => isValidRange(word.startTime, word.endTime))
    validTimingCharacterCount += timedWords.reduce((total, word) => total + countNormalizedCharacters(word.word), 0)

    const distinctTimings = new Set(timedWords.map((word) => `${word.startTime}:${word.endTime}`))
    if (timedWords.length >= 2 && distinctTimings.size >= 2) {
      animatedLineCount += 1
      animatedCharacterCount += normalizedLine.length
      candidateLines.push({ text: normalizedLine, animated: true })
    } else {
      candidateLines.push({ text: normalizedLine, animated: false })
    }
  }

  const animationCoverage =
    meaningfulCharacterCount > 0 ? Math.min(1, animatedCharacterCount / meaningfulCharacterCount) : 0
  const validTimingCoverage =
    meaningfulCharacterCount > 0 ? Math.min(1, validTimingCharacterCount / meaningfulCharacterCount) : 0
  const normalizedReferenceText = referenceText(referenceLrc)
  const textCoverage =
    normalizedReferenceText.length > 0
      ? orderedTextCoverage(candidateLines.map((line) => line.text).join(''), normalizedReferenceText)
      : comparisonCharacterCount > 0
        ? Math.min(1, meaningfulCharacterCount / comparisonCharacterCount)
        : meaningfulCharacterCount > 0
          ? 1
          : 0

  const repeatedReferenceCounts = new Map<string, number>()
  for (const text of referenceLines(referenceLrc)) {
    if (Array.from(text).length < 4) continue
    repeatedReferenceCounts.set(text, (repeatedReferenceCounts.get(text) ?? 0) + 1)
  }
  let repeatedCharacterCount = 0
  let animatedRepeatedCharacterCount = 0
  for (const [text, count] of repeatedReferenceCounts) {
    if (count < 2) continue
    const characterCount = Array.from(text).length
    const animatedMatches = candidateLines.filter((line) => line.animated && textMatchScore(line.text, text) > 0).length
    repeatedCharacterCount += characterCount * count
    animatedRepeatedCharacterCount += characterCount * Math.min(count, animatedMatches)
  }
  const repeatedSectionCoverage =
    repeatedCharacterCount >= 20 ? animatedRepeatedCharacterCount / repeatedCharacterCount : 1

  const requiredAnimatedLines = Math.min(3, Math.max(1, Math.ceil(meaningfulLineCount * 0.1)))
  const hasWordAnimation =
    animatedLineCount >= requiredAnimatedLines &&
    animationCoverage >= 0.55 &&
    repeatedSectionCoverage >= 0.6 &&
    validTimingCoverage >= 0.85 &&
    textCoverage >= 0.8
  const confidence = Math.min(
    1,
    animationCoverage * 0.4 + textCoverage * 0.25 + validTimingCoverage * 0.2 + repeatedSectionCoverage * 0.15,
  )

  return {
    hasWordAnimation,
    confidence,
    animationCoverage,
    repeatedSectionCoverage,
    textCoverage,
    validTimingCoverage,
    meaningfulCharacterCount,
    duetLineCount,
    backgroundLineCount,
  }
}

function parseLrcCandidates(lrc: string): LyricCandidate[] {
  const parsed: Array<{ text: string; startTime: number }> = []
  LRC_TIMESTAMP_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LRC_TIMESTAMP_PATTERN.exec(lrc)) !== null) {
    const minutes = Number(match[1])
    const seconds = Number(match[2])
    const milliseconds = match[3] ? Number(match[3].padEnd(3, '0')) : 0
    const text = match[4].trim()
    if (text) parsed.push({ text, startTime: (minutes * 60 + seconds) * 1_000 + milliseconds })
  }

  return parsed.map((line, index) => {
    const endTime = Math.max(line.startTime + 800, parsed[index + 1]?.startTime ?? line.startTime + 1_500)
    return {
      words: [
        {
          word: line.text.replace(SPEAKER_PREFIX_PATTERN, ''),
          startTime: line.startTime,
          endTime,
          romanWord: '',
          obscene: false,
        },
      ],
      startTime: line.startTime,
      endTime,
      normalizedText: normalizeLyricText(line.text),
      hasWordTiming: false,
    }
  })
}

function wordByWordCandidates(lines: readonly LyricLine[]): LyricCandidate[] {
  return lines.flatMap((line) => {
    if (!isValidRange(line.startTime, line.endTime) || line.words.length === 0) return []
    return [
      {
        words: line.words.map((word) => ({ ...word })),
        startTime: line.startTime,
        endTime: line.endTime,
        normalizedText: normalizeLyricText(lineText(line)),
        hasWordTiming: true,
      },
    ]
  })
}

function estimateTimelineOffset(lines: readonly LyricLine[], candidates: readonly LyricCandidate[]): number {
  const lineTimes = new Map<string, number[]>()
  const candidateTimes = new Map<string, number[]>()

  for (const line of lines) {
    if (!isValidRange(line.startTime, line.endTime)) continue
    const text = normalizeLyricText(lineText(line))
    if (!text) continue
    lineTimes.set(text, [...(lineTimes.get(text) ?? []), line.startTime])
  }
  for (const candidate of candidates) {
    if (!candidate.normalizedText) continue
    candidateTimes.set(candidate.normalizedText, [
      ...(candidateTimes.get(candidate.normalizedText) ?? []),
      candidate.startTime,
    ])
  }

  const differences: number[] = []
  for (const [text, sourceTimes] of candidateTimes) {
    const targetTimes = lineTimes.get(text)
    if (sourceTimes.length !== 1 || targetTimes?.length !== 1) continue
    const difference = targetTimes[0] - sourceTimes[0]
    if (Math.abs(difference) <= 3_000) differences.push(difference)
  }
  if (differences.length < 3) return 0
  differences.sort((left, right) => left - right)
  return differences[Math.floor(differences.length / 2)]
}

function auxiliaryCoverage(lines: readonly LyricLine[], field: 'translatedLyric' | 'romanLyric'): number {
  const meaningfulLines = lines.filter((line) => !line.isBG && normalizeLyricText(lineText(line)))
  if (meaningfulLines.length === 0) return 1
  return meaningfulLines.filter((line) => line[field]?.trim()).length / meaningfulLines.length
}

function pairAuxiliaryLines(original: readonly TimedLyricText[], auxiliaryLrc: string): string[] {
  const auxiliary = parseTimedLyricText(auxiliaryLrc)
  if (auxiliary.length === 0) return []

  let auxiliaryIndex = 0
  return original.map((line) => {
    while (auxiliaryIndex < auxiliary.length && auxiliary[auxiliaryIndex].startTime < line.startTime - 1_500) {
      auxiliaryIndex += 1
    }
    let bestIndex = -1
    let bestDistance = 1_501
    for (let candidateIndex = auxiliaryIndex; candidateIndex < auxiliary.length; candidateIndex++) {
      const candidate = auxiliary[candidateIndex]
      const distance = Math.abs(candidate.startTime - line.startTime)
      if (distance < bestDistance) {
        bestIndex = candidateIndex
        bestDistance = distance
      }
      if (candidate.startTime > line.startTime + 1_500) break
    }
    if (bestIndex < 0) return ''
    auxiliaryIndex = bestIndex + 1
    return auxiliary[bestIndex].text
  })
}

function textMatchScore(target: string, source: string): number {
  if (target === source) return 1
  const targetCharacters = Array.from(target)
  const sourceCharacters = Array.from(source)
  const shorter = Math.min(targetCharacters.length, sourceCharacters.length)
  const longer = Math.max(targetCharacters.length, sourceCharacters.length)
  if (shorter < 3) return 0

  const row = new Uint16Array(sourceCharacters.length + 1)
  for (const targetCharacter of targetCharacters) {
    let diagonal = 0
    for (let sourceIndex = 1; sourceIndex <= sourceCharacters.length; sourceIndex++) {
      const previous = row[sourceIndex]
      row[sourceIndex] =
        targetCharacter === sourceCharacters[sourceIndex - 1]
          ? diagonal + 1
          : Math.max(row[sourceIndex], row[sourceIndex - 1])
      diagonal = previous
    }
  }
  const commonLength = row[sourceCharacters.length]
  const shorterCoverage = commonLength / shorter
  const longerCoverage = commonLength / longer
  if (shorterCoverage < 0.88 || longerCoverage < 0.42) return 0
  return 0.55 + longerCoverage * 0.4
}

function alignAuxiliarySource(
  lines: readonly LyricLine[],
  original: readonly TimedLyricText[],
): { mapping: number[]; offset: number } {
  const targets = lines.flatMap((line, lineIndex) => {
    const normalizedText = normalizeLyricText(lineText(line))
    return !line.isBG && isValidRange(line.startTime, line.endTime) && normalizedText
      ? [{ lineIndex, startTime: line.startTime, normalizedText }]
      : []
  })
  const candidates: LyricCandidate[] = original.map((line) => ({
    words: [],
    startTime: line.startTime,
    endTime: line.startTime + 1_500,
    normalizedText: line.normalizedText,
    hasWordTiming: false,
  }))
  const offset = estimateTimelineOffset(lines, candidates)
  const width = original.length + 1
  const scores = new Float32Array((targets.length + 1) * width)
  const decisions = new Uint8Array((targets.length + 1) * width)

  for (let targetIndex = 1; targetIndex <= targets.length; targetIndex++) {
    const target = targets[targetIndex - 1]
    for (let sourceIndex = 1; sourceIndex <= original.length; sourceIndex++) {
      const cell = targetIndex * width + sourceIndex
      const skipTarget = scores[(targetIndex - 1) * width + sourceIndex]
      const skipSource = scores[targetIndex * width + sourceIndex - 1]
      if (skipTarget >= skipSource) {
        scores[cell] = skipTarget
        decisions[cell] = 1
      } else {
        scores[cell] = skipSource
        decisions[cell] = 2
      }

      const matchScore = textMatchScore(target.normalizedText, original[sourceIndex - 1].normalizedText)
      if (matchScore === 0) continue
      const timeDistance = Math.abs(target.startTime - (original[sourceIndex - 1].startTime + offset))
      const tolerance = 6_000
      if (timeDistance > tolerance) continue
      const alignedScore =
        scores[(targetIndex - 1) * width + sourceIndex - 1] + matchScore * 10 + 1 - timeDistance / tolerance
      if (alignedScore > scores[cell]) {
        scores[cell] = alignedScore
        decisions[cell] = 3
      }
    }
  }

  const mapping = new Array<number>(lines.length).fill(-1)
  let targetIndex = targets.length
  let sourceIndex = original.length
  while (targetIndex > 0 && sourceIndex > 0) {
    const decision = decisions[targetIndex * width + sourceIndex]
    if (decision === 3) {
      mapping[targets[targetIndex - 1].lineIndex] = sourceIndex - 1
      targetIndex -= 1
      sourceIndex -= 1
    } else if (decision === 2) {
      sourceIndex -= 1
    } else {
      targetIndex -= 1
    }
  }
  return { mapping, offset }
}

interface PreparedAuxiliarySource {
  original: TimedLyricText[]
  translations: string[]
  romanizations: string[]
  alignment: ReturnType<typeof alignAuxiliarySource>
  order: number
}

function completeAuxiliaryMapping(
  lines: readonly LyricLine[],
  source: PreparedAuxiliarySource,
  values: readonly string[],
): number[] {
  const mapping = [...source.alignment.mapping]
  const matchedCount = mapping.filter((sourceIndex) => sourceIndex >= 0).length
  if (matchedCount < Math.min(8, Math.ceil(source.original.length * 0.2))) return mapping

  const usedSources = new Set(mapping.filter((sourceIndex) => sourceIndex >= 0))
  for (let sourceIndex = 0; sourceIndex < source.original.length; sourceIndex++) {
    if (usedSources.has(sourceIndex) || !values[sourceIndex]) continue
    let previousTarget = -1
    for (let lineIndex = mapping.length - 1; lineIndex >= 0; lineIndex--) {
      if (mapping[lineIndex] >= 0 && mapping[lineIndex] < sourceIndex) {
        previousTarget = lineIndex
        break
      }
    }
    const nextTarget = mapping.findIndex((mappedSource) => mappedSource > sourceIndex)
    const upperBound = nextTarget < 0 ? mapping.length : nextTarget
    let bestTarget = -1
    let bestDistance = 6_001
    for (let lineIndex = previousTarget + 1; lineIndex < upperBound; lineIndex++) {
      const line = lines[lineIndex]
      if (mapping[lineIndex] >= 0 || line.isBG || !isValidRange(line.startTime, line.endTime)) continue
      const distance = Math.abs(line.startTime - (source.original[sourceIndex].startTime + source.alignment.offset))
      if (distance < bestDistance) {
        bestDistance = distance
        bestTarget = lineIndex
      }
    }
    if (bestTarget >= 0) {
      mapping[bestTarget] = sourceIndex
      usedSources.add(sourceIndex)
    }
  }
  return mapping
}

function auxiliarySourceScore(source: PreparedAuxiliarySource, values: readonly string[]): number {
  const availableCount = values.filter(Boolean).length
  if (availableCount === 0) return -1
  const matchedCount = source.alignment.mapping.filter((sourceIndex) => sourceIndex >= 0 && values[sourceIndex]).length
  return matchedCount + matchedCount / availableCount
}

/** Conservatively carries verified AMLL duet/background flags onto a better word timeline. */
export function enrichLyricStructure(
  lines: readonly LyricLine[],
  structuralLines: readonly LyricLine[],
): LyricStructureResult {
  const enriched = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  const sourceEntries = structuralLines.flatMap((line) => {
    const text = lineText(line).trim()
    const normalizedText = normalizeLyricText(text)
    return isValidRange(line.startTime, line.endTime) && normalizedText
      ? [{ line, original: { text, normalizedText, startTime: line.startTime } }]
      : []
  })
  if (sourceEntries.length === 0) return { lines: enriched, changed: false }

  const alignment = alignAuxiliarySource(
    enriched,
    sourceEntries.map((entry) => entry.original),
  )
  const matchedCount = alignment.mapping.filter((sourceIndex) => sourceIndex >= 0).length
  if (matchedCount < Math.min(3, Math.ceil(sourceEntries.length * 0.2))) {
    return { lines: enriched, changed: false }
  }

  let changed = false
  for (let lineIndex = 0; lineIndex < enriched.length; lineIndex++) {
    const sourceIndex = alignment.mapping[lineIndex]
    if (sourceIndex < 0) continue
    const source = sourceEntries[sourceIndex].line
    const target = enriched[lineIndex]
    if (source.isDuet && !target.isDuet) {
      target.isDuet = true
      changed = true
    }
    if (source.isBG && !target.isBG && lineIndex > 0 && !enriched[lineIndex - 1].isBG) {
      target.isBG = true
      changed = true
    }
  }
  return { lines: enriched, changed }
}

/**
 * Adds translation and romanization without changing AMLL's word timing,
 * duet/background structure, or existing auxiliary text.
 */
export function enrichLyricAuxiliary(
  lines: readonly LyricLine[],
  sources: readonly LyricAuxiliarySource[],
): LyricAuxiliaryResult {
  const enriched = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  let changed = false

  const preparedSources = sources.flatMap((source, order): PreparedAuxiliarySource[] => {
    const sourceLines =
      source.lines?.flatMap((line) => {
        const text = lineText(line).trim()
        const normalizedText = normalizeLyricText(text)
        return !line.isBG && isValidRange(line.startTime, line.endTime) && normalizedText
          ? [{ line, original: { text, normalizedText, startTime: line.startTime } }]
          : []
      }) ?? []
    const original =
      sourceLines.length > 0 ? sourceLines.map((entry) => entry.original) : parseTimedLyricText(source.lyric ?? '')
    if (original.length === 0) return []
    const translations =
      sourceLines.length > 0
        ? sourceLines.map((entry) => entry.line.translatedLyric?.trim() ?? '')
        : pairAuxiliaryLines(original, source.tlyric ?? '')
    const romanizations =
      sourceLines.length > 0
        ? sourceLines.map((entry) => entry.line.romanLyric?.trim() ?? '')
        : pairAuxiliaryLines(original, source.romalrc ?? '')
    if (!translations.some(Boolean) && !romanizations.some(Boolean)) return []
    return [
      {
        original,
        translations,
        romanizations,
        alignment: alignAuxiliarySource(enriched, original),
        order,
      },
    ]
  })

  for (const field of ['translatedLyric', 'romanLyric'] as const) {
    const valuesKey = field === 'translatedLyric' ? 'translations' : 'romanizations'
    const rankedSources = [...preparedSources].sort(
      (left, right) =>
        auxiliarySourceScore(right, right[valuesKey]) - auxiliarySourceScore(left, left[valuesKey]) ||
        left.order - right.order,
    )
    for (const source of rankedSources) {
      const values = source[valuesKey]
      if (!values.some(Boolean)) continue
      const mapping = completeAuxiliaryMapping(enriched, source, values)
      for (let lineIndex = 0; lineIndex < enriched.length; lineIndex++) {
        const sourceIndex = mapping[lineIndex]
        if (sourceIndex < 0 || enriched[lineIndex][field] || !values[sourceIndex]) continue
        enriched[lineIndex][field] = values[sourceIndex]
        changed = true
      }
    }
  }

  return {
    lines: enriched,
    changed,
    translationCoverage: auxiliaryCoverage(enriched, 'translatedLyric'),
    romanCoverage: auxiliaryCoverage(enriched, 'romanLyric'),
  }
}

export function needsLyricAuxiliary(lines: readonly LyricLine[]): boolean {
  const text = lines
    .filter((line) => !line.isBG)
    .map(lineText)
    .join('')
  const hasKoreanOrJapanese = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
  const latinCount = text.match(/\p{Script=Latin}/gu)?.length ?? 0
  const cjkCount = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const mainlyLatin = latinCount >= 24 && latinCount > cjkCount
  if (!hasKoreanOrJapanese && !mainlyLatin) return false

  const translationCoverage = auxiliaryCoverage(lines, 'translatedLyric')
  const romanCoverage = auxiliaryCoverage(lines, 'romanLyric')
  return translationCoverage < 0.6 || (hasKoreanOrJapanese && romanCoverage < 0.6)
}

function repairInvalidLines(lines: readonly LyricLine[], sources: readonly LyricRepairSource[]): LyricLine[] {
  const repaired = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  const invalidIndexes = repaired.flatMap((line, index) =>
    !isValidRange(line.startTime, line.endTime) &&
    !line.words.some((word) => isValidRange(word.startTime, word.endTime))
      ? [index]
      : [],
  )
  if (invalidIndexes.length === 0) return repaired

  const candidateGroups = sources.flatMap((source) => {
    const candidates = source.wordByWord?.length
      ? wordByWordCandidates(source.wordByWord)
      : source.lrc
        ? parseLrcCandidates(source.lrc)
        : []
    return candidates.length > 0 ? [{ candidates, offset: estimateTimelineOffset(repaired, candidates) }] : []
  })

  for (const invalidIndex of invalidIndexes) {
    const target = repaired[invalidIndex]
    const targetText = normalizeLyricText(lineText(target))
    if (!targetText) continue

    const previous = repaired
      .slice(0, invalidIndex)
      .reverse()
      .find((line) => isValidRange(line.startTime, line.endTime))
    const next = repaired.slice(invalidIndex + 1).find((line) => isValidRange(line.startTime, line.endTime))

    for (const group of candidateGroups) {
      const matches = group.candidates
        .filter((candidate) => candidate.normalizedText === targetText)
        .map((candidate) => ({
          candidate,
          startTime: candidate.startTime + group.offset,
          endTime: candidate.endTime + group.offset,
        }))
        .filter(({ candidate, startTime }) => {
          const overlapTolerance = candidate.hasWordTiming ? 1_500 : 250
          if (previous && startTime < previous.endTime - overlapTolerance) return false
          if (next && startTime > next.startTime + 250) return false
          return true
        })
        .sort((left, right) => left.startTime - right.startTime)

      const match = matches[0]
      if (!match) continue
      const maximumEndTime = next ? next.startTime - 50 : match.startTime + 1_500
      const endTime = Math.max(match.startTime + 100, Math.min(match.endTime, maximumEndTime))
      const sourceWords = match.candidate.hasWordTiming ? match.candidate.words : target.words
      const words = sourceWords.map((word) => {
        const startTime = Math.min(endTime - 1, Math.max(match.startTime, word.startTime + group.offset))
        if (!match.candidate.hasWordTiming) {
          return { ...word, startTime: match.startTime, endTime }
        }
        return {
          ...word,
          startTime,
          endTime: Math.max(startTime + 1, Math.min(endTime, word.endTime + group.offset)),
        }
      })
      repaired[invalidIndex] = {
        ...target,
        words,
        startTime: match.startTime,
        endTime,
      }
      break
    }
  }

  return repaired
}

function normalizeLine(line: LyricLine): LyricLine | null {
  if (line.words.length === 0) return null

  const timedWords = line.words.filter((word) => isValidRange(word.startTime, word.endTime))
  const hasValidLineRange = isValidRange(line.startTime, line.endTime)

  // A zero-duration TTML placeholder has no position on the playback timeline.
  // Keeping it can make AMLL mistake every normal inter-line gap for the end of the song.
  if (!hasValidLineRange && timedWords.length === 0) return null

  const validWordStartTime = timedWords.length > 0 ? Math.min(...timedWords.map((word) => word.startTime)) : Infinity
  const validWordEndTime = timedWords.length > 0 ? Math.max(...timedWords.map((word) => word.endTime)) : -Infinity
  const fallbackStartTime = hasValidLineRange ? line.startTime : validWordStartTime
  const fallbackEndTime = hasValidLineRange ? line.endTime : validWordEndTime
  const words = line.words.map((word) =>
    isValidRange(word.startTime, word.endTime)
      ? { ...word }
      : { ...word, startTime: fallbackStartTime, endTime: fallbackEndTime },
  )
  const wordStartTime = Math.min(...words.map((word) => word.startTime))
  const wordEndTime = Math.max(...words.map((word) => word.endTime))
  const startTime = hasValidLineRange ? Math.min(line.startTime, wordStartTime) : wordStartTime
  const endTime = hasValidLineRange ? Math.max(line.endTime, wordEndTime) : wordEndTime

  return {
    ...line,
    words,
    startTime,
    endTime,
  }
}

/**
 * Normalizes third-party word-by-word lyrics before AMLL builds its timeline.
 *
 * Main lines and their immediately following background-vocal lines form one
 * indivisible group. Sorting groups instead of individual lines preserves the
 * adjacency AMLL uses to attach background vocals to their main line.
 */
function normalizeValidLyricLines(lines: readonly LyricLine[]): LyricLine[] {
  const groups: LyricGroup[] = []
  let canAttachBackgroundLine = false

  for (let originalIndex = 0; originalIndex < lines.length; originalIndex++) {
    const line = normalizeLine(lines[originalIndex])
    if (!line) {
      canAttachBackgroundLine = false
      continue
    }

    const previousGroup = groups.at(-1)
    if (line.isBG && previousGroup && canAttachBackgroundLine) {
      previousGroup.lines.push(line)
      previousGroup.startTime = Math.min(previousGroup.startTime, line.startTime)
      continue
    }

    groups.push({ lines: [line], originalIndex, startTime: line.startTime })
    canAttachBackgroundLine = !line.isBG
  }

  return [...groups]
    .sort((left, right) => left.startTime - right.startTime || left.originalIndex - right.originalIndex)
    .flatMap((group) => group.lines)
}

export function repairLyricTimeline(
  lines: readonly LyricLine[],
  sources: readonly LyricRepairSource[],
): LyricTimelineResult {
  const repaired = repairInvalidLines(lines, sources)
  const normalized = normalizeValidLyricLines(repaired)
  return { lines: normalized, unresolvedCount: lines.length - normalized.length }
}

export function normalizeLyricTimeline(lines: readonly LyricLine[]): LyricLine[] {
  return repairLyricTimeline(lines, []).lines
}
