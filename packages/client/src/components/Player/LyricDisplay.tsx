import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import { lyricPlayerBridge } from '@/lib/lyricPlayerBridge'
import { getLyricSeekTime } from '@/lib/lyricSeek'
import { AbilityContext } from '@/providers/ability-context'
import type { LyricLine as AMLLLyricLine, LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import '@applemusic-like-lyrics/core/style.css'
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const

interface LyricLine {
  time: number
  text: string
  translation?: string
}

interface LyricDisplayProps {
  onSeek: (time: number) => void
}

function parseLRC(lrc: string): { time: number; text: string }[] {
  const lines: { time: number; text: string }[] = []
  // Supports [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx]
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
  let match

  while ((match = regex.exec(lrc)) !== null) {
    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
    const time = minutes * 60 + seconds + ms / 1000
    const text = match[4].trim()
    if (text) {
      lines.push({ time, text })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

function mergeLyrics(original: string, translated: string): LyricLine[] {
  const origLines = parseLRC(original)
  if (origLines.length === 0) return []

  const result: LyricLine[] = origLines.map((l) => ({ ...l }))

  if (!translated) return result

  const transLines = parseLRC(translated)
  if (transLines.length === 0) return result

  const transMap = new Map<number, string>()
  for (const tl of transLines) {
    transMap.set(Math.round(tl.time * 10) / 10, tl.text)
  }

  for (const line of result) {
    const key = Math.round(line.time * 10) / 10
    const exact = transMap.get(key)
    if (exact) {
      line.translation = exact
      continue
    }
    for (let offset = 1; offset <= 5; offset++) {
      const near =
        transMap.get(Math.round((line.time + offset * 0.1) * 10) / 10) ??
        transMap.get(Math.round((line.time - offset * 0.1) * 10) / 10)
      if (near) {
        line.translation = near
        break
      }
    }
  }

  return result
}

/** 将自有 LRC 解析结果转为 AMLL LyricLine 格式 */
function toAMLLLines(lines: LyricLine[]): AMLLLyricLine[] {
  return lines.map((line, i, arr) => {
    const startMs = Math.round(line.time * 1000)
    const endMs = Math.round((arr[i + 1]?.time ?? line.time + 5) * 1000)
    return {
      words: [
        {
          word: line.text,
          startTime: startMs,
          endTime: endMs,
          romanWord: '',
          obscene: false,
        },
      ],
      translatedLyric: line.translation ?? '',
      romanLyric: '',
      startTime: startMs,
      endTime: endMs,
      isBG: false,
      isDuet: false,
    }
  })
}

export function LyricDisplay({ onSeek }: LyricDisplayProps) {
  const lyric = usePlayerStore((s) => s.lyric)
  const tlyric = usePlayerStore((s) => s.tlyric)
  const lyricLoading = usePlayerStore((s) => s.lyricLoading)
  const ttmlLines = usePlayerStore((s) => s.ttmlLines)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const lyricOffsetPreview = usePlayerStore((s) => s.lyricOffsetPreview)
  const ability = useContext(AbilityContext)
  const canSeek = ability.can('seek', 'Player')

  const alignAnchor = useSettingsStore((s) => s.lyricAlignAnchor)
  const alignPosition = useSettingsStore((s) => s.lyricAlignPosition)
  const enableSpring = useSettingsStore((s) => s.lyricEnableSpring)
  const enableBlur = useSettingsStore((s) => s.lyricEnableBlur)
  const enableScale = useSettingsStore((s) => s.lyricEnableScale)
  const hidePassedLines = useSettingsStore((s) => s.lyricHidePassedLines)
  const showBottomLine = useSettingsStore((s) => s.lyricShowBottomLine)
  const maskObsceneWordsMode = useSettingsStore((s) => s.lyricMaskObsceneWordsMode)
  const maskObsceneWordChar = useSettingsStore((s) => s.lyricMaskObsceneWordChar)
  const wordFadeWidth = useSettingsStore((s) => s.lyricWordFadeWidth)
  const fontWeight = useSettingsStore((s) => s.lyricFontWeight)
  const fontSize = useSettingsStore((s) => s.lyricFontSize)
  const translationFontSize = useSettingsStore((s) => s.lyricTranslationFontSize)
  const romanFontSize = useSettingsStore((s) => s.lyricRomanFontSize)
  const lyricOffsets = useSettingsStore((s) => s.lyricOffsets)
  const lyricOffsetKey = getLyricOffsetKey(currentTrack)
  const savedLyricOffsetMs = lyricOffsets[lyricOffsetKey ?? ''] ?? 0
  const isCalibrating = lyricOffsetPreview?.key === lyricOffsetKey
  const lyricOffsetMs = isCalibrating ? lyricOffsetPreview.offsetMs : savedLyricOffsetMs
  const playerRef = useRef<LyricPlayerRef>(null)
  const [lyricPlayer, setLyricPlayer] = useState<LyricPlayerRef['lyricPlayer']>()

  // LRC 解析（仅在没有 TTML 时使用）
  const lrcLines = useMemo(() => mergeLyrics(lyric, tlyric), [lyric, tlyric])
  const lrcAmllLines = useMemo(() => toAMLLLines(lrcLines), [lrcLines])

  // TTML 优先，LRC 回退
  const seekableLines = ttmlLines ?? lrcAmllLines
  const hasLyrics = ttmlLines ? ttmlLines.length > 0 : lrcLines.length > 0
  const lyricSeekEnabled = canSeek && !isCalibrating && duration > 0

  const handleLyricLineClick = useCallback(
    (event: LyricLineMouseEvent) => {
      if (!lyricSeekEnabled || event.lineIndex < 0 || event.lineIndex >= seekableLines.length) return

      const seekTime = getLyricSeekTime(event.line.getLine(), lyricOffsetMs, duration)
      if (seekTime !== null) onSeek(seekTime)
    },
    [duration, lyricOffsetMs, lyricSeekEnabled, onSeek, seekableLines.length],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLyricPlayer(playerRef.current?.lyricPlayer))
    return () => cancelAnimationFrame(frame)
  }, [hasLyrics])

  useEffect(() => {
    if (!lyricPlayer) return
    return lyricPlayerBridge.attach(lyricPlayer)
  }, [lyricPlayer])

  useEffect(() => {
    lyricPlayerBridge.setOffset(lyricOffsetMs)
    lyricPlayerBridge.setCurrentTime(currentTime, isCalibrating)
  }, [currentTime, isCalibrating, lyricOffsetMs, lyricPlayer])

  if (!hasLyrics) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xl text-white/50">{lyricLoading ? '歌词加载中...' : '暂无歌词'}</p>
      </div>
    )
  }

  return (
    <div
      className={`amll-container h-full w-full${lyricSeekEnabled ? ' amll-container--seekable' : ''}`}
      style={
        {
          fontWeight,
          '--amll-lp-font-size': `clamp(16px, calc(min(5vh, 7vw) * ${fontSize / 100}), 80px)`,
          '--amll-translated-font-size': `${translationFontSize / 100}em`,
          '--amll-roman-font-size': `${romanFontSize / 100}em`,
        } as React.CSSProperties
      }
    >
      <LyricPlayer
        ref={playerRef}
        lyricLines={seekableLines}
        currentTime={Math.max(0, Math.round(currentTime * 1000 - lyricOffsetMs))}
        playing={isPlaying}
        isSeeking={isCalibrating}
        alignAnchor={alignAnchor}
        alignPosition={alignPosition}
        enableSpring={enableSpring && !isCalibrating}
        enableBlur={enableBlur}
        enableScale={enableScale}
        hidePassedLines={hidePassedLines}
        maskObsceneWordsMode={maskObsceneWordsMode}
        maskObsceneWordChar={maskObsceneWordChar}
        wordFadeWidth={wordFadeWidth}
        bottomLine={
          showBottomLine && currentTrack ? (
            <div className="amll-song-footer">
              <div className="amll-song-footer__title">{currentTrack.title}</div>
              <div className="amll-song-footer__artist">{currentTrack.artist.filter(Boolean).join(' / ')}</div>
            </div>
          ) : null
        }
        onLyricLineClick={lyricSeekEnabled ? handleLyricLineClick : undefined}
        style={FULL_SIZE_STYLE}
      />
    </div>
  )
}
