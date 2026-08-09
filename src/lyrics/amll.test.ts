import { describe, expect, it } from 'vitest'
import type { LyricGroup } from '../domain/types'
import { toAmllLines } from './amll'

describe('AMLL renderer adapter', () => {
  it('preserves timing, metadata, ruby and background ordering', () => {
    const groups: LyricGroup[] = [{
      main: {
        words: [{
          text: '空',
          startTimeMs: 1_000.4,
          endTimeMs: 1_800.6,
          romanText: 'sora',
          ruby: [{ text: 'そら', startTimeMs: 1_000, endTimeMs: 1_801 }],
        }],
        translatedLyric: 'sky',
        romanLyric: 'sora',
        startTimeMs: 1_000,
        endTimeMs: 1_801,
        isDuet: true,
      },
      background: {
        words: [{ text: 'ah', startTimeMs: 1_100, endTimeMs: 1_700 }],
        startTimeMs: 1_100,
        endTimeMs: 1_700,
        isBackground: true,
      },
      startTimeMs: 1_000,
      endTimeMs: 1_801,
    }]

    const lines = toAmllLines(groups)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      translatedLyric: 'sky',
      romanLyric: 'sora',
      startTime: 1_000,
      endTime: 1_801,
      isBG: false,
      isDuet: true,
    })
    expect(lines[0].words[0]).toMatchObject({
      word: '空',
      startTime: 1_000,
      endTime: 1_801,
      romanWord: 'sora',
      ruby: [{ word: 'そら', startTime: 1_000, endTime: 1_801 }],
    })
    expect(lines[1]).toMatchObject({ isBG: true, isDuet: false })
  })
})
