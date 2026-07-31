import { describe, expect, it } from 'vitest'
import type { LyricLine, LyricWord } from '../domain/types'
import { buildInterludes, findActiveGroup, prepareLyricGroups, wordProgress } from './engine'

const word = (text: string, startTimeMs: number, endTimeMs: number): LyricWord => ({ text, startTimeMs, endTimeMs })
const line = (words: LyricWord[], startTimeMs: number, endTimeMs: number, extra: Partial<LyricLine> = {}): LyricLine => ({ words, startTimeMs, endTimeMs, ...extra })

describe('AMLL timeline engine', () => {
  it('pairs a following background voice and synchronizes group bounds', () => {
    const groups = prepareLyricGroups([
      line([word('main', 2_000, 3_000)], 2_000, 3_000),
      line([word('echo', 1_800, 3_200)], 1_800, 3_200, { isBackground: true }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].background?.words[0].text).toBe('echo')
    expect(groups[0].main.endTimeMs).toBe(3_200)
    expect(groups[0].startTimeMs).toBe(1_200)
  })

  it('advances focus without crossing the prior group boundary', () => {
    const groups = prepareLyricGroups([
      line([word('one', 1_000, 2_000)], 1_000, 2_000),
      line([word('two', 7_000, 8_000)], 7_000, 8_000),
    ])
    expect(groups[0].startTimeMs).toBe(400)
    expect(groups[1].startTimeMs).toBe(6_400)
    expect(findActiveGroup(groups, 6_500)).toBe(1)
  })

  it('uses ruby timing to weight parent word progress', () => {
    const rubyWord: LyricWord = {
      text: '空',
      startTimeMs: 1_000,
      endTimeMs: 3_000,
      ruby: [
        { text: 'そ', startTimeMs: 1_000, endTimeMs: 1_500 },
        { text: 'ら', startTimeMs: 2_000, endTimeMs: 3_000 },
      ],
    }
    expect(wordProgress(rubyWord, 1_250)).toBeCloseTo(0.25)
    expect(wordProgress(rubyWord, 1_750)).toBeCloseTo(0.5)
    expect(wordProgress(rubyWord, 2_500)).toBeCloseTo(0.75)
  })

  it('creates stable interlude slots for gaps of four seconds', () => {
    const groups = prepareLyricGroups([
      line([word('one', 1_000, 2_000)], 1_000, 2_000),
      line([word('two', 7_000, 8_000)], 7_000, 8_000),
    ])
    const interludes = buildInterludes(groups)
    expect(interludes).toHaveLength(1)
    expect(interludes[0]).toMatchObject({ anchorGroupIndex: 0, startTimeMs: 2_000, endTimeMs: 6_150 })
  })
})
