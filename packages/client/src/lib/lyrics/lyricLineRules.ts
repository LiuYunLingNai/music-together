import type { LyricLine } from '@applemusic-like-lyrics/core'

export type LyricLineRuleShape = 'contains' | 'starts' | 'whole' | 'ends' | 'preset' | 'written'

export interface LyricLineRule {
  id: string
  enabled: boolean
  shape: LyricLineRuleShape
  text: string
}

export const LYRIC_LINE_PRESETS = [
  {
    id: 'copyright',
    label: '版权声明',
    words: [
      '版权所有',
      '未经许可',
      '未经授权',
      '不得翻唱',
      '禁止翻唱',
      '侵权必究',
      'all rights reserved',
      'copyright',
      '©',
      '℗',
    ],
  },
  {
    id: 'lyricSource',
    label: '歌词来源',
    words: ['歌词贡献者', '翻译贡献者', '歌词来源', '歌词来自', '歌词提供', '歌词制作', '歌词校对', 'lrc by'],
  },
] as const

const RULE_SHAPES = new Set<LyricLineRuleShape>(['contains', 'starts', 'whole', 'ends', 'preset', 'written'])
const RULE_ID_PREFIX = 'rule'
let ruleSeed = 0

const fold = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().trim()

export function createLyricLineRule(shape: LyricLineRuleShape = 'contains', text = ''): LyricLineRule {
  ruleSeed += 1
  return {
    id: `${RULE_ID_PREFIX}-${Date.now().toString(36)}-${ruleSeed.toString(36)}`,
    enabled: true,
    shape,
    text,
  }
}

export function isLyricLineRule(value: unknown): value is LyricLineRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as Partial<LyricLineRule>
  return (
    typeof rule.id === 'string' &&
    typeof rule.enabled === 'boolean' &&
    typeof rule.text === 'string' &&
    typeof rule.shape === 'string' &&
    RULE_SHAPES.has(rule.shape as LyricLineRuleShape)
  )
}

function presetWords(rule: LyricLineRule): readonly string[] {
  return LYRIC_LINE_PRESETS.find((preset) => preset.id === rule.text)?.words ?? []
}

/** Compile the listener's rules into one line-level predicate. */
export function compileLyricLineRules(rules: readonly LyricLineRule[]): (text: string) => boolean {
  const compiled = rules
    .filter((rule) => rule.enabled && rule.text.trim())
    .map((rule) => {
      if (rule.shape === 'preset') {
        const words = presetWords(rule).map(fold).filter(Boolean)
        return (text: string) => {
          const folded = fold(text)
          return words.some((word) => folded.includes(word))
        }
      }
      if (rule.shape === 'written') {
        try {
          const regex = new RegExp(rule.text, 'iu')
          return (text: string) => regex.test(text)
        } catch {
          return null
        }
      }
      const needle = fold(rule.text)
      return (text: string) => {
        const folded = fold(text)
        if (rule.shape === 'starts') return folded.startsWith(needle)
        if (rule.shape === 'whole') return folded === needle
        if (rule.shape === 'ends') return folded.endsWith(needle)
        return folded.includes(needle)
      }
    })
    .filter((matcher): matcher is (text: string) => boolean => matcher !== null)

  return (text) => compiled.some((matcher) => matcher(text))
}

export function lyricLineText(line: Pick<LyricLine, 'words'>): string {
  return line.words.map((word) => word.word ?? '').join('')
}

export function filterLyricLines<T extends Pick<LyricLine, 'words'>>(
  lines: readonly T[],
  shouldHide: (text: string) => boolean,
): T[] {
  return lines.filter((line) => !shouldHide(lyricLineText(line)))
}
