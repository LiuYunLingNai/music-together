import type { LyricLine } from '../domain/types'
import type { ServerLyrics } from '../services/api'

export interface LyricQuality {
  animated: boolean
  confidence: number
  textCoverage: number
  validTimingCoverage: number
  repeatedCoverage: number
  structureCount: number
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const lineText = (line: LyricLine) => line.words.map((word) => word.text).join('')
const valid = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
const isAnimatedLine = (line: LyricLine) => new Set(line.words.filter((word) => valid(word.startTimeMs, word.endTimeMs)).map((word) => `${word.startTimeMs}:${word.endTimeMs}`)).size >= 2

function lcs(left: string, right: string): number {
  const a = Array.from(left); const b = Array.from(right); const row = new Uint16Array(b.length + 1)
  for (const char of a) { let diagonal = 0; for (let index = 1; index <= b.length; index++) { const previous = row[index]; row[index] = char === b[index - 1] ? diagonal + 1 : Math.max(row[index], row[index - 1]); diagonal = previous } }
  return row[b.length]
}

function similarity(left: string, right: string): number {
  if (left === right) return 1
  const shorter = Math.min(Array.from(left).length, Array.from(right).length)
  const longer = Math.max(Array.from(left).length, Array.from(right).length)
  if (shorter < 3) return 0
  const common = lcs(left, right)
  return common / shorter >= 0.88 && common / longer >= 0.42 ? 0.55 + common / longer * 0.4 : 0
}

interface TimedText { time: number; text: string; normalized: string }
function parseLrc(value = ''): TimedText[] {
  return [...value.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?](.*)/g)].flatMap((match) => {
    const text = match[4].trim(); const normalized = normalize(text)
    return text && normalized ? [{ time: (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? '').padEnd(3, '0').slice(0, 3) || 0), text, normalized }] : []
  }).sort((left, right) => left.time - right.time)
}

export function evaluateLyricQuality(lines: LyricLine[], referenceLrc = ''): LyricQuality {
  const meaningful = lines.filter((line) => normalize(lineText(line)))
  const characters = meaningful.reduce((total, line) => total + normalize(lineText(line)).length, 0)
  const animatedCharacters = meaningful.filter(isAnimatedLine).reduce((total, line) => total + normalize(lineText(line)).length, 0)
  const validCharacters = meaningful.reduce((total, line) => total + line.words.filter((word) => valid(word.startTimeMs, word.endTimeMs)).reduce((sum, word) => sum + normalize(word.text).length, 0), 0)
  const reference = parseLrc(referenceLrc).map((entry) => entry.normalized)
  const candidateText = meaningful.map((line) => normalize(lineText(line))).join('')
  const referenceText = reference.join('')
  const textCoverage = referenceText ? lcs(candidateText, referenceText) / referenceText.length : characters ? 1 : 0
  const counts = new Map<string, number>(); reference.filter((text) => text.length >= 4).forEach((text) => counts.set(text, (counts.get(text) ?? 0) + 1))
  let repeatedTotal = 0; let repeatedAnimated = 0
  for (const [text, count] of counts) { if (count < 2) continue; repeatedTotal += text.length * count; const matches = meaningful.filter((line) => similarity(normalize(lineText(line)), text) > 0 && isAnimatedLine(line)).length; repeatedAnimated += text.length * Math.min(count, matches) }
  const animationCoverage = characters ? animatedCharacters / characters : 0
  const validTimingCoverage = characters ? validCharacters / characters : 0
  const repeatedCoverage = repeatedTotal >= 20 ? repeatedAnimated / repeatedTotal : 1
  const animatedLineCount = meaningful.filter(isAnimatedLine).length
  const requiredAnimatedLines = Math.min(3, Math.max(1, Math.ceil(meaningful.length * 0.1)))
  const animated = animatedLineCount >= requiredAnimatedLines && animationCoverage >= 0.55 && validTimingCoverage >= 0.85 && textCoverage >= 0.8 && repeatedCoverage >= 0.6
  return { animated, confidence: animationCoverage * 0.4 + textCoverage * 0.25 + validTimingCoverage * 0.2 + repeatedCoverage * 0.15, textCoverage, validTimingCoverage, repeatedCoverage, structureCount: lines.filter((line) => line.isDuet || line.isBackground).length }
}

