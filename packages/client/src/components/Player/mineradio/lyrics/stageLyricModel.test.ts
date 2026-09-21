import { describe, expect, it } from 'vitest'
import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import {
  buildStageLines,
  computeLineProgress,
  findActiveLineIndex,
  foldConsecutiveBackgroundLines,
  hasWordTiming,
  type StageLine,
} from './stageLyricModel'

/** 构造一行逐字歌词：words 为 [文字, 起始ms, 结束ms] */
function line(
  words: Array<[string, number, number]>,
  extra: Partial<AMLLLyricLine> = {},
): AMLLLyricLine {
  return {
    words: words.map(([word, startTime, endTime]) => ({
      word,
      startTime,
      endTime,
      romanWord: '',
      obscene: false,
    })),
    translatedLyric: '',
    romanLyric: '',
    startTime: words[0]?.[1] ?? 0,
    endTime: words[words.length - 1]?.[2] ?? 0,
    isBG: false,
    isDuet: false,
    ...extra,
  }
}

describe('foldConsecutiveBackgroundLines', () => {
  it('保留孤立的背景行', () => {
    const lines = [line([['a', 0, 1000]]), line([['b', 1000, 2000]], { isBG: true })]
    expect(foldConsecutiveBackgroundLines(lines)).toEqual([false, true])
  })

  it('连续多个背景行只保留第一个', () => {
    const lines = [
      line([['a', 0, 1000]]),
      line([['b', 1000, 1500]], { isBG: true }),
      line([['c', 1500, 2000]], { isBG: true }),
      line([['d', 2000, 2500]], { isBG: true }),
    ]
    expect(foldConsecutiveBackgroundLines(lines)).toEqual([false, true, false, false])
  })

  it('主行会重置连续计数', () => {
    const lines = [
      line([['a', 0, 100]]),
      line([['b', 100, 200]], { isBG: true }),
      line([['c', 200, 300]]),
      line([['d', 300, 400]], { isBG: true }),
    ]
    expect(foldConsecutiveBackgroundLines(lines)).toEqual([false, true, false, true])
  })
})

describe('buildStageLines', () => {
  it('为每个字累加字符区间', () => {
    const lines = buildStageLines([line([['你好', 0, 500], ['世界', 500, 1000]])])
    expect(lines).toHaveLength(1)

    const [first, second] = lines[0].words
    expect(first.charStart).toBe(0)
    expect(first.charEnd).toBe(2)
    expect(second.charStart).toBe(2)
    expect(second.charEnd).toBe(4)
    expect(lines[0].charCount).toBe(4)
  })

  it('字符区间能正确覆盖整行（含空格与标点）', () => {
    const lines = buildStageLines([line([['Hel', 0, 300], ['lo ', 300, 600], ['world', 600, 900]])])
    const words = lines[0].words
    expect(words[words.length - 1].charEnd).toBe(lines[0].charCount)
    expect(lines[0].charCount).toBe('Hello world'.length)
  })

  it('把背景行挂到前一个主行并移出主列表', () => {
    const lines = buildStageLines([
      line([['主行一', 0, 1000]]),
      line([['背景', 1000, 2000]], { isBG: true }),
      line([['主行二', 2000, 3000]]),
    ])

    // 主行一 + 其背景行 + 主行二
    expect(lines).toHaveLength(3)
    expect(lines[0].role).toBe('main')
    expect(lines[0].backgroundIndex).toBe(1)
    expect(lines[1].role).toBe('background')
    expect(lines[1].text).toBe('背景')
    expect(lines[2].role).toBe('main')
    expect(lines[2].backgroundIndex).toBe(-1)
  })

  it('连续背景行：第二个背景行按 AMLL 规则降级为主行', () => {
    const lines = buildStageLines([
      line([['主行', 0, 1000]]),
      line([['背景A', 1000, 1500]], { isBG: true }),
      line([['背景B', 1500, 2000]], { isBG: true }),
    ])

    const mains = lines.filter((l) => l.role === 'main')
    const backgrounds = lines.filter((l) => l.role === 'background')

    // 折叠规则只保留连续背景行中的第一个；第二个被降级为主行，
    // 因此它会作为独立主行进入渲染栈（与 AMLL optimizeLyricLines 行为一致）。
    expect(mains).toHaveLength(2)
    expect(backgrounds).toHaveLength(1)
    expect(backgrounds[0].text).toBe('背景A')
    expect(mains[0].backgroundIndex).toBe(1)
    expect(mains[1].text).toBe('背景B')
  })

  it('开头就是背景行时不会崩溃', () => {
    const lines = buildStageLines([line([['孤儿背景', 0, 1000]], { isBG: true })])
    // 没有前置主行可挂载，应安全丢弃而不是报错
    expect(lines.every((l) => l.role === 'main' || l.backgroundIndex === -1)).toBe(true)
  })

  it('保留对唱标记与译词音译', () => {
    const lines = buildStageLines([
      line([['对唱', 0, 1000]], { isDuet: true, translatedLyric: 'duet', romanLyric: 'duichang' }),
    ])
    expect(lines[0].isDuet).toBe(true)
    expect(lines[0].translation).toBe('duet')
    expect(lines[0].roman).toBe('duichang')
  })

  it('空输入返回空数组', () => {
    expect(buildStageLines(null)).toEqual([])
    expect(buildStageLines([])).toEqual([])
  })

  it('记录原始行索引用于点击跳转', () => {
    const lines = buildStageLines([
      line([['A', 0, 1000]]),
      line([['B', 1000, 2000]], { isBG: true }),
      line([['C', 2000, 3000]]),
    ])
    expect(lines[0].index).toBe(0)
    expect(lines[1].index).toBe(1)
    expect(lines[2].index).toBe(2)
  })
})

