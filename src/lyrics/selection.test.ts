import { describe, expect, it } from 'vitest'
import type { LyricLine } from '../domain/types'
import { enrichLyricLines, evaluateLyricQuality, needsLyricSupplement } from './selection'

function line(text: string, startTimeMs: number, options: Partial<LyricLine> = {}): LyricLine {
  return {
    words: Array.from(text).map((word, index) => ({
      text: word,
      startTimeMs: startTimeMs + index * 100,
      endTimeMs: startTimeMs + (index + 1) * 100,
    })),
    startTimeMs,
    endTimeMs: startTimeMs + Array.from(text).length * 100,
    ...options,
  }
}

describe('lyrics selection', () => {
  it('requests auxiliary lyrics when an accepted foreign word timeline lacks translations', () => {
    const lines = [line('지금은소녀시대', 1_000), line('GeeGeeGeeGee', 3_000)]

    expect(evaluateLyricQuality(lines).animated).toBe(true)
    expect(needsLyricSupplement(lines)).toBe(true)
    expect(needsLyricSupplement(lines.map((entry) => ({ ...entry, translatedLyric: '译文' })))).toBe(true)
    expect(needsLyricSupplement(lines.map((entry) => ({ ...entry, translatedLyric: '译文', romanLyric: 'roman' })))).toBe(false)
  })

  it('aligns translation and romanization across a stable offset without changing AMLL timing', () => {
    const lines = [line('第一句歌词', 11_000), line('第二句歌词', 21_000), line('第三句歌词', 31_000)]
    const originalWords = lines.map((entry) => entry.words)

    const enriched = enrichLyricLines(lines, [{
      lyric: '[00:10.00]第一句歌词\n[00:20.00]第二句歌词\n[00:30.00]第三句歌词',
      tlyric: '[00:10.00]First\n[00:20.00]Second\n[00:30.00]Third',
      romalrc: '[00:10.00]yi\n[00:20.00]er\n[00:30.00]san',
    }])

    expect(enriched.map((entry) => entry.translatedLyric)).toEqual(['First', 'Second', 'Third'])
    expect(enriched.map((entry) => entry.romanLyric)).toEqual(['yi', 'er', 'san'])
    expect(enriched.map((entry) => entry.words)).toEqual(originalWords)
    expect(enriched.map((entry) => entry.startTimeMs)).toEqual([11_000, 21_000, 31_000])
  })

  it('fills an unmatched line only between established neighboring anchors', () => {
    const lines = [line('第一句歌词', 11_000), line('完全不同正文', 21_000), line('第三句歌词', 31_000)]
    const enriched = enrichLyricLines(lines, [{
      lyric: '[00:10.00]第一句歌词\n[00:20.00]来源不同写法\n[00:30.00]第三句歌词',
      tlyric: '[00:10.00]First\n[00:20.00]Second\n[00:30.00]Third',
    }])

    expect(enriched.map((entry) => entry.translatedLyric)).toEqual(['First', 'Second', 'Third'])
  })

  it('preserves duet and background structure while filling auxiliary text', () => {
    const lines = [
      line('主唱第一句', 1_000),
      line('背景和声句', 2_000, { isBackground: true }),
      line('对唱第二句', 3_000, { isDuet: true }),
    ]

    const enriched = enrichLyricLines(lines, [{
      lyric: '[00:01.00]主唱第一句\n[00:02.00]背景和声句\n[00:03.00]对唱第二句',
      tlyric: '[00:01.00]Lead\n[00:02.00]Backing\n[00:03.00]Duet',
    }])

    expect(enriched[1].isBackground).toBe(true)
    expect(enriched[2].isDuet).toBe(true)
    expect(enriched.map((entry) => entry.words)).toEqual(lines.map((entry) => entry.words))
  })
})
