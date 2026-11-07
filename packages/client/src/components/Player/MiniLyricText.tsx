import { parseLRC } from '@/lib/lyricLrc'
import { lyricLineText } from '@/lib/lyrics/lyricLineRules'
import { useLyricLineFilter } from '@/hooks/useLyricLineFilter'
import { usePlayerStore } from '@/stores/playerStore'
import { useMemo } from 'react'

interface TimedLine {
  startTime: number
  endTime: number
  text: string
  translation?: string
}

function parseLrc(value: string): TimedLine[] {
  const lines = parseLRC(value).map((line) => ({
    startTime: line.time * 1_000,
    endTime: line.time * 1_000 + 5_000,
    text: line.text,
  }))
  return lines.map((line, index) => ({ ...line, endTime: lines[index + 1]?.startTime ?? line.endTime }))
}

function findTimedLine(lines: TimedLine[], timeMs: number): TimedLine | undefined {
  let low = 0
  let high = lines.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const line = lines[middle]!
    if (timeMs < line.startTime) high = middle - 1
    else if (timeMs >= line.endTime) low = middle + 1
    else return line
  }
  return undefined
}

function findNearestLine(lines: TimedLine[], timeMs: number, toleranceMs: number): TimedLine | undefined {
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (lines[middle]!.startTime < timeMs) low = middle + 1
    else high = middle
  }
  const after = lines[low]
  const before = lines[low - 1]
  const nearest = !before || (after && after.startTime - timeMs < timeMs - before.startTime) ? after : before
  return nearest && Math.abs(nearest.startTime - timeMs) < toleranceMs ? nearest : undefined
}

export function MiniLyricText() {
  const lyric = usePlayerStore((state) => state.lyric)
  const tlyric = usePlayerStore((state) => state.tlyric)
  const ttmlLines = usePlayerStore((state) => state.ttmlLines)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const lyricLoading = usePlayerStore((state) => state.lyricLoading)
  const shouldHideLine = useLyricLineFilter()
  const visibleTtmlLines = useMemo(
    () => (ttmlLines ? ttmlLines.filter((line) => !shouldHideLine(lyricLineText(line))) : null),
    [ttmlLines, shouldHideLine],
  )
  const lrcLines = useMemo(() => parseLrc(lyric).filter((line) => !shouldHideLine(line.text)), [lyric, shouldHideLine])
  const translatedLines = useMemo(
    () => parseLrc(tlyric).filter((line) => !shouldHideLine(line.text)),
    [tlyric, shouldHideLine],
  )

  const currentLine = useMemo(() => {
    const timeMs = currentTime * 1000
    if (ttmlLines?.length) {
      const lines = visibleTtmlLines ?? []
      let low = 0
      let high = lines.length - 1
      let line: (typeof ttmlLines)[number] | undefined
      while (low <= high) {
        const middle = (low + high) >> 1
        const candidate = lines[middle]!
        if (timeMs < candidate.startTime) high = middle - 1
        else if (timeMs >= candidate.endTime) low = middle + 1
        else {
          line = candidate
          break
        }
      }
      if (line) {
        return {
          text: lyricLineText(line),
          translation: line.translatedLyric || undefined,
        }
      }
      return null
    }

    const line = findTimedLine(lrcLines, timeMs)
    if (!line) return null
    const translation = findNearestLine(translatedLines, line.startTime, 120)?.text
    return { text: line.text, translation }
  }, [currentTime, lrcLines, translatedLines, ttmlLines, visibleTtmlLines])

  return (
    <div className="min-w-0 flex-1 px-2 text-center sm:px-4">
      <p className="truncate text-sm text-white/80">
        {lyricLoading ? '歌词加载中...' : (currentLine?.text ?? '暂无歌词')}
      </p>
      {currentLine?.translation && <p className="truncate text-xs text-white/40">{currentLine.translation}</p>}
    </div>
  )
}
