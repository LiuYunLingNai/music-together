import { describe, expect, it } from 'vitest'
import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import { findFoliaActiveLineIndex, foldFoliaBackgroundVocals, toFoliaLine } from './lyricAdapter'
import type { Line } from '../types'
import { attachFoliaInterludes } from './lyricPresentation'

/**
 * 歌词适配层回归。
 *
 * ★ 最高风险点是**时间单位**：AMLL 用毫秒、folia 用秒。差 1000 倍不会报错，
 *   但会让逐字填充、辉光时长、tilt 脉冲与 cappella 的逐字淡入全部错位
 *   （歌词看起来"完全不动"或"瞬间闪完"）。因此这里逐字段钉住换算。
 */

const amllLine = (over: Partial<AMLLLyricLine> = {}): AMLLLyricLine => ({
  words: [
    { word: 'Hello', startTime: 1_000, endTime: 2_000, romanWord: '', obscene: false },
    { word: ' world', startTime: 2_000, endTime: 3_500, romanWord: '', obscene: false },
  ],
  translatedLyric: '你好',
  romanLyric: '',
  startTime: 1_000,
  endTime: 3_500,
  isBG: false,
  isDuet: false,
  ...over,
})

describe('AMLL → folia 歌词适配', () => {
  it('毫秒必须换算成秒（差 1000 倍不会报错，但动画会整体错位）', () => {
    const line = toFoliaLine(amllLine(), 0)
    expect(line.startTime).toBe(1)
    expect(line.endTime).toBe(3.5)
    expect(line.words.map((w) => w.startTime)).toEqual([1, 2])
    expect(line.words.map((w) => w.endTime)).toEqual([2, 3.5])
  })

  it('word.word 映射到 word.text，并按顺序拼出 fullText', () => {
    const line = toFoliaLine(amllLine(), 0)
    expect(line.words.map((w) => w.text)).toEqual(['Hello', ' world'])
    // fullText 是布局的关键输入（分段对齐 / tilt 切句 / cappella 逐字 reveal）
    expect(line.fullText).toBe('Hello world')
  })

  it('译词与音译分别映射到 translation / romanization，空串归一为 undefined', () => {
    const line = toFoliaLine(amllLine(), 0)
    expect(line.translation).toBe('你好')
    expect(line.romanization).toBeUndefined()
  })

  it('对唱行映射出 agentId，供 cappella 的说话人分支使用', () => {
    expect(toFoliaLine(amllLine({ isDuet: true }), 0).agentId).toBe('duet')
    expect(toFoliaLine(amllLine({ isDuet: false }), 0).agentId).toBe('main')
  })

  it('LRC 回退（单个覆盖整行的 word）也能得到正确的 fullText 与时间', () => {
    const lrcStyle = amllLine({
      words: [{ word: '整行歌词', startTime: 5_000, endTime: 9_000, romanWord: '', obscene: false }],
      startTime: 5_000,
      endTime: 9_000,
    })
    const line = toFoliaLine(lrcStyle, 3)
    expect(line.fullText).toBe('整行歌词')
    expect(line.startTime).toBe(5)
    expect(line.endTime).toBe(9)
    // words.length === 1 是"没有逐词时间"的可靠信号
    expect(line.words).toHaveLength(1)
  })

  it('烘焙 renderHints（避免同一行在每帧被反复重算）', () => {
    const line = toFoliaLine(amllLine(), 0)
    expect(line.renderHints).toBeDefined()
    expect(line.renderHints!.rawDuration).toBeCloseTo(2.5, 5)
    expect(line.renderHints!.renderEndTime).toBeGreaterThanOrEqual(line.endTime)
  })

  it('缺字段不抛错（防御不完整的歌词数据）', () => {
    const broken = { startTime: 0, endTime: 0 } as unknown as AMLLLyricLine
    expect(() => toFoliaLine(broken, 0)).not.toThrow()
    expect(toFoliaLine(broken, 0).fullText).toBe('')
  })
})

describe('激活行判定', () => {
  const line = (startTime: number, endTime: number): Line => ({
    words: [],
    startTime,
    endTime,
    fullText: 'x',
  })
  const lines = [line(0, 2), line(3, 5), line(6, 9)]

  it('落在某行区间内时返回该行', () => {
    expect(findFoliaActiveLineIndex(lines, 0)).toBe(0)
    expect(findFoliaActiveLineIndex(lines, 1.5)).toBe(0)
    expect(findFoliaActiveLineIndex(lines, 3)).toBe(1)
    expect(findFoliaActiveLineIndex(lines, 8.9)).toBe(2)
  })

  it('行之间的间隙（间奏）返回 -1，而不是把上一行一直挂着', () => {
    expect(findFoliaActiveLineIndex(lines, 2.5)).toBe(-1)
    expect(findFoliaActiveLineIndex(lines, 5.5)).toBe(-1)
  })

  it('首行之前与末行时窗之后返回 -1，结束边界包含在时窗内', () => {
    expect(findFoliaActiveLineIndex(lines, -1)).toBe(-1)
    expect(findFoliaActiveLineIndex(lines, 9)).toBe(2)
    expect(findFoliaActiveLineIndex(lines, 9.01)).toBe(-1)
    expect(findFoliaActiveLineIndex(lines, 100)).toBe(-1)
  })

  it('空歌词返回 -1', () => {
    expect(findFoliaActiveLineIndex([], 1)).toBe(-1)
  })
  it('与上游一样保留 renderEndTime 内的余辉，结束边界仍然激活', () => {
    const tail = line(1, 2)
    tail.renderHints = {
      rawDuration: 1,
      renderEndTime: 2.4,
      timingClass: 'normal',
      lineTransitionMode: 'normal',
      wordRevealMode: 'normal',
    }
    expect(findFoliaActiveLineIndex([tail], 2.1)).toBe(0)
    expect(findFoliaActiveLineIndex([tail], 2.4)).toBe(0)
    expect(findFoliaActiveLineIndex([tail], 2.401)).toBe(-1)
    expect(tail.endTime).toBe(2)
  })
  it('下一句开始优先下一句，重叠行结束后回到仍有效的上一行', () => {
    const duet = [line(0, 5), line(1, 2)]
    expect(findFoliaActiveLineIndex(duet, 1)).toBe(1)
    expect(findFoliaActiveLineIndex(duet, 2.1)).toBe(0)
    expect(findFoliaActiveLineIndex(duet, 5.1)).toBe(-1)
  })

  it('二分查找与线性扫描结果一致（含边界）', () => {
    const linear = (t: number) => {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startTime <= t && t <= (lines[i].renderHints?.renderEndTime ?? lines[i].endTime)) return i
      }
      return -1
    }
    for (let t = -1; t <= 10; t += 0.1) {
      const at = Math.round(t * 10) / 10
      expect(findFoliaActiveLineIndex(lines, at), `t=${at}`).toBe(linear(at))
    }
  })
})

