import { detectChorusLines } from '@/lib/chorusDetector'
import type { Line } from '../types'

type ChorusEffect = NonNullable<Line['chorusEffect']>

const CHORUS_EFFECTS: ChorusEffect[] = ['bars', 'circles', 'beams']

/**
 * Decorate Folia lines with the chorus fields its visual modes already read.
 * TTML supplies `songPart`; for other formats Folia detects the most repeated
 * lyric text. A line's effect stays stable for as long as the line set does.
 */
export function applyChorusEffects(lines: Line[], lrc: string): Line[] {
  const detected = detectChorusLines(lrc)
  const effectByText = new Map<string, ChorusEffect>()
  const effectFor = (text: string): ChorusEffect => {
    const existing = effectByText.get(text)
    if (existing) return existing
    const effect = CHORUS_EFFECTS[Math.floor(Math.random() * CHORUS_EFFECTS.length)]
    effectByText.set(text, effect)
    return effect
  }

  let changed = false
  const decorated = lines.map((line) => {
    const isChorus = line.isChorus || detected.has(line.fullText.trim())
    if (!isChorus) return line
    if (line.isChorus && line.chorusEffect) return line
    changed = true
    return { ...line, isChorus: true, chorusEffect: line.chorusEffect ?? effectFor(line.fullText.trim()) }
  })
  return changed ? decorated : lines
}
