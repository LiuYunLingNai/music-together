import type { LyricLine, LyricRuby, LyricWord } from '../domain/types'
import type { ServerLyrics } from '../services/api'
import { serverWordByWordToLines } from '../services/api'

interface LrcEntry {
  timeMs: number
  text: string
}

const METADATA_NAMESPACE = 'http://www.w3.org/ns/ttml#metadata'

export function parseTime(value: string | null): number {
  const clean = value?.trim() ?? ''
  if (!clean) return 0
  if (clean.endsWith('ms')) return Math.round(Number.parseFloat(clean.slice(0, -2)) || 0)
  if (clean.endsWith('s')) return Math.round((Number.parseFloat(clean.slice(0, -1)) || 0) * 1000)
  const match = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d+)?)$/.exec(clean)
  if (!match) return 0
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? 0)
  const seconds = Number(match[3] ?? 0)
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
}

export function parseLrcTimeline(value: string): LrcEntry[] {
  const entries: LrcEntry[] = []
  for (const raw of value.split(/\r?\n/)) {
    const text = raw.replace(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?]/g, '').trim()
    const timestamps = raw.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?]/g)
    for (const match of timestamps) {
      const fraction = (match[3] ?? '').padEnd(3, '0').slice(0, 3)
      entries.push({
        timeMs: (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(fraction || 0),
        text,
      })
    }
  }
  return entries.sort((left, right) => left.timeMs - right.timeMs)
}

function nearest(values: LrcEntry[], target: number): string {
  let best: LrcEntry | undefined
  for (const value of values) {
    if (!best || Math.abs(value.timeMs - target) < Math.abs(best.timeMs - target)) best = value
  }
  return best && Math.abs(best.timeMs - target) <= 500 ? best.text : ''
}

export function parseLrc(original: string, translated = '', roman = ''): LyricLine[] {
  const timeline = parseLrcTimeline(original)
  const translations = parseLrcTimeline(translated).filter((entry) => entry.text)
  const romans = parseLrcTimeline(roman).filter((entry) => entry.text)
  return timeline.flatMap((entry, index) => {
    if (!entry.text) return []
    const endTimeMs = timeline.slice(index + 1).find((next) => next.timeMs > entry.timeMs)?.timeMs ?? entry.timeMs + 5_000
    return [{
      words: [{ text: entry.text, startTimeMs: entry.timeMs, endTimeMs }],
      translatedLyric: nearest(translations, entry.timeMs),
      romanLyric: nearest(romans, entry.timeMs),
      startTimeMs: entry.timeMs,
      endTimeMs,
    }]
  })
}

export function parseYrc(value: string): LyricLine[] {
  const result: LyricLine[] = []
  for (const raw of value.split(/\r?\n/)) {
    const lineMatch = /\[(\d+),(\d+)](.*)/.exec(raw)
    if (!lineMatch) continue
    const lineStart = Number(lineMatch[1])
    const lineDuration = Number(lineMatch[2])
    const words: LyricWord[] = []
    for (const wordMatch of lineMatch[3].matchAll(/\((\d+),(\d+),\d+\)([^()]*)/g)) {
      const rawStart = Number(wordMatch[1])
      const duration = Number(wordMatch[2])
      const startTimeMs = rawStart < lineStart && rawStart < lineDuration ? lineStart + rawStart : rawStart
      words.push({ text: wordMatch[3], startTimeMs, endTimeMs: startTimeMs + duration })
    }
    if (words.length) result.push({ words, startTimeMs: lineStart, endTimeMs: lineStart + lineDuration })
  }
  return result.sort((left, right) => left.startTimeMs - right.startTimeMs)
}

function mergeAuxiliary(lines: LyricLine[], translated = '', roman = ''): LyricLine[] {
  const translations = parseLrcTimeline(translated).filter((entry) => entry.text)
  const romans = parseLrcTimeline(roman).filter((entry) => entry.text)
  return lines.map((line) => ({
    ...line,
    translatedLyric: line.translatedLyric || nearest(translations, line.startTimeMs),
    romanLyric: line.romanLyric || nearest(romans, line.startTimeMs),
  }))
}

export function parseServerLyrics(data: ServerLyrics): { lines: LyricLine[]; source: string } {
  if (data.wordByWord?.length) {
    return { lines: mergeAuxiliary(serverWordByWordToLines(data.wordByWord), data.tlyric, data.romalrc), source: 'wordByWord' }
  }
  const yrc = parseYrc(data.yrc ?? '')
  if (yrc.length) return { lines: mergeAuxiliary(yrc, data.tlyric, data.romalrc), source: 'yrc' }
  return { lines: parseLrc(data.lyric ?? '', data.tlyric, data.romalrc), source: 'lrc' }
}

function attribute(element: Element, namespace: string | null, name: string): string {
  return (namespace ? element.getAttributeNS(namespace, name) : element.getAttribute(name))
    || element.getAttribute(`ttm:${name}`)
    || ''
}

function directTextWithoutMetadata(element: Element): string {
  let result = ''
  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) result += child.nodeValue ?? ''
    else if (child instanceof Element) {
      const role = attribute(child, METADATA_NAMESPACE, 'role')
      if (!['x-roman', 'x-translation', 'x-ruby'].includes(role)) result += directTextWithoutMetadata(child)
    }
  })
  return result
}

function nestedRoleText(element: Element, targetRole: string): string {
  return Array.from(element.querySelectorAll('span'))
    .find((span) => span !== element && attribute(span, METADATA_NAMESPACE, 'role') === targetRole)
    ?.textContent?.trim() ?? ''
}

