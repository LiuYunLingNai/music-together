import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core'
import { describe, expect, it } from 'vitest'
import {
  enrichLyricAuxiliary,
  enrichLyricStructure,
  evaluateLyricAnimationQuality,
  needsLyricAuxiliary,
  normalizeLyricTimeline,
  repairLyricTimeline,
} from './lyricTimeline'

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
      36_673, 184_167,
    ])
  })

  it('uses an LRC candidate only for timing and preserves the original TTML text', () => {
    const ttml = [lyricLine('你说：我们还会再见', 0, 0), lyricLine('下一句', 12_000, 15_000)]
    const repaired = repairLyricTimeline(ttml, [{ lrc: '[00:10.00]你说：我们还会再见' }])

    expect(repaired.lines[0].words[0]?.word).toBe('你说：我们还会再见')
    expect(repaired.lines[0]).toMatchObject({ startTime: 10_000, endTime: 11_500 })
  })
})

describe('evaluateLyricAnimationQuality', () => {
  const animatedLine = (first: string, second: string, startTime: number) =>
    lyricLine(`${first}${second}`, startTime, startTime + 1_000, {
      words: [lyricWord(first, startTime, startTime + 500), lyricWord(second, startTime + 500, startTime + 1_000)],
    })

  it('recognizes a complete lyric with genuine per-word timing', () => {
    const lines = [
      animatedLine('飞云', '之下', 1_000),
      animatedLine('我看', '着海峡', 3_000),
      animatedLine('走月', '光沙滩', 5_000),
    ]
    const quality = evaluateLyricAnimationQuality(
      lines,
      '[00:01.00]飞云之下\n[00:03.00]我看着海峡\n[00:05.00]走月光沙滩',
    )

    expect(quality.hasWordAnimation).toBe(true)
    expect(quality.animationCoverage).toBe(1)
    expect(quality.textCoverage).toBe(1)
  })

  it('records duet and background-vocal structure independently from word timing quality', () => {
    const lines = [
      lyricLine('女声主句', 1_000, 2_000),
      lyricLine('男声对唱', 3_000, 4_000, { isDuet: true }),
      lyricLine('背景和声', 3_200, 4_000, { isBG: true }),
    ]

    const quality = evaluateLyricAnimationQuality(lines)

    expect(quality.duetLineCount).toBe(1)
    expect(quality.backgroundLineCount).toBe(1)
    expect(quality.hasWordAnimation).toBe(false)
  })

  it('rejects a format that only has isolated animated lines', () => {
    const lines = [
      animatedLine('飞云', '之下', 1_000),
      lyricLine('我看着海峡', 3_000, 4_000),
      lyricLine('走月光沙滩', 5_000, 6_000),
      lyricLine('云朵很近', 7_000, 8_000),
    ]
    const quality = evaluateLyricAnimationQuality(
      lines,
      '[00:01.00]飞云之下\n[00:03.00]我看着海峡\n[00:05.00]走月光沙滩\n[00:07.00]云朵很近',
    )

    expect(quality.hasWordAnimation).toBe(false)
    expect(quality.animationCoverage).toBeLessThan(0.55)
  })

  it('rejects animated timing when the candidate is missing too much reference text', () => {
    const lines = [animatedLine('飞云', '之下', 1_000), animatedLine('我看', '着海峡', 3_000)]
    const quality = evaluateLyricAnimationQuality(
      lines,
      '[00:01.00]飞云之下\n[00:03.00]我看着海峡\n[00:05.00]走月光沙滩\n[00:07.00]云朵很近',
    )

    expect(quality.hasWordAnimation).toBe(false)
    expect(quality.textCoverage).toBeLessThan(0.8)
  })

  it('measures complete lyrics independently from provider line wrapping and timed credits', () => {
    const lines = [animatedLine('无声开在', '乌云之下', 10_000), animatedLine('然后又飘', '到哪里呀', 14_000)]
    const quality = evaluateLyricAnimationQuality(
      lines,
      '[00:01.00]作词：某某\n[00:10.00]无声开在乌云之下 然后\n[00:14.00]又飘到哪里呀',
    )

    expect(quality.textCoverage).toBe(1)
    expect(quality.hasWordAnimation).toBe(true)
  })

  it('rejects word timing that covers only one occurrence of a repeated chorus', () => {
    const chorus = 'Gee gee gee gee baby baby baby'
    const lines = [
      animatedLine('第一段', '主歌内容', 1_000),
      animatedLine('第二段', '主歌内容', 3_000),
      animatedLine('Gee gee gee gee ', 'baby baby baby', 5_000),
      animatedLine('第三段', '主歌内容', 7_000),
    ]
    const quality = evaluateLyricAnimationQuality(
      lines,
      `[00:01.00]第一段主歌内容\n[00:03.00]第二段主歌内容\n[00:05.00]${chorus}\n[00:07.00]第三段主歌内容\n[00:09.00]${chorus}`,
    )

    expect(quality.repeatedSectionCoverage).toBe(0.5)
    expect(quality.hasWordAnimation).toBe(false)
  })
})