describe('computeLineProgress', () => {
  const stageLine = (): StageLine => buildStageLines([line([['ab', 1000, 2000], ['cd', 2000, 3000]])])[0]

  it('行开始前为 0', () => {
    expect(computeLineProgress(stageLine(), 0.5, 4)).toBe(0)
  })

  it('第一个字播完时进度到达该字区间终点', () => {
    // 第一字占字符 0..2，总字符 4 → 区间终点 0.5
    expect(computeLineProgress(stageLine(), 2.0, 4)).toBeCloseTo(0.5, 5)
  })

  it('整行播完为 1', () => {
    expect(computeLineProgress(stageLine(), 5, 6)).toBe(1)
  })

  it('逐字中间按字符区间插值', () => {
    // 第一字内部 50% → 0.25
    expect(computeLineProgress(stageLine(), 1.5, 4)).toBeCloseTo(0.25, 5)
  })

  it('进度单调不减', () => {
    const l = stageLine()
    let prev = -1
    for (let t = 0.9; t <= 3.2; t += 0.1) {
      const p = computeLineProgress(l, t, 4)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })

  it('无逐字数据时回退为整行平滑推进', () => {
    const single = buildStageLines([line([['整行歌词', 0, 4000]])])[0]
    expect(hasWordTiming(single.words)).toBe(false)

    const p = computeLineProgress(single, 2, 4)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1)
    // smoothstep 在中点为 0.5
    expect(p).toBeCloseTo(0.5, 2)
  })

  it('多个字但共享同一时间区间时视为无逐字', () => {
    // 某些 LRC 回退会把整行拆成多个字却给相同时间
    const degraded = buildStageLines([
      line([
        ['整', 0, 4000],
        ['行', 0, 4000],
      ]),
    ])[0]
    expect(hasWordTiming(degraded.words)).toBe(false)
  })
})

describe('hasWordTiming', () => {
  const stage = (words: Array<[string, number, number]>) => buildStageLines([line(words)])[0]

  it('单个字永不视为逐字', () => {
    expect(hasWordTiming(stage([['孤', 0, 4000]]).words)).toBe(false)
  })

  it('空数组为 false', () => {
    expect(hasWordTiming([])).toBe(false)
  })

  it('多个字各有独立区间时为 true', () => {
    expect(hasWordTiming(stage([['a', 0, 500], ['b', 500, 1000]]).words)).toBe(true)
  })

  it('多字但时间完全相同为 false', () => {
    expect(hasWordTiming(stage([['a', 0, 1000], ['b', 0, 1000]]).words)).toBe(false)
  })
})

describe('findActiveLineIndex', () => {
  const lines = buildStageLines([
    line([['一', 0, 1000]]),
    line([['二', 1000, 2000]]),
    line([['三', 2000, 3000]]),
  ])

  it('未开始时返回 -1', () => {
    expect(findActiveLineIndex(lines, -1)).toBe(-1)
  })

  it('定位当前行', () => {
    expect(findActiveLineIndex(lines, 1.5)).toBe(1)
    expect(findActiveLineIndex(lines, 2.5)).toBe(2)
  })

  it('超过最后一行时停在最后一行', () => {
    expect(findActiveLineIndex(lines, 99)).toBe(2)
  })

  it('跳过背景行只比较主行', () => {
    const withBg = buildStageLines([
      line([['一', 0, 1000]]),
      line([['背景', 1000, 2000]], { isBG: true }),
      line([['二', 2000, 3000]]),
    ])
    // 1.5s 时应仍激活第一个主行（下标 0），而不是背景行
    expect(findActiveLineIndex(withBg, 1.5)).toBe(0)
  })
})
