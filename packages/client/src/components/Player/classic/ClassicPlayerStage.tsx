import { ArtistNames } from '@/components/ArtistNames'
import { useContainerPortrait } from '@/hooks/useContainerPortrait'
import { useCoverWidth } from '@/hooks/useCoverWidth'
import { useDynamicCover } from '@/hooks/useDynamicCover'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePortraitCoverFrame } from '@/hooks/usePortraitCoverFrame'
import { useSongHandoff } from '@/hooks/useSongHandoff'
import { getProxiedCoverUrl } from '@/lib/cover'
import { COARSE_POINTER_QUERY } from '@/lib/pointer'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'

import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AmllBackgroundRender } from './AmllBackgroundRender'
import { VoteBanner } from '../../Vote/VoteBanner'
import { SONG_INFO_TRANSITION } from '../constants'
import { CoverArt } from '../CoverArt'
import { LyricDisplay } from '../LyricDisplay'
import { PlayerControls } from '../PlayerControls'
import { SongInfoBar } from '../SongInfoBar'
import { SongTextCrossfade } from '../SongTextCrossfade'
import type { VoteAction, VoteState } from '@music-together/shared'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Settings2 } from 'lucide-react'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const

const MOBILE_LYRIC_AUTO_EXPAND_DELAY_MS = 900
const SMOOTH_EASE = [0.22, 1, 0.36, 1] as const

const LYRIC_MASK_STYLE = {
  maskImage: 'linear-gradient(to bottom, transparent 0%, black 5%, black 95%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 5%, black 95%, transparent 100%)',
} as const

/** 沉浸封面向下淡出，融进下面的歌曲信息与控制栏。 */
const IMMERSIVE_MASK = {
  maskImage: 'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
} as const

/** 上游 VerticalLayout 的封面形变弹簧。 */
const COVER_SPRING = { type: 'spring' as const, stiffness: 200, damping: 30 }

/** 上游 Cover 暂停缩小：仅「竖屏沉浸封面 + 静态图 + 暂停」时触发，比例 0.75。 */
const PAUSE_SHRINK_SCALE = 0.75
const COVER_PAUSE_TRANSITION = { duration: 0.6, ease: [0.4, 0.2, 0.1, 1] as const }
const COVER_RESUME_TRANSITION = { duration: 0.5, ease: [0.3, 0.2, 0.2, 1.4] as const }

const COMPACT_COVER_PX = 56

/** 竖屏封面视图的内容留白：对齐上游竖屏把封面列再收进一档的做法。 */
const PORTRAIT_COVER_PADDING = { paddingInline: '1.75rem', paddingBlock: '1.5rem' } as const

interface ClassicPlayerStageProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onLyricSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenChat: () => void
  onOpenQueue: () => void
  /** 打开设置面板的「播放器」页（经典族） */
  onOpenSettings?: () => void
  chatUnreadCount: number
  activeVote: VoteState | null
  onCastVote: (approve: boolean) => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

/**
 * 经典播放器舞台。
 *
 * 本组件是从改造前的 AudioPlayer 原样抽出的布局实现，
 * 行为与改造前完全一致 —— 它是 Mineradio 舞台的可靠回退入口。
 */