describe('enrichLyricAuxiliary', () => {
  it('fills translated and romanized lyrics across a provider-wide timing offset', () => {
    const lines = [
      lyricLine('Uh huh listen boy', 11_200, 13_000),
      lyricLine('너무 너무 멋져', 14_200, 16_000),
      lyricLine('눈이 눈이 부셔', 17_200, 19_000),
    ]
    const source = {
      lyric: '[00:10.00]Uh huh listen boy\n[00:13.00]너무 너무 멋져\n[00:16.00]눈이 눈이 부셔',
      tlyric: '[00:10.00]Uh huh 听着 男孩\n[00:13.00]真的真的好帅\n[00:16.00]耀眼得睁不开眼',
      romalrc: '[00:10.00]Uh huh listen boy\n[00:13.00]neomu neomu meotjyeo\n[00:16.00]nuni nuni busyeo',
    }

    const result = enrichLyricAuxiliary(lines, [source])

    expect(result.lines.map((line) => line.translatedLyric)).toEqual([
      'Uh huh 听着 男孩', '真的真的好帅', '耀眼得睁不开眼',
    ])
    expect(result.lines[1].romanLyric).toBe('neomu neomu meotjyeo')
    expect(result.lines.map((line) => line.startTime)).toEqual([11_200, 14_200, 17_200])
    expect(needsLyricAuxiliary(result.lines)).toBe(false)
  })

  it('keeps AMLL fields and existing auxiliary text intact', () => {
    const words = [lyricWord('Gee ', 5_000, 5_400), lyricWord('Gee', 5_400, 5_900)]
    const main = lyricLine('Gee Gee', 5_000, 5_900, { isDuet: true, words })
    main.translatedLyric = '已有翻译'
    const background = lyricLine('baby baby', 5_100, 5_800, { isBG: true })

    const result = enrichLyricAuxiliary([main, background], [{
      lyric: '[00:05.00]Gee Gee\n[00:05.10]baby baby',
      tlyric: '[00:05.00]新的翻译\n[00:05.10]宝贝 宝贝',
    }])

    expect(result.lines[0]).toMatchObject({ translatedLyric: '已有翻译', isDuet: true, startTime: 5_000 })
    expect(result.lines[0].words).toEqual(words)
    expect(result.lines[0].words).not.toBe(words)
    expect(result.lines[1]).toMatchObject({ translatedLyric: '', isBG: true })
  })

  it('maps repeated lines in order and ignores unrelated sources', () => {
    const lines = [lyricLine('Gee Gee Gee', 10_000, 11_000), lyricLine('Gee Gee Gee', 40_000, 41_000)]
    const result = enrichLyricAuxiliary(lines, [
      { lyric: '[00:10.00]完全无关\n[00:40.00]仍然无关', tlyric: '[00:10.00]错误一\n[00:40.00]错误二' },
      { lyric: '[00:10.00]Gee Gee Gee\n[00:40.00]Gee Gee Gee', tlyric: '[00:10.00]第一次\n[00:40.00]第二次' },
    ])

    expect(result.lines.map((line) => line.translatedLyric)).toEqual(['第一次', '第二次'])
  })

  it('keeps translations from the earlier AMLL presentation when a better word timeline replaces it', () => {
    const earlier = [lyricLine('너무 너무 멋져', 13_000, 15_000), lyricLine('눈이 눈이 부셔', 16_000, 18_000)]
    earlier[0].translatedLyric = '真的真的好帅'
    earlier[1].translatedLyric = '耀眼得睁不开眼'
    const betterWordTimeline = [
      lyricLine('너무 너무 멋져', 14_100, 16_000, {
        words: [lyricWord('너무 ', 14_100, 14_800), lyricWord('너무 멋져', 14_800, 16_000)],
      }),
      lyricLine('눈이 눈이 부셔', 17_100, 19_000, {
        words: [lyricWord('눈이 ', 17_100, 17_800), lyricWord('눈이 부셔', 17_800, 19_000)],
      }),
    ]

    const result = enrichLyricAuxiliary(betterWordTimeline, [{ lines: earlier }])

    expect(result.lines.map((line) => line.translatedLyric)).toEqual(['真的真的好帅', '耀眼得睁不开眼'])
    expect(result.lines[0].words).toEqual(betterWordTimeline[0].words)
  })

  it('does not reuse one auxiliary timestamp for adjacent source lines', () => {
    const lines = [lyricLine('첫째 줄', 10_000, 11_000), lyricLine('둘째 줄', 11_000, 12_000)]
    const result = enrichLyricAuxiliary(lines, [{
      lyric: '[00:10.00]첫째 줄\n[00:11.00]둘째 줄',
      tlyric: '[00:10.50]唯一译文',
    }])

    expect(result.lines.map((line) => line.translatedLyric)).toEqual(['唯一译文', ''])
  })

  it('prefers the auxiliary source whose segmentation best matches the AMLL timeline', () => {
    const lines = [
      lyricLine('첫째 줄', 10_000, 11_000),
      lyricLine('둘째 줄', 12_000, 13_000),
      lyricLine('셋째 줄', 14_000, 15_000),
    ]
    const result = enrichLyricAuxiliary(lines, [
      {
        lyric: '[00:10.00]첫째 줄 둘째 줄\n[00:14.00]셋째 줄',
        tlyric: '[00:10.00]较粗分行一\n[00:14.00]较粗分行二',
      },
      {
        lyric: '[00:10.00]첫째 줄\n[00:12.00]둘째 줄\n[00:14.00]셋째 줄',
        tlyric: '[00:10.00]精确一\n[00:12.00]精确二\n[00:14.00]精确三',
        romalrc: '[00:10.00]cheotjjae\n[00:12.00]duljjae\n[00:14.00]setjjae',
      },
    ])

    expect(result.lines.map((line) => line.translatedLyric)).toEqual(['精确一', '精确二', '精确三'])
    expect(result.lines.map((line) => line.romanLyric)).toEqual(['cheotjjae', 'duljjae', 'setjjae'])
  })
})

