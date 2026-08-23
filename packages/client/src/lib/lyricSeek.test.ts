import type { LyricLine } from '@applemusic-like-lyrics/core'
import { describe, expect, it } from 'vitest'
import { getLyricSeekTime } from './lyricSeek'

function lyricLine(lineStartMs: number, firstWordStartMs = lineStartMs): LyricLine {
  return {
    words: [
      {
        word: '测试歌词',
        startTime: firstWordStartMs,
        endTime: firstWordStartMs + 1_000,
        romanWord: '',
        obscene: false,
      },
    ],
    translatedLyric: '',
    romanLyric: '',
    startTime: lineStartMs,
    endTime: lineStartMs + 2_000,
    isBG: false,
    isDuet: false,
  }
}

describe('getLyricSeekTime', () => {
  it('uses the first word time and restores the configured lyric offset', () => {
    expect(getLyricSeekTime(lyricLine(10_000, 10_250), 300, 180)).toBe(10.55)
  })

  it('clamps calibrated targets to the playable time range', () => {
    expect(getLyricSeekTime(lyricLine(100), -500, 180)).toBe(0)
    expect(getLyricSeekTime(lyricLine(179_900), 500, 180)).toBe(180)
  })

  it('rejects seeking before a finite duration is available', () => {
    expect(getLyricSeekTime(lyricLine(10_000), 0, 0)).toBeNull()
    expect(getLyricSeekTime(lyricLine(10_000), 0, Number.NaN)).toBeNull()
  })
})
