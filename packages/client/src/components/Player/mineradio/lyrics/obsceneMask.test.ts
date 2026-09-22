import { describe, expect, it } from 'vitest'
import { DEFAULT_MASK_CHAR, maskObsceneLine, maskObsceneWord } from './obsceneMask'

/**
 * 回归：`partial-mask` 必须与 `full-mask` **行为不同**。
 *
 * 真实缺陷：WebGL 舞台把三态设置折叠成布尔
 * （`maskMode ? maskObsceneChar || '*' : ''`），于是 `partial-mask`
 * 与 `full-mask` 表现完全相同 —— 用户在视觉舞台选"首尾保留"毫无效果，
 * 切到 AMLL 渲染器却生效（AMLL 透传真实模式）。
 *
 * AMLL 的语义（`@applemusic-like-lyrics/core` 的 `MaskObsceneWordsMode`）：
 *   FullMask    = "完全掩码所有不雅用语"
 *   PartialMask = "保留首尾字符，屏蔽中间字符"
 */
describe('敏感词掩码', () => {
  it('partial-mask 保留首尾、只屏蔽中间', () => {
    expect(maskObsceneWord('fuck', 'partial-mask', '*')).toBe('f**k')
    expect(maskObsceneWord('damn', 'partial-mask', '*')).toBe('d**n')
    // 首尾字符必须原样保留
    expect(maskObsceneWord('shit', 'partial-mask', '*')[0]).toBe('s')
    expect(maskObsceneWord('shit', 'partial-mask', '*').slice(-1)).toBe('t')
  })

  it('full-mask 全部屏蔽（与 partial 必须不同）', () => {
    expect(maskObsceneWord('fuck', 'full-mask', '*')).toBe('****')
    // ★ 这正是曾经的缺陷点：两者结果必须不同
    expect(maskObsceneWord('fuck', 'full-mask', '*')).not.toBe(maskObsceneWord('fuck', 'partial-mask', '*'))
  })

  it('掩码后字符数不变（逐字区间按索引对齐，长度一变整行错位）', () => {
    for (const mode of ['full-mask', 'partial-mask'] as const) {
      for (const word of ['a', 'ab', 'abc', 'fuck', '日本語', 'ａｂｃ']) {
        expect(Array.from(maskObsceneWord(word, mode, '*')).length, `${mode} / ${word}`).toBe(Array.from(word).length)
      }
    }
  })

  it('长度 ≤2 的词在 partial 下退化为全掩码（不存在"中间"）', () => {
    expect(maskObsceneWord('a', 'partial-mask', '*')).toBe('*')
    expect(maskObsceneWord('ab', 'partial-mask', '*')).toBe('**')
    // 3 字符起才真正"保留首尾"
    expect(maskObsceneWord('abc', 'partial-mask', '*')).toBe('a*c')
  })

  it('自定义掩码字符生效；空字符回退到 *', () => {
    expect(maskObsceneWord('fuck', 'full-mask', '#')).toBe('####')
    expect(maskObsceneWord('fuck', 'full-mask', '')).toBe('****')
    expect(maskObsceneWord('fuck', 'full-mask')).toBe('****')
    expect(DEFAULT_MASK_CHAR).toBe('*')
  })

  it('只替换被标记为 obscene 的词，其余原样保留', () => {
    const line = {
      words: [
        { text: 'oh ', obscene: false },
        { text: 'fuck', obscene: true },
        { text: ' yeah', obscene: false },
      ],
    }
    expect(maskObsceneLine(line, 'full-mask', '*')).toBe('oh **** yeah')
    expect(maskObsceneLine(line, 'partial-mask', '*')).toBe('oh f**k yeah')
  })

  it('整行掩码后长度与原文一致（区间不错位）', () => {
    const line = {
      words: [
        { text: 'oh ', obscene: false },
        { text: 'fuck', obscene: true },
      ],
    }
    const raw = line.words.map((w) => w.text).join('')
    for (const mode of ['full-mask', 'partial-mask'] as const) {
      expect(Array.from(maskObsceneLine(line, mode, '*')).length).toBe(Array.from(raw).length)
    }
  })
})