export function preferLyricCandidate(current: LyricLine[], next: LyricLine[], referenceLrc = '', nextIsTtml = false): boolean {
  if (!current.length) return Boolean(next.length)
  const a = evaluateLyricQuality(current, referenceLrc); const b = evaluateLyricQuality(next, referenceLrc)
  const aStructure = a.structureCount > 0 && a.textCoverage >= 0.8 && a.validTimingCoverage >= 0.85
  const bStructure = b.structureCount > 0 && b.textCoverage >= 0.8 && b.validTimingCoverage >= 0.85
  if (aStructure !== bStructure) return bStructure
  if (a.animated !== b.animated) return b.animated
  return b.confidence > a.confidence + (nextIsTtml ? -0.01 : 0.03)
}

export function needsLyricSupplement(lines: LyricLine[], referenceLrc = ''): boolean {
  const quality = evaluateLyricQuality(lines, referenceLrc)
  if (!quality.animated) return true
  const meaningful = lines.filter((line) => !line.isBackground && normalize(lineText(line)))
  const text = meaningful.map(lineText).join('')
  const koreanOrJapanese = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
  const foreign = koreanOrJapanese || (text.match(/\p{Script=Latin}/gu)?.length ?? 0) >= 24
  const translationCoverage = meaningful.filter((line) => line.translatedLyric?.trim()).length / Math.max(1, meaningful.length)
  const romanCoverage = meaningful.filter((line) => line.romanLyric?.trim()).length / Math.max(1, meaningful.length)
  return foreign && (translationCoverage < 0.6 || (koreanOrJapanese && romanCoverage < 0.6))
}

function pair(original: TimedText[], auxiliary = ''): string[] {
  const values = parseLrc(auxiliary); let cursor = 0
  return original.map((entry) => { while (cursor < values.length && values[cursor].time < entry.time - 1500) cursor++; let best = -1; let distance = 1501; for (let index = cursor; index < values.length && values[index].time <= entry.time + 1500; index++) { const candidate = Math.abs(values[index].time - entry.time); if (candidate < distance) { best = index; distance = candidate } } if (best < 0) return ''; cursor = best + 1; return values[best].text })
}

function align(lines: LyricLine[], original: TimedText[]): number[] {
  const targets = lines.flatMap((line, index) => !line.isBackground && valid(line.startTimeMs, line.endTimeMs) && normalize(lineText(line)) ? [{ index, time: line.startTimeMs, text: normalize(lineText(line)) }] : [])
  const offsets: number[] = []
  for (const target of targets) { const matches = original.filter((entry) => entry.normalized === target.text); if (matches.length === 1 && targets.filter((entry) => entry.text === target.text).length === 1 && Math.abs(target.time - matches[0].time) <= 6000) offsets.push(target.time - matches[0].time) }
  offsets.sort((a, b) => a - b); const offset = offsets.length >= 3 ? offsets[Math.floor(offsets.length / 2)] : 0
  const width = original.length + 1; const scores = new Float32Array((targets.length + 1) * width); const decisions = new Uint8Array(scores.length)
  for (let i = 1; i <= targets.length; i++) for (let j = 1; j <= original.length; j++) { const cell = i * width + j; const up = scores[(i - 1) * width + j]; const left = scores[cell - 1]; scores[cell] = Math.max(up, left); decisions[cell] = up >= left ? 1 : 2; const match = similarity(targets[i - 1].text, original[j - 1].normalized); const distance = Math.abs(targets[i - 1].time - original[j - 1].time - offset); const diagonal = scores[(i - 1) * width + j - 1] + match * 10 + 1 - distance / 6000; if (match > 0 && distance <= 6000 && diagonal > scores[cell]) { scores[cell] = diagonal; decisions[cell] = 3 } }
  const result = new Array<number>(lines.length).fill(-1); let i = targets.length; let j = original.length
  while (i && j) { const decision = decisions[i * width + j]; if (decision === 3) { result[targets[i - 1].index] = j - 1; i--; j-- } else if (decision === 2) j--; else i-- }
  return result
}

