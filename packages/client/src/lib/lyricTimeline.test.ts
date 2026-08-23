import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core'
import { describe, expect, it } from 'vitest'
import { normalizeLyricTimeline, repairLyricTimeline } from './lyricTimeline'

function lyricWord(word: string, startTime: number, endTime: number): LyricWord {
  return { word, startTime, endTime, romanWord: '', obscene: false }
}

function lyricLine(
  text: string,
  startTime: number,
  endTime: number,
  options: { isBG?: boolean; isDuet?: boolean; words?: LyricWord[] } = {},
): LyricLine {
  return {
    words: options.words ?? [lyricWord(text, startTime, endTime)],
    translatedLyric: '',
    romanLyric: '',
    startTime,
    endTime,
    isBG: options.isBG ?? false,
    isDuet: options.isDuet ?? false,
  }
}

describe('normalizeLyricTimeline', () => {
  it('removes zero-duration placeholders and leaves a valid chronological tail', () => {
    const lines = [
      lyricLine('第一句', 20_182, 24_987),
      lyricLine('第二句', 26_510, 36_281),
      lyricLine('喔', 0, 0),
      lyricLine('对唱', 37_424, 42_905, { isDuet: true }),
      lyricLine('喔', 0, 0),
    ]

    const normalized = normalizeLyricTimeline(lines)

    expect(normalized.map((line) => line.words[0]?.word)).toEqual(['第一句', '第二句', '对唱'])
    expect(normalized.at(-1)?.endTime).toBe(42_905)
  })

  it('sorts main-line groups without detaching their background vocals', () => {
    const lines = [
      lyricLine('后一句', 20_000, 24_000),
      lyricLine('背景人声', 19_800, 24_000, { isBG: true }),
      lyricLine('前一句', 10_000, 14_000, { isDuet: true }),
    ]

    const normalized = normalizeLyricTimeline(lines)

    expect(normalized.map((line) => line.words[0]?.word)).toEqual(['前一句', '后一句', '背景人声'])
    expect(normalized[2].isBG).toBe(true)
  })

  it('repairs an invalid line range from valid word timing without mutating its input', () => {
    const source = lyricLine('逐字歌词', 0, 0, {
      words: [lyricWord('逐字', 5_000, 5_600), lyricWord('歌词', 5_600, 6_400)],
    })

    const [normalized] = normalizeLyricTimeline([source])

    expect(normalized).not.toBe(source)
    expect(normalized.words[0]).not.toBe(source.words[0])
    expect(normalized.startTime).toBe(5_000)
    expect(normalized.endTime).toBe(6_400)
    expect(source.startTime).toBe(0)
    expect(source.endTime).toBe(0)
  })

  it('repairs an invalid word range from a valid line range', () => {
    const source = lyricLine('整行歌词', 5_000, 6_400, { words: [lyricWord('整行歌词', 0, 0)] })

    const [normalized] = normalizeLyricTimeline([source])

    expect(normalized.words[0]).toMatchObject({ startTime: 5_000, endTime: 6_400 })
    expect(source.words[0]).toMatchObject({ startTime: 0, endTime: 0 })
  })

  it('keeps equal-time groups in their source order', () => {
    const lines = [lyricLine('甲', 10_000, 12_000), lyricLine('乙', 10_000, 13_000, { isDuet: true })]

    expect(normalizeLyricTimeline(lines).map((line) => line.words[0]?.word)).toEqual(['甲', '乙'])
  })

  it('does not attach an orphaned background line across an invalid placeholder', () => {
    const lines = [
      lyricLine('更早的主句', 10_000, 12_000),
      lyricLine('无效主句', 0, 0),
      lyricLine('孤立背景人声', 5_000, 7_000, { isBG: true }),
    ]

    const normalized = normalizeLyricTimeline(lines)

    expect(normalized.map((line) => line.words[0]?.word)).toEqual(['孤立背景人声', '更早的主句'])
  })

  it('restores zero-duration interjections from LRC and prefers KRC word timing when available', () => {
    const ttml = [
      lyricLine('无声开在乌云之下 然后 又飘到哪里呀', 26_510, 36_281),
      lyricLine('喔', 0, 0),
      lyricLine('漫步在人海的人 你过得好吗', 37_424, 42_905),
      lyricLine('前面听说风很大', 176_977, 182_558),
      lyricLine('喔', 0, 0),
      lyricLine('在飞云之下 以为忘了的家', 199_931, 203_334),
    ]
    const neteaseLrc = '[00:36.60]喔\n[00:37.42]漫步在人海的人 你过得好吗\n[03:01.86]喔'
    const kugouKrc = [
      lyricLine('无声开在乌云之下 然后 又飘到哪里呀', 26_300, 36_100),
      lyricLine('喔', 36_466, 36_833),
      lyricLine('漫步在人海的人 你过得好吗', 37_220, 42_700),
      lyricLine('前面听说风很大', 176_770, 182_350),
      lyricLine('喔', 183_960, 189_487),
      lyricLine('在飞云之下 以为忘了的家', 199_730, 203_130),
    ]

    const primary = repairLyricTimeline(ttml, [{ lrc: neteaseLrc }])
    expect(primary.unresolvedCount).toBe(1)

    const supplemented = repairLyricTimeline(ttml, [{ wordByWord: kugouKrc }, { lrc: neteaseLrc }])
    expect(supplemented.unresolvedCount).toBe(0)
    expect(supplemented.lines.filter((line) => line.words[0]?.word === '喔').map((line) => line.startTime)).toEqual([
      36_673,
      184_167,
    ])
  })

  it('uses an LRC candidate only for timing and preserves the original TTML text', () => {
    const ttml = [lyricLine('你说：我们还会再见', 0, 0), lyricLine('下一句', 12_000, 15_000)]
    const repaired = repairLyricTimeline(ttml, [{ lrc: '[00:10.00]你说：我们还会再见' }])

    expect(repaired.lines[0].words[0]?.word).toBe('你说：我们还会再见')
    expect(repaired.lines[0]).toMatchObject({ startTime: 10_000, endTime: 11_500 })
  })
})
