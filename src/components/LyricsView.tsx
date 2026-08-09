import type { LyricLineMouseEvent, OptimizeLyricOptions } from '@applemusic-like-lyrics/core'
import '@applemusic-like-lyrics/core/style.css'
import { LyricPlayer } from '@applemusic-like-lyrics/react'
import type { LyricPlayerRef } from '@applemusic-like-lyrics/react'
import { Music2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { toAmllLines } from '../lyrics/amll'
import { seekPlayback } from '../services/runtime'
import { useAppStore } from '../store/app-store'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const

// The desktop timeline has already gone through the normalization pipeline in
// engine.ts. Disabling AMLL's second pass prevents focus times from drifting.
const PRESERVE_DESKTOP_TIMELINE: OptimizeLyricOptions = {
  normalizeSpaces: false,
  resetLineTimestamps: false,
  convertExcessiveBackgroundLines: false,
  syncMainAndBackgroundLines: false,
  cleanUnintentionalOverlaps: false,
  tryAdvanceStartTime: false,
}

const SPRING_PRESETS = {
  smooth: { mass: 0.8, damping: 18, stiffness: 110, soft: true },
  sharp: { mass: 0.55, damping: 22, stiffness: 190, soft: false },
  soft: { mass: 1.15, damping: 20, stiffness: 72, soft: true },
  easeout: { mass: 0.7, damping: 26, stiffness: 125, soft: true },
} as const

export function LyricsView() {
  const groups = useAppStore((state) => state.lyricGroups)
  const isPlaying = useAppStore((state) => state.isPlaying)
  const loading = useAppStore((state) => state.lyricsLoading)
  const error = useAppStore((state) => state.lyricsError)
  const room = useAppStore((state) => state.room)!
  const settings = useAppStore((state) => state.lyricSettings)
  const visual = useAppStore((state) => state.playerVisualSettings)
  const notify = useAppStore((state) => state.notify)
  const [offset, setOffset] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; original: string; translated: string; startTime: number } | null>(null)
  const playerRef = useRef<LyricPlayerRef>(null)
  const lines = useMemo(() => toAmllLines(groups), [groups])

  useEffect(() => {
    const track = room.currentTrack
    if (!track) return
    const key = `${track.source}:${track.metadataSource ?? ''}:${track.lyricId ?? track.sourceId}`
    setOffset(Number(localStorage.getItem(`music-together-desktop:lyric-offset:${key}`) ?? 0))
    const handler = (event: Event) => setOffset((event as CustomEvent<number>).detail)
    window.addEventListener('lyric-offset-change', handler)
    return () => window.removeEventListener('lyric-offset-change', handler)
  }, [room.currentTrack])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close) }
  }, [contextMenu])

  useEffect(() => {
    const updateTime = (seconds: number) => playerRef.current?.lyricPlayer?.setCurrentTime(Math.max(0, Math.round(seconds * 1000 - offset)))
    updateTime(useAppStore.getState().currentTime)
    return useAppStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) updateTime(state.currentTime)
    })
  }, [lines, offset])

  if (loading) return <div className="lyrics-state"><span className="loading-bars"><i /><i /><i /></span><strong>正在整理歌词时间轴</strong></div>
  if (error || !lines.length) return <div className="lyrics-state"><Music2 size={28} /><strong>{error || '这首歌暂时没有歌词'}</strong><span>音乐仍会继续播放</span></div>

  const handleLineClick = (event: LyricLineMouseEvent) => {
    const line = event.line.getLine()
    const startTime = line.words[0]?.startTime ?? line.startTime
    seekPlayback(Math.max(0, (startTime + offset) / 1000))
  }

  const handleLineContextMenu = (event: LyricLineMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const line = event.line.getLine()
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 150),
      original: line.words.map((word) => word.word).join(''),
      translated: line.translatedLyric ?? '',
      startTime: line.words[0]?.startTime ?? line.startTime,
    })
  }
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); notify('歌词已复制'); setContextMenu(null) }
  const spring = SPRING_PRESETS[visual.lyricMotion]

  return (
    <div
      className={`lyrics-wrap amll-container lyrics-wrap--${visual.lyricMotion}`}
      style={{
        fontWeight: settings.fontWeight,
        fontFamily: visual.customFontFamily || undefined,
        '--amll-lp-font-size': `clamp(24px, calc(5.8cqh * ${settings.fontSize / 100}), 62px)`,
        '--amll-translated-font-size': `${settings.translationFontSize / 100}em`,
        '--amll-roman-font-size': `${settings.romanFontSize / 100}em`,
      } as CSSProperties}
    >
      <LyricPlayer
        ref={playerRef}
        lyricLines={lines}
        playing={isPlaying}
        alignAnchor={settings.alignAnchor}
        alignPosition={settings.alignPosition}
        enableSpring={settings.animation && !reducedMotion}
        enableBlur={settings.blur}
        enableScale={settings.scale}
        wordFadeWidth={0.5}
        linePosYSpringParams={spring}
        lineScaleSpringParams={spring}
        optimizeOptions={PRESERVE_DESKTOP_TIMELINE}
        onLyricLineClick={handleLineClick}
        onLyricLineContextMenu={handleLineContextMenu}
        bottomLine={room.currentTrack ? (
          <div className={`lyrics-credit lyrics-credit--${visual.contributors}`}>
            <span>{room.currentTrack.title}</span>
            <span>{room.currentTrack.artist.join(' / ')}</span>
          </div>
        ) : undefined}
        style={FULL_SIZE_STYLE}
      />
      {contextMenu && createPortal(<div className="lyric-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <button onClick={() => void copy(contextMenu.original)}>复制原文</button>
        {contextMenu.translated && <button onClick={() => void copy(contextMenu.translated)}>复制翻译</button>}
        <button onClick={() => { seekPlayback(Math.max(0, (contextMenu.startTime + offset) / 1000)); setContextMenu(null) }}>跳转到此处</button>
      </div>, document.body)}
    </div>
  )
}
