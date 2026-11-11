import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getLyricOffsetKey } from '@/lib/lyricOffset'
import { lyricPlayerBridge } from '@/lib/lyricPlayerBridge'
import { getLyricSeekTime } from '@/lib/lyricSeek'
import { buildAMLLLinesFromLrc } from '@/lib/lyricLrc'
import { filterLyricLines } from '@/lib/lyrics/lyricLineRules'
import { useLyricLineFilter } from '@/hooks/useLyricLineFilter'
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
  /** 读取哪一族的歌词设置：经典播放器与 3D 视觉舞台各持一份 */
  family?: 'classic' | 'mineradio'
  /** 宿主明确知道歌词不可见时传入，暂停 AMLL 内部动画。 */
  disabled?: boolean
  /** 舞台按布局算出的对齐（AMLL 自动对齐）；传入时覆盖设置里的锚点与位置。 */
  align?: { anchor: 'top' | 'center' | 'bottom'; position: number } | null
}

export function LyricDisplay({ onSeek, seekEnabled = true, family = 'classic', disabled = false, align = null }: LyricDisplayProps) {
  const mineradio = family === 'mineradio'
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const onVisibility = () => setDocumentVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
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

  const alignAnchor = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricAlignAnchor : s.classicLyricAlignAnchor,
  )
  const alignPosition = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricAlignPosition : s.classicLyricAlignPosition,
  )
  const enableSpring = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricEnableSpring : s.classicLyricEnableSpring,
  )
  const enableBlur = useSettingsStore((s) => (mineradio ? s.mineradioLyricEnableBlur : s.classicLyricEnableBlur))
  const enableScale = useSettingsStore((s) => (mineradio ? s.mineradioLyricEnableScale : s.classicLyricEnableScale))
  const hidePassedLines = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricHidePassedLines : s.classicLyricHidePassedLines,
  )
  const showBottomLine = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricShowBottomLine : s.classicLyricShowBottomLine,
  )
  const maskObsceneWordsMode = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricMaskObsceneWordsMode : s.classicLyricMaskObsceneWordsMode,
  )
  const maskObsceneWordChar = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricMaskObsceneWordChar : s.classicLyricMaskObsceneWordChar,
  )
  const wordFadeWidth = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricWordFadeWidth : s.classicLyricWordFadeWidth,
  )
  const showTranslation = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricShowTranslation : s.classicLyricShowTranslation,
  )
  const showRoman = useSettingsStore((s) => (mineradio ? s.mineradioLyricShowRoman : s.classicLyricShowRoman))
  const swapTransRoman = useSettingsStore((s) =>
    mineradio ? s.mineradioLyricSwapTransRoman : s.classicLyricSwapTransRoman,
  )
  const fontWeight = useSettingsStore((s) => (mineradio ? s.mineradioLyricFontWeight : s.classicLyricFontWeight))
  const fontSize = useSettingsStore((s) => (mineradio ? s.mineradioLyricFontSize : s.classicLyricFontSize))
  const lyricFontFamily = useSettingsStore((s) => s.lyricFontFamily)
  const lyricLetterSpacing = useSettingsStore((s) => s.lyricLetterSpacing)
  const translationFontSize = useSettingsStore((s) => s.lyricTranslationFontSize)
  const romanFontSize = useSettingsStore((s) => s.lyricRomanFontSize)
  const lyricOffsets = useSettingsStore((s) => s.lyricOffsets)
  const lyricOffsetKey = getLyricOffsetKey(currentTrack)
  const savedLyricOffsetMs = lyricOffsets[lyricOffsetKey ?? ''] ?? 0
  const isCalibrating = lyricOffsetPreview?.key === lyricOffsetKey
  const lyricOffsetMs = isCalibrating ? lyricOffsetPreview.offsetMs : savedLyricOffsetMs
  const playerRef = useRef<LyricPlayerRef>(null)
  const [lyricPlayer, setLyricPlayer] = useState<LyricPlayerRef['lyricPlayer']>()

  const shouldHideLine = useLyricLineFilter()
  // LRC 回退路径（仅在没有 TTML 时使用）。解析与配对实现在 `@/lib/lyricLrc`，
  // 与 folia 舞台共用同一份 —— 见该模块顶部说明。
  const lrcAmllLines = useMemo(() => buildAMLLLinesFromLrc(lyric, tlyric), [lyric, tlyric])
  const visibleTtmlLines = useMemo(
    () => (ttmlLines ? filterLyricLines(ttmlLines, shouldHideLine) : null),
    [ttmlLines, shouldHideLine],
  )
  const visibleLrcLines = useMemo(() => filterLyricLines(lrcAmllLines, shouldHideLine), [lrcAmllLines, shouldHideLine])
  // TTML 优先，LRC 回退
  const seekableLines = visibleTtmlLines ?? visibleLrcLines
  // 与上游 `PrebuiltLyricPlayer` 相同：只在需要时复制行，改行级翻译/音译字段。
  const displayLines = useMemo(() => {
    if (showTranslation && showRoman && !swapTransRoman) return seekableLines
    return seekableLines.map((line) => {
      const translatedLyric = showTranslation ? line.translatedLyric : ''
      const romanLyric = showRoman ? line.romanLyric : ''
      return {
        ...line,
        translatedLyric: swapTransRoman ? romanLyric : translatedLyric,
        romanLyric: swapTransRoman ? translatedLyric : romanLyric,
      }
    })
  }, [seekableLines, showTranslation, showRoman, swapTransRoman])
  const hasLyrics = visibleTtmlLines ? visibleTtmlLines.length > 0 : visibleLrcLines.length > 0
  const lyricSeekEnabled = seekEnabled && canSeek && !isCalibrating && duration > 0

  const handleLyricLineClick = useCallback(
    (event: LyricLineMouseEvent) => {
      if (!lyricSeekEnabled || event.lineIndex < 0 || event.lineIndex >= seekableLines.length) return

      const seekTime = getLyricSeekTime(event.line.getLine(), lyricOffsetMs, duration)
      if (seekTime !== null) {
        // 上游 AMLL Player 先改本地歌词时间再通知宿主 seek；房间仍以服务端
        // 确认后的时间为准，bridge 会在确认时校准。
        lyricPlayerBridge.seekOptimistic(seekTime)
        onSeek(seekTime)
      }
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
    const time = usePlayerStore.getState().currentTime
    // 换歌后上一首的乐观跳转必须立刻作废，不能继续压住新歌的逐帧时间。
    lyricPlayerBridge.cancelOptimisticSeek()
    // 校准滑杆拖动时暂停自动 seek 判定，只推时间不 resetScroll；
    // 否则每次拖动都会被内部当成跳转，把用户滚动位置拉回当前行。
    lyricPlayer?.setEnableAutoSeekDetection(!isCalibrating)
    lyricPlayerBridge.setCurrentTime(time, false)
  }, [isCalibrating, lyricOffsetMs, lyricPlayer, currentTrack?.id])

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
          fontFamily: lyricFontFamily || undefined,
          letterSpacing: lyricLetterSpacing || undefined,
          // 上游 `getLyricFontSizeFromPreset` 的 Medium 档，用户比例在此基础上缩放
          '--amll-lp-font-size': `calc(max(max(5vh, 2.5vw), 14px) * ${fontSize / 100})`,
          '--amll-translated-font-size': `${translationFontSize / 100}em`,
          '--amll-roman-font-size': `${romanFontSize / 100}em`,
        } as React.CSSProperties
      }
    >
      <LyricPlayer
        ref={playerRef}
        lyricLines={displayLines}
        playing={isPlaying}
        disabled={disabled || !documentVisible}
        alignAnchor={align?.anchor ?? alignAnchor}
        alignPosition={align?.position ?? alignPosition}
        enableSpring={enableSpring}
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
