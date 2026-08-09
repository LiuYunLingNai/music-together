import type { LyricLine as AmllLyricLine } from '@applemusic-like-lyrics/core'
import type { LyricGroup, LyricLine } from '../domain/types'

function toAmllLine(line: LyricLine, isBackground = false): AmllLyricLine {
  return {
    words: line.words.map((word) => ({
      word: word.text,
      startTime: Math.round(word.startTimeMs),
      endTime: Math.round(word.endTimeMs),
      romanWord: word.romanText,
      ruby: word.ruby?.map((part) => ({
        word: part.text,
        startTime: Math.round(part.startTimeMs),
        endTime: Math.round(part.endTimeMs),
      })),
    })),
    translatedLyric: line.translatedLyric ?? '',
    romanLyric: line.romanLyric ?? '',
    startTime: Math.round(line.startTimeMs),
    endTime: Math.round(line.endTimeMs),
    isBG: isBackground,
    isDuet: Boolean(line.isDuet),
  }
}

/**
 * Convert the already-normalized desktop lyric timeline into AMLL's immutable
 * render model. Main lines must stay directly before their background line.
 */
export function toAmllLines(groups: LyricGroup[]): AmllLyricLine[] {
  return groups.flatMap((group) => [
    toAmllLine(group.main),
    ...(group.background ? [toAmllLine(group.background, true)] : []),
  ])
}
