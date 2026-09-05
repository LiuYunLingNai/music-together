import { usePlayerStore } from '@/stores/playerStore'
import { useMemo } from 'react'

interface TimedLine {
  startTime: number
  endTime: number
  text: string
  translation?: string
}

function parseLrc(value: string): TimedLine[] {
  const lines: TimedLine[] = []
  const pattern = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
  for (const match of value.matchAll(pattern)) {
    const startTime = (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? '').padEnd(3, '0') || 0)
    const text = match[4].trim()
    if (text) lines.push({ startTime, endTime: startTime + 5_000, text })
  }
  lines.sort((a, b) => a.startTime - b.startTime)
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
  const lrcLines = useMemo(() => parseLrc(lyric), [lyric])
  const translatedLines = useMemo(() => parseLrc(tlyric), [tlyric])

  const currentLine = useMemo(() => {
    const timeMs = currentTime * 1000
    if (ttmlLines?.length) {
      let low = 0
      let high = ttmlLines.length - 1
      let line: (typeof ttmlLines)[number] | undefined
      while (low <= high) {
        const middle = (low + high) >> 1
        const candidate = ttmlLines[middle]!
        if (timeMs < candidate.startTime) high = middle - 1
        else if (timeMs >= candidate.endTime) low = middle + 1
        else {
          line = candidate
          break
        }
      }
      if (line) {
        return {
          text: line.words.map((word) => word.word).join(''),
          translation: line.translatedLyric || undefined,
        }
      }
    }

    const line = findTimedLine(lrcLines, timeMs)
    if (!line) return null
    const translation = findNearestLine(translatedLines, line.startTime, 120)?.text
    return { text: line.text, translation }
  }, [currentTime, lrcLines, translatedLines, ttmlLines])

  return (
    <div className="min-w-0 flex-1 px-2 text-center sm:px-4">
      <p className="truncate text-sm text-white/80">
        {lyricLoading ? '歌词加载中...' : currentLine?.text ?? '暂无歌词'}
      </p>
      {currentLine?.translation && <p className="truncate text-xs text-white/40">{currentLine.translation}</p>}
    </div>
  )
}
