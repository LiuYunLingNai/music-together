import type { LyricGroup, LyricInterlude, LyricLine, LyricWord } from '../domain/types'

function normalizeSpaces(line: LyricLine): LyricLine {
  return { ...line, words: line.words.map((word) => ({ ...word, text: word.text.replace(/\s+/g, ' ') })) }
}

function resetTimestamps(line: LyricLine): LyricLine {
  if (line.words.length === 1 && line.words[0].startTimeMs === 0 && line.words[0].endTimeMs === 0 && (line.startTimeMs || line.endTimeMs)) {
    return { ...line, words: [{ ...line.words[0], startTimeMs: line.startTimeMs, endTimeMs: line.endTimeMs }] }
  }
  if (!line.words.length) return line
  return { ...line, startTimeMs: line.words[0].startTimeMs, endTimeMs: line.words[line.words.length - 1].endTimeMs }
}

function convertExcessiveBackground(lines: LyricLine[]): LyricLine[] {
  let count = 0
  return lines.map((line) => {
    if (!line.isBackground) {
      count = 0
      return line
    }
    count += 1
    return count > 1 ? { ...line, isBackground: false } : line
  })
}

function syncBackground(lines: LyricLine[]): LyricLine[] {
  const result = lines.map((line) => ({ ...line }))
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const main = result[index]
    const background = result[index + 1]
    if (main.isBackground || !background?.isBackground) continue
    const words = [...main.words, ...background.words].filter((word) => word.text.trim())
    if (!words.length) continue
    const startTimeMs = Math.min(...words.map((word) => word.startTimeMs), main.startTimeMs, background.startTimeMs)
    const endTimeMs = Math.max(...words.map((word) => word.endTimeMs), main.endTimeMs, background.endTimeMs)
    result[index] = { ...main, startTimeMs, endTimeMs }
    result[index + 1] = { ...background, startTimeMs, endTimeMs }
  }
  return result
}

function cleanOverlaps(lines: LyricLine[]): LyricLine[] {
  const result = lines.map((line) => ({ ...line }))
  for (let index = 0; index < result.length - 1; index += 1) {
    const line = result[index]
    if (line.isBackground) continue
    let nextIndex = index + 1
    while (result[nextIndex]?.isBackground) nextIndex += 1
    const next = result[nextIndex]
    if (!next) continue
    const overlap = line.endTimeMs - next.startTimeMs
    const nextDuration = next.endTimeMs - next.startTimeMs
    const intentional = overlap > 100 && overlap > nextDuration * 0.1
    if (overlap > 0 && !intentional) {
      result[index] = { ...line, endTimeMs: next.startTimeMs }
      if (result[index + 1]?.isBackground) result[index + 1] = { ...result[index + 1], endTimeMs: next.startTimeMs }
    }
  }
  return result
}

function advanceStarts(lines: LyricLine[]): LyricLine[] {
  const result = lines.map((line) => ({ ...line }))
  let previousLineStart = 0
  let previousLineEnd = 0
  let previousGroupStart = 0
  let previousGroupEnd = 0
  let hasPrevious = false
  for (let index = 0; index < result.length; index += 1) {
    const line = result[index]
    if (line.isBackground) continue
    const originallyHadGap = hasPrevious && line.startTimeMs >= previousLineEnd
    const advance = !hasPrevious || originallyHadGap ? 600 : 400
    const safeBoundary = !hasPrevious ? 0 : originallyHadGap ? previousGroupEnd : previousLineStart + Math.round((previousLineEnd - previousLineStart) * 0.3)
    result[index] = { ...line, startTimeMs: Math.min(line.startTimeMs, Math.max(safeBoundary, line.startTimeMs - advance)) }
    if (result[index + 1]?.isBackground) result[index + 1] = { ...result[index + 1], startTimeMs: result[index].startTimeMs }
    if (hasPrevious && line.startTimeMs < previousGroupEnd && line.endTimeMs > previousGroupStart) {
      previousGroupStart = Math.min(previousGroupStart, line.startTimeMs)
      previousGroupEnd = Math.max(previousGroupEnd, line.endTimeMs)
    } else {
      previousGroupStart = line.startTimeMs
      previousGroupEnd = line.endTimeMs
    }
    previousLineStart = line.startTimeMs
    previousLineEnd = line.endTimeMs
    hasPrevious = true
  }
  return result
}

export function prepareLyricGroups(input: LyricLine[]): LyricGroup[] {
  let lines = input.map(normalizeSpaces).map(resetTimestamps)
  lines = convertExcessiveBackground(lines)
  lines = syncBackground(lines)
  lines = cleanOverlaps(lines)
  lines = advanceStarts(lines)
  const groups: LyricGroup[] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (line.isBackground && last && !last.background) {
      last.background = line
      last.startTimeMs = Math.min(last.startTimeMs, line.startTimeMs)
      last.endTimeMs = Math.max(last.endTimeMs, line.endTimeMs)
    } else {
      const main = line.isBackground ? { ...line, isBackground: false } : line
      groups.push({ main, startTimeMs: main.startTimeMs, endTimeMs: main.endTimeMs })
    }
  }
  return groups
}

export function findActiveGroup(groups: LyricGroup[], timeMs: number): number {
  let low = 0
  let high = groups.length - 1
  let result = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (groups[middle].startTimeMs <= timeMs) {
      result = middle
      low = middle + 1
    } else high = middle - 1
  }
  return result
}

export function wordProgress(word: LyricWord, positionMs: number): number {
  const between = (start: number, end: number) => positionMs <= start ? 0 : positionMs >= end ? 1 : (positionMs - start) / Math.max(1, end - start)
  const ruby = word.ruby?.filter((part) => part.text.trim()) ?? []
  if (!ruby.length) return between(word.startTimeMs, word.endTimeMs)
  const segments = ruby.map((part) => ({ ...part, units: Array.from(part.text).length })).filter((part) => part.units)
  const total = segments.reduce((sum, part) => sum + part.units, 0)
  if (!total) return between(word.startTimeMs, word.endTimeMs)
  return segments.reduce((sum, part) => sum + part.units * between(
    Math.min(word.endTimeMs, Math.max(word.startTimeMs, part.startTimeMs)),
    Math.min(word.endTimeMs, Math.max(part.startTimeMs, part.endTimeMs)),
  ), 0) / total
}

export function buildInterludes(groups: LyricGroup[]): LyricInterlude[] {
  return groups.flatMap((next, index) => {
    const anchor = index - 1
    const startTimeMs = groups[anchor]?.endTimeMs ?? 0
    const endTimeMs = Math.max(startTimeMs, next.startTimeMs - 250)
    if (endTimeMs - startTimeMs < 4_000) return []
    return [{ startTimeMs, endTimeMs, anchorGroupIndex: anchor, isNextDuet: Boolean(next.main.isDuet) }]
  })
}

export function findActiveInterlude(interludes: LyricInterlude[], timeMs: number): LyricInterlude | undefined {
  return interludes.find((interlude) => timeMs + 20 > interlude.startTimeMs && timeMs + 20 < interlude.endTimeMs)
}
