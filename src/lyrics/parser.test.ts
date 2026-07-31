import { describe, expect, it } from 'vitest'
import { parseLrc, parseTime, parseTtml, parseYrc } from './parser'

describe('lyrics parser', () => {
  it('parses TTML clock and unit timestamps', () => {
    expect(parseTime('01:02.500')).toBe(62_500)
    expect(parseTime('1:02:03.25')).toBe(3_723_250)
    expect(parseTime('1750ms')).toBe(1_750)
    expect(parseTime('1.5s')).toBe(1_500)
  })

  it('merges LRC translation using Android tolerance', () => {
    const lines = parseLrc('[00:01.00]First\n[00:04.000]Second', '[00:01.25]第一句')
    expect(lines).toHaveLength(2)
    expect(lines[0].startTimeMs).toBe(1_000)
    expect(lines[0].endTimeMs).toBe(4_000)
    expect(lines[0].translatedLyric).toBe('第一句')
  })

  it('normalizes relative YRC word timestamps', () => {
    const lines = parseYrc('[10000,2000](0,800,0)Hello (800,1200,0)world')
    expect(lines[0].words[0]).toMatchObject({ text: 'Hello ', startTimeMs: 10_000, endTimeMs: 10_800 })
    expect(lines[0].words[1].startTimeMs).toBe(10_800)
  })

  it('preserves TTML translation, background voice and ruby timing', () => {
    const lines = parseTtml(`<?xml version="1.0"?>
      <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
        <body><div>
          <p begin="1s" end="4s" ttm:agent="v1">
            <span begin="1s" end="2s">空<span ttm:role="x-ruby"><span begin="1s" end="1.5s">そ</span><span begin="1.5s" end="2s">ら</span></span></span>
            <span ttm:role="x-translation">Sky</span>
            <span ttm:role="x-bg" begin="2s" end="3s">(<span begin="2s" end="3s">echo</span>)</span>
          </p>
        </div></body>
      </tt>`)
    expect(lines).toHaveLength(2)
    expect(lines[0].words[0].text).toBe('空')
    expect(lines[0].words[0].ruby?.map((part) => part.text)).toEqual(['そ', 'ら'])
    expect(lines[0].translatedLyric).toBe('Sky')
    expect(lines[1].isBackground).toBe(true)
    expect(lines[1].words.map((word) => word.text).join('')).toBe('echo')
  })
})
