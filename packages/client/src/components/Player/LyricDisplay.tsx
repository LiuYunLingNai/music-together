import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import { lyricPlayerBridge } from '@/lib/lyricPlayerBridge'
import { getLyricSeekTime } from '@/lib/lyricSeek'
import { buildAMLLLinesFromLrc, mergeLyrics } from '@/lib/lyricLrc'
import { AbilityContext } from '@/providers/ability-context'
import type { LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import '@applemusic-like-lyrics/core/style.css'
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const

interface LyricDisplayProps {
  onSeek: (time: number) => void
  /**
   * 是否允许点击歌词行跳转。
   *
   * 默认 `true` —— 经典播放器保持既有行为不变。
   *
   * Mineradio 视觉舞台传 `false`：上游 Mineradio **没有**"点击歌词跳转"
   * 这个功能（全仓唯一的画布 click 属于歌单架，歌词相关零命中），而且
   * 画布同时承载"拖拽转物体"手势，命中判定会在拖动时误触发跳转
   * （用户实测："旋转相机时很容易误跳转歌词"）。按"对齐上游"在视觉舞台
   * 下关闭该入口；经典播放器不受影响。
   */
  seekEnabled?: boolean
}

export function LyricDisplay({ onSeek, seekEnabled = true }: LyricDisplayProps) {
  const lyric = usePlayerStore((s) => s.lyric)
  const tlyric = usePlayerStore((s) => s.tlyric)
  const lyricLoading = usePlayerStore((s) => s.lyricLoading)
  const ttmlLines = usePlayerStore((s) => s.ttmlLines)
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

  // LRC 回退路径（仅在没有 TTML 时使用）。解析与配对实现在 `@/lib/lyricLrc`，
  // 与 folia 舞台共用同一份 —— 见该模块顶部说明。
  const lrcLines = useMemo(() => mergeLyrics(lyric, tlyric), [lyric, tlyric])
  const lrcAmllLines = useMemo(() => buildAMLLLinesFromLrc(lyric, tlyric), [lyric, tlyric])
  // TTML 优先，LRC 回退
  const seekableLines = ttmlLines ?? lrcAmllLines
  const hasLyrics = ttmlLines ? ttmlLines.length > 0 : lrcLines.length > 0
  const lyricSeekEnabled = seekEnabled && canSeek && !isCalibrating && duration > 0

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
    lyricPlayerBridge.setCurrentTime(usePlayerStore.getState().currentTime, isCalibrating)
  }, [isCalibrating, lyricOffsetMs, lyricPlayer])

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
        currentTime={Math.max(0, Math.round(usePlayerStore.getState().currentTime * 1000 - lyricOffsetMs))}
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
