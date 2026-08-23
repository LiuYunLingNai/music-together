import { useContainerPortrait } from '@/hooks/useContainerPortrait'
import { useCoverWidth } from '@/hooks/useCoverWidth'
import { getProxiedCoverUrl } from '@/lib/cover'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'

import { BackgroundRender } from '@applemusic-like-lyrics/react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VoteBanner } from '../Vote/VoteBanner'
import { LyricDisplay } from './LyricDisplay'
import { NowPlaying } from './NowPlaying'
import { PlayerControls } from './PlayerControls'
import { SongInfoBar } from './SongInfoBar'
import { RoomPlaylistView } from '../Room/RoomPlaylistView'
import type { VoteAction, VoteState } from '@music-together/shared'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ListMusic, PanelsTopLeft } from 'lucide-react'
import { useRoomStore } from '@/stores/roomStore'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const
const EMPTY_QUEUE: never[] = []

const MOBILE_LYRIC_AUTO_EXPAND_DELAY_MS = 900
const SMOOTH_EASE = [0.22, 1, 0.36, 1] as const

const LYRIC_MASK_STYLE = {
  maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
} as const

interface AudioPlayerProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onLyricSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenChat: () => void
  onOpenQueue: () => void
  chatUnreadCount: number
  view: 'player' | 'playlist'
  onToggleView: () => void
  activeVote: VoteState | null
  onCastVote: (approve: boolean) => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

