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

export function MiniLyricText() {
  const lyric = usePlayerStore((state) => state.lyric)
  const tlyric = usePlayerStore((state) => state.tlyric)
  const ttmlLines = usePlayerStore((state) => state.ttmlLines)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const lyricLoading = usePlayerStore((state) => state.lyricLoading)

  const currentLine = useMemo(() => {
    const timeMs = currentTime * 1000
    if (ttmlLines?.length) {
      const line = ttmlLines.find((item) => timeMs >= item.startTime && timeMs < item.endTime)
      if (line) {
        return {
          text: line.words.map((word) => word.word).join(''),
          translation: line.translatedLyric || undefined,
        }
      }
    }

    const lines = parseLrc(lyric)
    const line = lines.find((item) => timeMs >= item.startTime && timeMs < item.endTime)
    if (!line) return null
    const translation = parseLrc(tlyric).find((item) => Math.abs(item.startTime - line.startTime) < 120)?.text
    return { text: line.text, translation }
  }, [currentTime, lyric, tlyric, ttmlLines])

  return (
    <div className="min-w-0 flex-1 px-2 text-center sm:px-4">
      <p className="truncate text-sm text-white/80">
        {lyricLoading ? '歌词加载中...' : currentLine?.text ?? '暂无歌词'}
      </p>
      {currentLine?.translation && <p className="truncate text-xs text-white/40">{currentLine.translation}</p>}
    </div>
  )
}
