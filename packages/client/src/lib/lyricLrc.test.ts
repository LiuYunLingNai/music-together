import { describe, expect, it } from 'vitest'
import { buildAMLLLinesFromLrc, mergeLyrics, parseLRC } from './lyricLrc'

describe('parseLRC', () => {
  it('parses the four supported timestamp precisions', () => {
    const lines = parseLRC('[00:01]甲\n[00:02.5]乙\n[00:03.25]丙\n[00:04.125]丁')

    expect(lines.map((line) => line.time)).toEqual([1, 2.5, 3.25, 4.125])
    expect(lines.map((line) => line.text)).toEqual(['甲', '乙', '丙', '丁'])
  })

  it('expands a line carrying several timestamps into one line each', () => {
    // QQ 音乐经 Meting 返回的重复副歌常用这种写法。只取第一个会丢掉第二个
    // 时刻，并把 `[01:30.00]` 留在正文里显示出来。
    const lines = parseLRC('[00:12.00][01:30.00]副歌\n[01:40.00]尾声')

    expect(lines).toEqual([
      { time: 12, text: '副歌', isBG: false },
      { time: 90, text: '副歌', isBG: false },
      { time: 100, text: '尾声', isBG: false },
    ])
  })

  it('drops timestamps that appear inside the text', () => {
    expect(parseLRC('[00:12.00]前半[00:14.00]后半')[0].text).toBe('前半后半')
  })

  it('keeps source order for lines that share a timestamp', () => {
    const lines = parseLRC('[00:10.00]先\n[00:10.00]后')

    expect(lines.map((line) => line.text)).toEqual(['先', '后'])
  })

  it('ignores lines without a timestamp or without text', () => {
    expect(parseLRC('[ti:Song]\n[00:01.00]\n[00:02.00]有词')).toEqual([{ time: 2, text: '有词', isBG: false }])
  })

  it('marks a fully parenthesized line as background vocal and strips the brackets', () => {
    expect(parseLRC('[00:12.00]（和声）\n[00:14.00](ooh)')).toEqual([
      { time: 12, text: '和声', isBG: true },
      { time: 14, text: 'ooh', isBG: true },
    ])
  })

  it('keeps a line as foreground when only part of it is parenthesized', () => {
    const [line] = parseLRC('[00:12.00]我听见（远方）有人在唱')

    expect(line).toMatchObject({ text: '我听见（远方）有人在唱', isBG: false })
  })

  it('carries the background flag into the AMLL lines', () => {
    const lines = buildAMLLLinesFromLrc('[00:10.00]主句\n[00:12.00]（和声）', '')

    expect(lines.map((line) => line.isBG)).toEqual([false, true])
    expect(lines[1].words[0]?.word).toBe('和声')
  })
})

describe('mergeLyrics', () => {
  it('pairs translations onto every occurrence of a repeated line', () => {
    const merged = mergeLyrics('[00:12.00][01:30.00]副歌\n[01:40.00]尾声', '[00:12.00][01:30.00]chorus\n[01:40.00]outro')

    expect(merged.map((line) => line.translation)).toEqual(['chorus', 'chorus', 'outro'])
  })
})

describe('buildAMLLLinesFromLrc', () => {
  it('gives each repeated occurrence its own line and a bounded end time', () => {
    const lines = buildAMLLLinesFromLrc('[00:12.00][01:30.00]副歌\n[01:40.00]尾声', '')

    expect(lines.map((line) => line.startTime)).toEqual([12_000, 90_000, 100_000])
    // 中间那行不再被拉长到 100s 之后。
    expect(lines[1].endTime).toBe(100_000)
    expect(lines.map((line) => line.words[0]?.word)).toEqual(['副歌', '副歌', '尾声'])
  })
})

describe('parseLRC compatibility', () => {
  it('still finds a timestamp that is not at the start of the line', () => {
    expect(parseLRC('作词：[00:12.00]某某')).toEqual([{ time: 12, text: '某某', isBG: false }])
  })
})
