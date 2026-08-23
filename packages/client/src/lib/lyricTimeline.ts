import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core'

const LRC_TIMESTAMP_PATTERN = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
const SPEAKER_PREFIX_PATTERN = /^[^:：]{1,16}[:：]\s*/

interface LyricCandidate {
  words: LyricWord[]
  startTime: number
  endTime: number
  normalizedText: string
  hasWordTiming: boolean
}

export interface LyricRepairSource {
  lrc?: string
  wordByWord?: readonly LyricLine[]
}

export interface LyricTimelineResult {
  lines: LyricLine[]
  unresolvedCount: number
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

function repairInvalidLines(lines: readonly LyricLine[], sources: readonly LyricRepairSource[]): LyricLine[] {
  const repaired = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  const invalidIndexes = repaired.flatMap((line, index) =>
    !isValidRange(line.startTime, line.endTime) && !line.words.some((word) => isValidRange(word.startTime, word.endTime))
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
