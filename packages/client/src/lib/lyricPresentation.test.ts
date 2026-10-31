import type { LyricLine } from '@applemusic-like-lyrics/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseYrc } from '@applemusic-like-lyrics/lyric'
import { repairLyricTimeline } from './lyricTimeline'
import {
  createLyricPresentationBuilder,
  isPresentationBetter,
  preserveTtmlStructure,
  toCoreLyricLines,
  type LyricData,
} from './lyricPresentation'

vi.mock('@applemusic-like-lyrics/lyric', async (importOriginal) => {
  const original = await importOriginal<typeof import('@applemusic-like-lyrics/lyric')>()
  return { ...original, parseYrc: vi.fn(original.parseYrc) }
})
vi.mock('./lyricTimeline', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lyricTimeline')>()
  return { ...original, repairLyricTimeline: vi.fn(original.repairLyricTimeline) }
})

const line = (text: string, start = 1000, duet = false): LyricLine => ({
  words: [
    { word: text.slice(0, 2), startTime: start, endTime: start + 400, romanWord: '', obscene: false },
    { word: text.slice(2), startTime: start + 400, endTime: start + 900, romanWord: '', obscene: false },
  ],
  startTime: start,
  endTime: start + 1000,
  translatedLyric: '',
  romanLyric: '',
  isDuet: duet,
  isBG: false,
})
const data = (patch: Partial<LyricData> = {}): LyricData => ({
  lyric: '', tlyric: '', romalrc: '', yrc: '', ...patch,
})

beforeEach(() => vi.clearAllMocks())

describe('request-local lyric preparation', () => {
  it('parses YRC and repairs timing once, then rescores the same lines', () => {
    const candidate = data({ yrc: '[1000,1000](1000,400,0)逐字(1400,500,0)歌词' })
    const builder = createLyricPresentationBuilder()
    const prepared = builder.buildNativePresentation(candidate)
    expect(parseYrc).toHaveBeenCalledTimes(1)
    expect(repairLyricTimeline).toHaveBeenCalledTimes(1)
    expect(prepared.lines?.[0].words.map((word) => word.word)).toEqual(['逐字', '歌词'])
    const rescored = builder.buildNativePresentation(candidate, 20)
    expect(rescored.lines).toBe(prepared.lines)
    expect(rescored.quality.textCoverage).toBeLessThan(prepared.quality.textCoverage)
    builder.buildNativePresentation(candidate, 10, '[00:01.00]逐字歌词')
    expect(parseYrc).toHaveBeenCalledTimes(1)
    expect(repairLyricTimeline).toHaveBeenCalledTimes(1)
    expect(builder.buildNativePresentation(candidate)).toBe(prepared)
  })

  it('reuses TTML for one auxiliary input but prepares again when auxiliary lyrics arrive', () => {
    const lines = [line('逐字歌词')]
    const original = structuredClone(lines)
    const builder = createLyricPresentationBuilder()
    const first = builder.buildTtmlPresentation(lines, null)!
    const rescored = builder.buildTtmlPresentation(lines, null, 20)!
    builder.selectPreferredPresentation(lines, null)
    expect(rescored.lines).toBe(first.lines)
    expect(repairLyricTimeline).toHaveBeenCalledTimes(1)
    const auxiliary = data({ lyric: '[00:01.00]逐字歌词', tlyric: '[00:01.00]translated' })
    const enriched = builder.buildTtmlPresentation(lines, auxiliary)!
    expect(repairLyricTimeline).toHaveBeenCalledTimes(2)
    expect(enriched.lines?.[0].translatedLyric).toBe('translated')
    expect(builder.buildTtmlPresentation(lines, auxiliary)).toBe(enriched)
    expect(lines).toEqual(original)
  })

  it('keeps preparation local to a request and does not mutate native input', () => {
    const candidate = data({ wordByWord: [line('完整歌词')] })
    const original = structuredClone(candidate)
    const a = createLyricPresentationBuilder().buildNativePresentation(candidate)
    const b = createLyricPresentationBuilder().buildNativePresentation(candidate)
    expect(a.lines).not.toBe(b.lines)
    expect(candidate).toEqual(original)
  })

  it('retains empty, malformed YRC and LRC fallback results', () => {
    const builder = createLyricPresentationBuilder()
    expect(builder.buildNativePresentation(null)).toMatchObject({ source: 'none', lines: null })
    const lrc = '[00:01.00]纯行歌词'
    expect(builder.buildNativePresentation(data({ lyric: lrc, yrc: 'invalid' })))
      .toMatchObject({ source: 'native', lines: null, lyric: lrc })
  })

  it('keeps richer TTML structure and does not replace it with plain native lyrics', () => {
    const builder = createLyricPresentationBuilder()
    const nativeData = data({ wordByWord: [line('完整歌词')] })
    const ttml = [line('完整歌词', 1000, true)]
    const preferred = builder.selectPreferredPresentation(ttml, nativeData)
    expect(preferred.source).toBe('ttml')
    const native = builder.buildNativePresentation(nativeData)
    expect(isPresentationBetter(native, preferred)).toBe(false)
    expect(preserveTtmlStructure(native, preferred).lines?.[0].isDuet).toBe(true)
  })

  it('does not trade an aligned timeline for a small quality increase on an offset source', () => {
    const builder = createLyricPresentationBuilder()
    const lines = [0, 1, 2, 3].map((i) => line(`完整歌词${i}`, 1000 + i * 2000))
    const current = builder.buildNativePresentation(data({ wordByWord: lines }))
    const shifted = builder.buildNativePresentation(data({
      wordByWord: lines.map((entry) => ({ ...entry, startTime: entry.startTime + 600, endTime: entry.endTime + 600,
        words: entry.words.map((word) => ({ ...word, startTime: word.startTime + 600, endTime: word.endTime + 600 })) })),
    }))
    const next = { ...shifted, quality: { ...shifted.quality, confidence: current.quality.confidence + 0.04 } }
    expect(isPresentationBetter(next, current)).toBe(false)
    expect(isPresentationBetter({ ...current, quality: next.quality }, current)).toBe(true)
  })

  it('uses one core conversion for parser words with optional annotations', () => {
    const converted = toCoreLyricLines([{
      startTime: 1000, endTime: 2000, isBG: true, isDuet: true,
      words: [{ word: '歌词', startTime: 1000, endTime: 2000 }],
    } as ReturnType<typeof import('@applemusic-like-lyrics/lyric').parseTTML>['lines'][number]])
    expect(converted[0]).toMatchObject({ translatedLyric: '', romanLyric: '', isBG: true, isDuet: true })
    expect(converted[0].words[0]).toMatchObject({ romanWord: '', obscene: false })
  })
})