export function ClassicPlayerStage({
  onPlay,
  onPause,
  onSeek,
  onLyricSeek,
  onNext,
  onPrev,
  onOpenChat,
  onOpenQueue,
  onOpenSettings,
  chatUnreadCount,
  activeVote,
  onCastVote,
  onStartVote,
}: ClassicPlayerStageProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const bgFps = useSettingsStore((s) => s.bgFps)
  const bgFlowSpeed = useSettingsStore((s) => s.bgFlowSpeed)
  const bgRenderScale = useSettingsStore((s) => s.bgRenderScale)
  const bgRenderer = useSettingsStore((s) => s.bgRenderer)
  const bgCssBackground = useSettingsStore((s) => s.bgCssBackground)
  const immersiveCover = useSettingsStore((s) => s.classicImmersiveCover)
  const autoAlign = useSettingsStore((s) => s.classicLyricAutoAlign)
  const dynamicCoverEnabled = useSettingsStore((s) => s.dynamicCoverEnabled)
  const { ref: playerRef, isPortrait } = useContainerPortrait()
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== 'hidden')

  useEffect(() => {
    const handleVisibilityChange = () => setDocumentVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // 视频封面：上游 `musicCoverIsVideoAtom`，有动态封面时封面与背景都用视频。
  // 触屏上两路视频解码代价高，只在用户主动开启沉浸且竖屏时允许。
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY)
  const videoCoverUrl = useDynamicCover(
    currentTrack,
    dynamicCoverEnabled && (!coarsePointer || (isPortrait && immersiveCover)),
  )
  const coverIsVideo = videoCoverUrl !== null

  // 封面 URL 代理：解决 QQ 音乐 / 酷狗等 CDN 的 CORS 限制
  const proxiedCover = currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : undefined
  // 静态封面继续用已建好的 Image（先设 crossOrigin / no-referrer 再设 src）。
  const backgroundImage = useMemo(() => {
    if (!proxiedCover || typeof Image === 'undefined') return undefined
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.src = proxiedCover
    return image
  }, [proxiedCover])
  // 视频封面和上游一样传 URL 字符串，由 AMLL 自己创建 video 并等 playing/timeupdate 后取色；
  // 传已创建的元素会卡在 `loadResourceFromElement` 的视频 onload 分支上（视频不触发 onload）。
  const backgroundAlbum = videoCoverUrl ?? backgroundImage

  // Mobile: toggle between cover view and lyric view
  const [lyricExpanded, setLyricExpanded] = useState(false)
  const hasAutoExpandedLyrics = useRef(false)

  // 覆盖层封面是首屏主角，与上游一致：沉浸封面（含视频封面）不自动切歌词。
  useEffect(() => {
    if (!isPortrait || hasAutoExpandedLyrics.current) return
    if (immersiveCover || coverIsVideo) {
      hasAutoExpandedLyrics.current = true
      return
    }

    const timer = window.setTimeout(() => {
      hasAutoExpandedLyrics.current = true
      setLyricExpanded(true)
    }, MOBILE_LYRIC_AUTO_EXPAND_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [isPortrait, immersiveCover, coverIsVideo])

  // Desktop layout still constrains info/controls to the cover area's shorter edge.
  // 只有竖屏歌词页才需要暂停（歌词页的封面位会缩成 56px）；横屏始终按实际尺寸测量。
  const { ref: coverAreaRef, coverWidth } = useCoverWidth(isPortrait && lyricExpanded)
  const toggleLyricView = useCallback(() => setLyricExpanded((v) => !v), [])

  // 竖屏沉浸：上级设置强制开启，视频封面则自动进入（上游 Auto 模式）。
  const immersive = isPortrait && (immersiveCover || coverIsVideo) && !lyricExpanded
  const pauseShrink = immersive && !isPlaying && !coverIsVideo
  const desktopCoverRef = useRef<HTMLDivElement>(null)
  const desktopLyricRef = useRef<HTMLDivElement>(null)
  const [coverCenterRatio, setCoverCenterRatio] = useState<number | null>(null)
  // 上游横向布局：歌词锚点取封面中心在歌词区内的相对高度；竖屏则贴顶（歌曲信息下方）。
  useLayoutEffect(() => {
    const cover = desktopCoverRef.current
    const lyricBox = desktopLyricRef.current
    if (isPortrait || !autoAlign || !cover || !lyricBox) return
    const update = () => {
      const c = cover.getBoundingClientRect()
      const l = lyricBox.getBoundingClientRect()
      if (l.height <= 0) return
      setCoverCenterRatio(Math.min(1, Math.max(0, (c.top + c.height / 2 - l.top) / l.height)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(cover)
    ro.observe(lyricBox)
    return () => ro.disconnect()
  }, [isPortrait, autoAlign])
  const lyricAlign = !autoAlign
    ? null
    : isPortrait
      ? ({ anchor: 'top', position: 0.1 } as const)
      : coverCenterRatio === null
        ? null
        : ({ anchor: 'center', position: coverCenterRatio } as const)
  const stageColumnRef = useRef<HTMLDivElement>(null)
  const {
    frame: coverFrame,
    bigSlotRef,
    smallSlotRef,
  } = usePortraitCoverFrame({
    lyricExpanded,
    immersive,
    enabled: isPortrait,
    rootRef: stageColumnRef,
  })
  const handoff = useSongHandoff()

  // 桌面布局沿用封面区较短边；竖屏直接取测量出的封面帧宽度，两者都由实际尺寸驱动。
  const desktopCoverMaxStyle = coverWidth ? { maxWidth: coverWidth } : undefined
  const portraitCoverMaxStyle = coverFrame ? { maxWidth: coverFrame.width } : undefined
  const infoMaxStyle = immersive ? { maxWidth: 448 } : portraitCoverMaxStyle
  const controlsMaxStyle = immersive ? { maxWidth: 448 } : lyricExpanded ? undefined : portraitCoverMaxStyle

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
      {/* AMLL 动态背景：渲染器与低频鼓点均对齐上游 amll-player */}
      {backgroundAlbum && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <AmllBackgroundRender
            album={backgroundAlbum}
            albumIsVideo={coverIsVideo}
            staticMode={!documentVisible}
            fps={bgFps}
            flowSpeed={bgFlowSpeed}
            renderScale={bgRenderScale}
            renderer={bgRenderer}
            cssBackground={bgCssBackground}
            style={FULL_SIZE_STYLE}
          />
        </div>
      )}

      {!isPortrait && (
        <div className="mt-player-view-toggle absolute top-4 z-20 flex items-center gap-1">
          {onOpenSettings && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-primary/80 hover:bg-primary/10 hover:text-primary"
                  onClick={onOpenSettings}
                  aria-label="播放器设置"
                >
                  <Settings2 className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>播放器设置</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Content with padding；竖屏封面视图留白略大，避免封面与控制贴住面板 */}
      <div
        className="mt-player-content relative z-10 h-full"
        style={isPortrait && !lyricExpanded ? PORTRAIT_COVER_PADDING : undefined}
      >
        <div
          ref={playerRef}
          className={cn('flex h-full', isPortrait ? 'flex-col' : 'flex-row gap-[clamp(24px,3vw,48px)]')}
        >
          {/* ----------------------------------------------------------------- */}
          {/* Mobile layout: dual-mode (cover view / lyric view)                */}
          {/* ----------------------------------------------------------------- */}
          {isPortrait ? (
            <LayoutGroup>
              <div
                ref={stageColumnRef}
                className={cn(
                  'relative mx-auto flex h-full w-full flex-col items-center gap-[clamp(12px,3vh,32px)]',
                  '[@media(max-height:760px)]:gap-[clamp(10px,2.6vh,18px)]',
                  !immersive && 'max-w-md',
                )}
              >
                {/* 唯一封面节点：位置由占位块测量驱动，换歌只换内容 */}
                {coverFrame && (
                  <motion.div
                    className="absolute z-0 cursor-pointer overflow-hidden bg-secondary shadow-lg shadow-black/15 will-change-[left,top,width,height]"
                    animate={{ ...coverFrame, scale: pauseShrink ? PAUSE_SHRINK_SCALE : 1 }}
                    initial={false}
                    transition={{
                      ...COVER_SPRING,
                      scale: pauseShrink ? COVER_PAUSE_TRANSITION : COVER_RESUME_TRANSITION,
                    }}
                    onClick={toggleLyricView}
                    style={immersive && !lyricExpanded ? IMMERSIVE_MASK : undefined}
                  >
                    <CoverArt track={currentTrack} videoUrl={lyricExpanded ? null : videoCoverUrl} />
                  </motion.div>
                )}

                {/* 1. 封面占位：封面视图占满剩余空间；歌词视图是列表头部的缩略图位 */}
                <div ref={bigSlotRef} className={cn('w-full', !lyricExpanded && 'min-h-0 flex-1')}>
                  {lyricExpanded && (
                    <div className="flex w-full items-center gap-3.5">
                      <div
                        ref={smallSlotRef}
                        aria-hidden
                        className="shrink-0"
                        style={{ width: COMPACT_COVER_PX, height: COMPACT_COVER_PX }}
                      />
                      <motion.div layoutId="song-info" transition={SONG_INFO_TRANSITION} className="min-w-0 flex-1">
                        <div className="text-[22px] font-semibold leading-tight text-white/90">
                          <SongTextCrossfade
                            text={handoff.to?.title ?? '暂无歌曲'}
                            from={handoff.from?.title ?? null}
                            token={handoff.token}
                          />
                        </div>
                        <div className="text-base text-white/50">
                          <SongTextCrossfade
                            text={handoff.to ? handoff.to.artist.join(' / ') : '...'}
                            from={handoff.from ? handoff.from.artist.join(' / ') : null}
                            token={handoff.token}
                            content={handoff.to ? <ArtistNames track={handoff.to} className="hover:text-white" /> : undefined}
                          />
                        </div>
                      </motion.div>
                    </div>
                  )}
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
                      className="relative z-10 min-h-0 w-full flex-1 overflow-hidden"
                      style={LYRIC_MASK_STYLE}
                    >
                      <LyricDisplay onSeek={onLyricSeek} align={lyricAlign} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 2. Song info + action buttons (independent zoom module) */}
                {!lyricExpanded && (
                  <div className="relative z-10 mx-auto w-full shrink-0" style={infoMaxStyle}>
                    <SongInfoBar {...songInfoProps} showChat={!isPortrait} />
                  </div>
                )}

                {/* 3. Controls (independent zoom module) */}
                <div className="relative z-10 mx-auto w-full shrink-0" style={controlsMaxStyle}>
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
                  <div
                    ref={desktopCoverRef}
                    className="relative aspect-square overflow-hidden rounded-3xl shadow-lg shadow-black/15"
                    style={{
                      width: coverWidth ? `min(${coverWidth}px, 100cqw, 100cqh)` : 'min(100cqw, 100cqh)',
                    }}
                  >
                    <CoverArt track={currentTrack} videoUrl={videoCoverUrl} />
                  </div>
                </div>
                {/* 2. Song info + action buttons */}
                <div className="w-full shrink-0 mx-auto" style={desktopCoverMaxStyle}>
                  <SongInfoBar {...songInfoProps} />
                </div>
                {/* 3. Controls */}
                <div className="w-full shrink-0 mx-auto" style={desktopCoverMaxStyle}>
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
              <div ref={desktopLyricRef} className="min-h-0 w-[60%] overflow-hidden" style={LYRIC_MASK_STYLE}>
                <LyricDisplay onSeek={onLyricSeek} align={lyricAlign} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