export function AudioPlayer({
  onPlay,
  onPause,
  onSeek,
  onLyricSeek,
  onNext,
  onPrev,
  onOpenChat,
  onOpenQueue,
  chatUnreadCount,
  view,
  onToggleView,
  activeVote,
  onCastVote,
  onStartVote,
}: AudioPlayerProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  // Keep the fallback reference stable. Returning a new [] from a Zustand
  // selector makes React see a changed snapshot on every render while the
  // room is not yet available, which can trigger React error #185.
  const queue = useRoomStore((s) => s.room?.queue ?? EMPTY_QUEUE)
  const bgFps = useSettingsStore((s) => s.bgFps)
  const bgFlowSpeed = useSettingsStore((s) => s.bgFlowSpeed)
  const bgRenderScale = useSettingsStore((s) => s.bgRenderScale)
  const { ref: playerRef, isPortrait } = useContainerPortrait()

  // 封面 URL 代理：解决 QQ 音乐 / 酷狗等 CDN 的 CORS 限制
  const proxiedCover = currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : undefined
  // Suppress the document referrer for the renderer's own image request.
  const backgroundCover = useMemo(() => {
    if (!proxiedCover || typeof Image === 'undefined') return undefined
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.src = proxiedCover
    return image
  }, [proxiedCover])

  // Mobile: toggle between cover view and lyric view
  const [lyricExpanded, setLyricExpanded] = useState(false)
  const hasAutoExpandedLyrics = useRef(false)

  // Let the cover render first, then automatically enter the mobile lyric view
  // through the same shared-layout transition used by a cover tap.
  useEffect(() => {
    if (!isPortrait || hasAutoExpandedLyrics.current) return

    const timer = window.setTimeout(() => {
      hasAutoExpandedLyrics.current = true
      setLyricExpanded(true)
    }, MOBILE_LYRIC_AUTO_EXPAND_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [isPortrait])

  // Measure cover area to constrain info/controls width (paused during lyric mode)
  const { ref: coverAreaRef, coverWidth } = useCoverWidth(lyricExpanded)
  const toggleLyricView = useCallback(() => setLyricExpanded((v) => !v), [])

  // Derived styles to constrain info/controls to cover width
  const coverMaxStyle = coverWidth ? { maxWidth: coverWidth } : undefined
  const coverMaxStyleUnlessExpanded = lyricExpanded ? undefined : coverMaxStyle

  const playerControlsProps = {
    onPlay,
    onPause,
    onSeek,
    onNext,
    onPrev,
    onOpenQueue,
    onStartVote,
  } as const

  const songInfoProps = {
    onOpenChat,
    chatUnreadCount,
  } as const

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* AMLL fluid dynamic background powered by pixi.js */}
      {backgroundCover && (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-80 saturate-[1.3]">
          <BackgroundRender
            album={backgroundCover}
            playing
            fps={bgFps}
            flowSpeed={bgFlowSpeed}
            renderScale={bgRenderScale}
            style={FULL_SIZE_STYLE}
          />
        </div>
      )}

      <div className="mt-player-view-toggle absolute top-4 z-20">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-primary/80 hover:bg-primary/10 hover:text-primary"
              onClick={onToggleView}
              aria-label={view === 'player' ? '打开房间歌单' : '返回播放器'}
            >
              {view === 'player' ? <ListMusic className="h-5 w-5" /> : <PanelsTopLeft className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{view === 'player' ? '打开房间歌单' : '返回播放器'}</TooltipContent>
        </Tooltip>
      </div>

      {/* Content with padding */}
      <div className="mt-player-content relative z-10 h-full">
        {view === 'playlist' ? (
          <RoomPlaylistView queue={queue} currentTrackId={currentTrack?.id} />
        ) : (
          <div
            ref={playerRef}
            className={cn('flex h-full', isPortrait ? 'flex-col' : 'flex-row gap-[clamp(24px,3vw,48px)]')}
          >
            {/* ----------------------------------------------------------------- */}
            {/* Mobile layout: dual-mode (cover view / lyric view)                */}
            {/* ----------------------------------------------------------------- */}
            {isPortrait ? (
              <LayoutGroup>
                <div className="relative mx-auto flex h-full w-full max-w-md flex-col items-center gap-[clamp(12px,3vh,32px)]">
                  {/* 1. Cover — fills remaining space in cover mode, centered within */}
                  <div
                    ref={coverAreaRef}
                    className={cn('w-full', !lyricExpanded && 'flex-1 min-h-0 flex items-center justify-center')}
                    style={!lyricExpanded ? ({ containerType: 'size' } as React.CSSProperties) : undefined}
                  >
                    <NowPlaying compact={lyricExpanded} onCoverClick={toggleLyricView} />
                  </div>

                  {/* Lyrics — popLayout so exiting lyrics don't occupy flex space */}
                  <AnimatePresence mode="popLayout">
                    {lyricExpanded && (
                      <motion.div
                        key="lyrics"
                        initial={{ opacity: 0, y: 32 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 24 }}
                        transition={{ duration: 0.65, ease: SMOOTH_EASE, delay: 0.08 }}
                        className="min-h-0 w-full flex-1 overflow-hidden"
                        style={LYRIC_MASK_STYLE}
                      >
                        <LyricDisplay onSeek={onLyricSeek} />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* 2. Song info + action buttons (independent zoom module) */}
                  {!lyricExpanded && (
                    <div className="w-full shrink-0 mx-auto" style={coverMaxStyle}>
                      <SongInfoBar {...songInfoProps} />
                    </div>
                  )}

                  {/* 3. Controls (independent zoom module) */}
                  <div className="relative z-10 w-full shrink-0 mx-auto" style={coverMaxStyleUnlessExpanded}>
                    <PlayerControls {...playerControlsProps} />
                  </div>

                  {/* Vote banner: absolute overlay at the bottom */}
                  {activeVote && (
                    <div className="absolute bottom-0 left-1/2 z-20 w-full -translate-x-1/2 px-2 pb-2">
                      <VoteBanner vote={activeVote} onCastVote={onCastVote} />
                    </div>
                  )}
                </div>
              </LayoutGroup>
            ) : (
              // ---------------------------------------------------------------
              // Desktop layout: left panel (cover + info + controls) + right lyrics
              // ---------------------------------------------------------------
              <>
                <div className="relative flex w-[40%] flex-col items-center gap-[clamp(12px,3vh,32px)] transition-all duration-300">
                  {/* 1. Cover — flex-1 fills remaining space, centered */}
                  <div
                    ref={coverAreaRef}
                    className="min-h-0 w-full flex-1 flex items-center justify-center"
                    style={{ containerType: 'size' }}
                  >
                    <NowPlaying />
                  </div>
                  {/* 2. Song info + action buttons */}
                  <div className="w-full shrink-0 mx-auto" style={coverMaxStyle}>
                    <SongInfoBar {...songInfoProps} />
                  </div>
                  {/* 3. Controls */}
                  <div className="w-full shrink-0 mx-auto" style={coverMaxStyle}>
                    <PlayerControls {...playerControlsProps} />
                  </div>
                  {activeVote && (
                    <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-2 pb-2">
                      <div className="w-full">
                        <VoteBanner vote={activeVote} onCastVote={onCastVote} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-h-0 w-[60%] overflow-hidden" style={LYRIC_MASK_STYLE}>
                  <LyricDisplay onSeek={onLyricSeek} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