describe('Folia 间奏适配', () => {
  it('长句间隙自动插入时间化的间奏行，避免舞台清空', () => {
    const lines = attachFoliaInterludes([
      toFoliaLine(
        amllLine({
          startTime: 1_000,
          endTime: 2_000,
          words: [{ word: '一', startTime: 1_000, endTime: 2_000, romanWord: '', obscene: false }],
        }),
        0,
      ),
      toFoliaLine(
        amllLine({
          startTime: 7_000,
          endTime: 8_000,
          words: [{ word: '二', startTime: 7_000, endTime: 8_000, romanWord: '', obscene: false }],
        }),
        1,
      ),
    ])
    expect(lines.some((line) => line.fullText === '......')).toBe(true)
    expect(findFoliaActiveLineIndex(lines, 4)).toBeGreaterThanOrEqual(0)
  })
  it('短空隙不生成间奏，长前奏生成上游六点时间轴，保留真实行身份', () => {
    const real = toFoliaLine(amllLine({ startTime: 5_000, endTime: 8_000 }), 0)
    const next = toFoliaLine(amllLine({ startTime: 9_000, endTime: 11_000 }), 1)
    const result = attachFoliaInterludes([real, next])
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ fullText: '......', startTime: 0.5, endTime: 4.5 })
    expect(result[0].words).toHaveLength(6)
    expect(result[0].words.map((word) => word.text).join('')).toBe('......')
    expect(result[1]).toBe(real)
    expect(result[2]).toBe(next)
  })
  it('整首没有真实歌词时不制造文字占位', () => {
    expect(attachFoliaInterludes([])).toEqual([])
    expect(attachFoliaInterludes([{ words: [], startTime: 0, endTime: 30, fullText: '......' }])).toEqual([])
  })
})

describe('isBG 背景唱词折叠（和声叠层的数据源）', () => {
  const bgLine = (over: Partial<AMLLLyricLine> = {}): AMLLLyricLine =>
    amllLine({ isBG: true, translatedLyric: '和声', ...over })

  it('isBG 行折叠为前一个主行的 backgroundVocal，主时间轴不再包含它', () => {
    const main = toFoliaLine(amllLine({ startTime: 1_000, endTime: 3_500 }), 0)
    const bg = toFoliaLine(bgLine({ startTime: 1_500, endTime: 3_000 }), 1)
    const result = foldFoliaBackgroundVocals([main, bg])
    expect(result).toHaveLength(1)
    expect(result[0].backgroundVocal).toMatchObject({ text: 'Hello world', startTime: 1.5, translation: '和声' })
    expect(result[0].backgroundVocals).toHaveLength(1)
  })

  it('连续多个 isBG 行按 AMLL 规则折叠：只保留第一个，其余降级为普通行', () => {
    const main = toFoliaLine(amllLine(), 0)
    const bg1 = toFoliaLine(bgLine({ startTime: 1_500, endTime: 2_000 }), 1)
    const bg2 = toFoliaLine(bgLine({ startTime: 2_000, endTime: 2_500 }), 2)
    const result = foldFoliaBackgroundVocals([main, bg1, bg2])
    // bg1 折叠进主行；bg2 降级为普通行保留在时间轴上（不丢内容）。
    expect(result).toHaveLength(2)
    expect(result[0].backgroundVocals).toHaveLength(1)
    expect(result[1].agentId).toBe('bg')
    expect(result[1].backgroundVocal).toBeUndefined()
  })

  it('曲目以背景行开头（无主行可归属）时保留为普通行', () => {
    const bg = toFoliaLine(bgLine(), 0)
    const result = foldFoliaBackgroundVocals([bg])
    expect(result).toHaveLength(1)
    expect(result[0].backgroundVocal).toBeUndefined()
  })

  it('间奏行不参与归属：背景行总是归到最近的真实主行', () => {
    const interlude: Line = {
      id: 'folia-interlude-4',
      startTime: 4,
      endTime: 6,
      fullText: '......',
      words: [],
    }
    const main = toFoliaLine(amllLine(), 0)
    const bg = toFoliaLine(bgLine(), 1)
    const result = foldFoliaBackgroundVocals([main, interlude, bg])
    expect(result[0].backgroundVocal).toBeDefined()
    expect(result[1].backgroundVocal).toBeUndefined()
  })
})