function completeMapping(lines: LyricLine[], original: TimedText[], values: string[], mapping: number[]): number[] {
  const completed = [...mapping]
  const matchedCount = completed.filter((sourceIndex) => sourceIndex >= 0).length
  if (matchedCount < Math.min(8, Math.ceil(original.length * 0.2))) return completed
  const offsets = completed.flatMap((sourceIndex, lineIndex) => sourceIndex >= 0 ? [lines[lineIndex].startTimeMs - original[sourceIndex].time] : [])
  offsets.sort((left, right) => left - right)
  const offset = offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0
  const used = new Set(completed.filter((sourceIndex) => sourceIndex >= 0))
  for (let sourceIndex = 0; sourceIndex < original.length; sourceIndex++) {
    if (used.has(sourceIndex) || !values[sourceIndex]) continue
    let previousTarget = -1
    for (let lineIndex = completed.length - 1; lineIndex >= 0; lineIndex--) {
      if (completed[lineIndex] >= 0 && completed[lineIndex] < sourceIndex) { previousTarget = lineIndex; break }
    }
    const nextTarget = completed.findIndex((mappedSource) => mappedSource > sourceIndex)
    const upperBound = nextTarget < 0 ? completed.length : nextTarget
    let bestTarget = -1
    let bestDistance = 6_001
    for (let lineIndex = previousTarget + 1; lineIndex < upperBound; lineIndex++) {
      const line = lines[lineIndex]
      if (completed[lineIndex] >= 0 || line.isBackground || !valid(line.startTimeMs, line.endTimeMs)) continue
      const distance = Math.abs(line.startTimeMs - original[sourceIndex].time - offset)
      if (distance < bestDistance) { bestDistance = distance; bestTarget = lineIndex }
    }
    if (bestTarget >= 0) { completed[bestTarget] = sourceIndex; used.add(sourceIndex) }
  }
  return completed
}

export function enrichLyricLines(lines: LyricLine[], sources: ServerLyrics[], structure?: LyricLine[]): LyricLine[] {
  const result = lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }))
  const prepared = sources.flatMap((source) => { const original = parseLrc(source.lyric); if (!original.length) return []; const translated = pair(original, source.tlyric); const roman = pair(original, source.romalrc); const mapping = align(result, original); return [{ original, translated, roman, mapping }] })
  for (const field of ['translatedLyric', 'romanLyric'] as const) { const key = field === 'translatedLyric' ? 'translated' : 'roman'; const ranked = [...prepared].sort((a, b) => b.mapping.filter((index) => index >= 0 && b[key][index]).length - a.mapping.filter((index) => index >= 0 && a[key][index]).length); for (const source of ranked) completeMapping(result, source.original, source[key], source.mapping).forEach((sourceIndex, lineIndex) => { if (sourceIndex >= 0 && !result[lineIndex][field] && source[key][sourceIndex]) result[lineIndex][field] = source[key][sourceIndex] }) }
  if (structure?.length) { const original = structure.map((line) => ({ time: line.startTimeMs, text: lineText(line), normalized: normalize(lineText(line)) })); const mapping = align(result, original); if (mapping.filter((index) => index >= 0).length >= Math.min(3, Math.ceil(original.length * 0.2))) mapping.forEach((sourceIndex, lineIndex) => { if (sourceIndex < 0) return; const source = structure[sourceIndex]; if (source.isDuet) result[lineIndex].isDuet = true; if (source.isBackground && lineIndex > 0 && !result[lineIndex - 1].isBackground) result[lineIndex].isBackground = true }) }
  return result
}