describe('enrichLyricStructure', () => {
  it('transfers matched duet and background flags without changing word timing', () => {
    const target = [
      lyricLine('女声主句', 10_100, 12_000, {
        words: [lyricWord('女声', 10_100, 11_000), lyricWord('主句', 11_000, 12_000)],
      }),
      lyricLine('背景和声', 10_500, 12_000),
      lyricLine('男声接唱', 13_100, 15_000),
    ]
    const structure = [
      lyricLine('女声主句', 10_000, 12_000, { isDuet: true }),
      lyricLine('背景和声', 10_400, 12_000, { isBG: true }),
      lyricLine('男声接唱', 13_000, 15_000, { isDuet: true }),
    ]

    const result = enrichLyricStructure(target, structure)

    expect(result.changed).toBe(true)
    expect(result.lines.map((line) => ({ isDuet: line.isDuet, isBG: line.isBG }))).toEqual([
      { isDuet: true, isBG: false },
      { isDuet: false, isBG: true },
      { isDuet: true, isBG: false },
    ])
    expect(result.lines[0].words).toEqual(target[0].words)
    expect(result.lines.map((line) => line.startTime)).toEqual([10_100, 10_500, 13_100])
  })

  it('does not transfer structure from an unrelated timeline', () => {
    const target = [lyricLine('目标歌词一', 10_000, 11_000), lyricLine('目标歌词二', 12_000, 13_000)]
    const unrelated = [lyricLine('其他内容一', 10_000, 11_000, { isDuet: true })]

    expect(enrichLyricStructure(target, unrelated)).toMatchObject({ changed: false })
  })
})