function nestedRuby(element: Element, fallbackStart: number, fallbackEnd: number): LyricRuby[] {
  const rubyContainers = Array.from(element.querySelectorAll('span'))
    .filter((span) => attribute(span, METADATA_NAMESPACE, 'role') === 'x-ruby')
  return rubyContainers.flatMap((container) => {
    const parts = Array.from(container.querySelectorAll('span')).filter((span) => directTextWithoutMetadata(span).trim())
    const targets = parts.length ? parts : [container]
    return targets.map((part) => ({
      text: (parts.length ? directTextWithoutMetadata(part) : part.textContent ?? '').trim(),
      startTimeMs: parseTime(part.getAttribute('begin')) || fallbackStart,
      endTimeMs: parseTime(part.getAttribute('end')) || fallbackEnd,
    })).filter((ruby) => ruby.text)
  })
}

function appendSemanticWhitespace(words: LyricWord[], value: string | null): void {
  if (!words.length || !value || /[\r\n]/.test(value) || !/^\s+$/.test(value)) return
  words[words.length - 1] = { ...words[words.length - 1], text: `${words[words.length - 1].text} ` }
}

function parseWordContainer(element: Element, fallbackStart: number, fallbackEnd: number): LyricWord[] {
  const words: LyricWord[] = []
  const containerStart = parseTime(element.getAttribute('begin')) || fallbackStart
  const containerEnd = parseTime(element.getAttribute('end')) || fallbackEnd
  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return appendSemanticWhitespace(words, child.nodeValue)
    if (!(child instanceof Element) || child.localName !== 'span') return
    const role = attribute(child, METADATA_NAMESPACE, 'role')
    if (['x-roman', 'x-translation'].includes(role)) return
    const text = directTextWithoutMetadata(child)
    if (!text) return
    const startTimeMs = parseTime(child.getAttribute('begin')) || containerStart
    const endTimeMs = parseTime(child.getAttribute('end')) || containerEnd
    words.push({ text, startTimeMs, endTimeMs, romanText: nestedRoleText(child, 'x-roman'), ruby: nestedRuby(child, startTimeMs, endTimeMs) })
  })
  if (!words.length) {
    const text = directTextWithoutMetadata(element).trim()
    if (text) words.push({ text, startTimeMs: containerStart, endTimeMs: containerEnd })
  }
  return words
}

function trimBackgroundParentheses(words: LyricWord[]): LyricWord[] {
  if (!words.length) return words
  const result = words.map((word) => ({ ...word }))
  result[0].text = result[0].text.replace(/^[（(]+/, '').trimStart()
  result[result.length - 1].text = result[result.length - 1].text.replace(/[）)]+$/, '').trimEnd()
  return result.filter((word) => word.text)
}

export function parseTtml(xml: string): LyricLine[] {
  if (!xml.includes('<tt')) return []
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) return []
  let primaryAgent = ''
  const result: LyricLine[] = []
  for (const paragraph of Array.from(document.getElementsByTagNameNS('*', 'p'))) {
    const agent = attribute(paragraph, METADATA_NAMESPACE, 'agent')
    if (!primaryAgent && agent) primaryAgent = agent
    const startTimeMs = parseTime(paragraph.getAttribute('begin'))
    const endTimeMs = parseTime(paragraph.getAttribute('end'))
    const isDuet = Boolean(primaryAgent && agent && agent !== primaryAgent)
    const mainWords: LyricWord[] = []
    let translatedLyric = ''
    let romanLyric = ''

    paragraph.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return appendSemanticWhitespace(mainWords, child.nodeValue)
      if (!(child instanceof Element) || child.localName !== 'span') return
      const role = attribute(child, METADATA_NAMESPACE, 'role')
      if (role === 'x-translation') translatedLyric = child.textContent?.trim() ?? ''
      else if (role === 'x-roman') romanLyric = child.textContent?.trim() ?? ''
      else if (role === 'x-bg') {
        const words = trimBackgroundParentheses(parseWordContainer(child, startTimeMs, endTimeMs))
        if (words.length) result.push({
          words,
          startTimeMs: parseTime(child.getAttribute('begin')) || words[0].startTimeMs,
          endTimeMs: parseTime(child.getAttribute('end')) || words[words.length - 1].endTimeMs,
          isBackground: true,
          isDuet,
        })
      } else {
        const wordStart = parseTime(child.getAttribute('begin')) || startTimeMs
        const wordEnd = parseTime(child.getAttribute('end')) || endTimeMs
        const text = directTextWithoutMetadata(child)
        if (text) mainWords.push({
          text,
          startTimeMs: wordStart,
          endTimeMs: wordEnd,
          romanText: nestedRoleText(child, 'x-roman'),
          ruby: nestedRuby(child, wordStart, wordEnd),
        })
      }
    })
    if (!mainWords.length) {
      const text = directTextWithoutMetadata(paragraph).trim()
      if (text) mainWords.push({ text, startTimeMs, endTimeMs })
    }
    if (mainWords.length) result.push({
      words: mainWords,
      translatedLyric,
      romanLyric,
      startTimeMs: startTimeMs || mainWords[0].startTimeMs,
      endTimeMs: endTimeMs || mainWords[mainWords.length - 1].endTimeMs,
      isDuet,
    })
  }
  return result.sort((left, right) => left.startTimeMs - right.startTimeMs || Number(left.isBackground) - Number(right.isBackground))
}
