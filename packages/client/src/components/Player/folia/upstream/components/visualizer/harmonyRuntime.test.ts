import { describe, expect, it } from 'vitest'
import type { LyricBackgroundVocal } from '../../../types'
import {
  getLineBackgroundVocals,
  getLyricsBackgroundVocals,
  resolveHarmonyAlternateText,
  resolveHarmonySnapshotFromVocals,
} from './harmonyRuntime'

/**
 * 和声叠层运行时回归（移植自上游 harmonyRuntime.ts 的纯函数语义）。
 *
 * ★ 关键语义：快照按"当前时间落在 vocal 区间内"筛选活跃和声；token 状态
 *   （waiting/active/passed/static）驱动顶部逐字点亮；signature 是渲染去重
 *   的唯一依据 —— 状态没变就绝不能产生新对象。
 */

const vocal = (over: Partial<LyricBackgroundVocal>): LyricBackgroundVocal => ({
  text: 'ah ah',
  startTime: 1,
  endTime: 3,
  words: [
    { text: 'ah', startTime: 1, endTime: 2 },
    { text: ' ah', startTime: 2, endTime: 3 },
  ],
  ...over,
})

describe('harmonyRuntime', () => {
  it('只保留当前时间落在区间内的和声行', () => {
    const a = vocal({ startTime: 1, endTime: 3 })
    const b = vocal({ startTime: 5, endTime: 7 })
    const snapshot = resolveHarmonySnapshotFromVocals([a, b], 2)
    expect(snapshot.lines).toHaveLength(1)
    expect(snapshot.lines[0].vocal).toBe(a)
  })

  it('token 状态按词时间推进：waiting → active → passed', () => {
    const v = vocal({ startTime: 1, endTime: 3 })
    const statuses = (time: number) =>
      resolveHarmonySnapshotFromVocals([v], time).lines[0].tokens
        .filter((token) => token.status !== 'static')
        .map((token) => token.status)

    expect(statuses(1.2)).toEqual(['active', 'waiting'])
    expect(statuses(2.5)).toEqual(['passed', 'active'])
  })

  it('时间在全部区间之外时快照为空', () => {
    const v = vocal({ startTime: 1, endTime: 3 })
    expect(resolveHarmonySnapshotFromVocals([v], 0.5).lines).toEqual([])
    expect(resolveHarmonySnapshotFromVocals([v], 3.5).lines).toEqual([])
  })

  it('signature 只在行集合或 token 状态变化时改变', () => {
    const v = vocal({ startTime: 1, endTime: 3 })
    const before = resolveHarmonySnapshotFromVocals([v], 1.2)
    const during = resolveHarmonySnapshotFromVocals([v], 1.3)
    const after = resolveHarmonySnapshotFromVocals([v], 2.2)

    // 同一 token 状态（1.2 与 1.3 都在第一个词的 active 窗口）→ 签名一致。
    expect(during.signature).toBe(before.signature)
    // 第二个词点亮 → 签名变化。
    expect(after.signature).not.toBe(before.signature)
  })

  it('无词和声整行显示为 active', () => {
    const v = vocal({ words: [] })
    const snapshot = resolveHarmonySnapshotFromVocals([v], 2)
    expect(snapshot.lines[0].tokens).toEqual([{ key: 'full', text: 'ah ah', status: 'active' }])
  })

  it('getLyricsBackgroundVocals 展开全部行并按时间排序', () => {
    const later = vocal({ startTime: 5, endTime: 7 })
    const earlier = vocal({ startTime: 1, endTime: 3 })
    const lines = [
      { startTime: 5, endTime: 7, fullText: '', words: [], backgroundVocals: [later] },
      { startTime: 1, endTime: 3, fullText: '', words: [], backgroundVocal: earlier },
    ]
    expect(getLyricsBackgroundVocals(lines as never).map((entry) => entry.startTime)).toEqual([1, 5])
    expect(getLineBackgroundVocals(null)).toEqual([])
  })

  it('和声副标题文本按 subtitleContentMode 解析（both 折叠为 translation）', () => {
    const v = vocal({ translation: '和声', romanization: 'he sheng' })
    expect(resolveHarmonyAlternateText(v, 'translation')).toBe('和声')
    expect(resolveHarmonyAlternateText(v, 'both')).toBe('和声')
    expect(resolveHarmonyAlternateText(v, 'romanization')).toBe('he sheng')
    expect(resolveHarmonyAlternateText(v, 'none')).toBeNull()
  })
})
