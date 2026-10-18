import type { Line } from '../types'
import { buildLineRenderHints } from '../upstream/utils/lyrics/renderHints'

/** Match Folia's parser: long gaps get timed interlude dots; lyric timing remains untouched. */
export function attachFoliaInterludes(lines: Line[]): Line[] {
  if (!lines.some((line) => /[\p{L}\p{N}]/u.test(line.fullText))) return []
  const result: Line[] = []
  const interlude = (startTime: number, endTime: number): Line => {
    const wordDuration = (endTime - startTime) / 6
    const words = Array.from({ length: 6 }, (_, index) => ({
      text: '.',
      startTime: startTime + index * wordDuration,
      endTime: startTime + (index + 1) * wordDuration,
    }))
    return {
      id: `folia-interlude-${startTime}`,
      startTime,
      endTime,
      fullText: '......',
      words,
      renderHints: buildLineRenderHints({ startTime, endTime, words }),
    }
  }
  if (lines[0].startTime > 3) result.push(interlude(0.5, lines[0].startTime - 0.5))
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    result.push(line)
    const next = lines[index + 1]
    if (next && next.startTime - line.endTime > 3) result.push(interlude(line.endTime + 0.05, next.startTime - 0.05))
  }
  return result
}
