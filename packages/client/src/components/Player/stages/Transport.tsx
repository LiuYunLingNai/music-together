import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MarqueeText } from '@/components/ui/marquee-text'
import { cn } from '@/lib/utils'
import { getProxiedCoverUrl } from '@/lib/cover'
import { formatTime } from '@/lib/format'
import { usePlayerStore } from '@/stores/playerStore'
import type { Track } from '@music-together/shared'
import {
  ListMusic,
  Music4,
  Pause,
  Play,
  ChevronLeft,
  ChevronRight,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { memo, useCallback, useState, type ReactNode } from 'react'
import { PLAY_MODE_CONFIG, type TransportActions } from './useTransportActions'

/**
 * 舞台控制条的视觉层：两族共用的小部件。
 *
 * 布局结构由各自的 bar 决定（3D 长条 / Folia 胶囊），行为（权限、投票、
 * 乐观播放、冷却）在 `useTransportActions` 里。
 */

/**
 * 进度条拖动预览：拖动中显示本地值，提交后立即释放（`usePlayer.seek()` 同 tick
 * 就写入了 `currentTime`，不存在回退窗口）。
 */
function useSeekPreview(currentTime: number) {
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekTime, setSeekTime] = useState(0)

  const beginPreview = useCallback((target: number) => {
    setIsSeeking(true)
    setSeekTime(target)
  }, [])

  const commitSeek = useCallback((target: number, onSeek: (t: number) => void) => {
    onSeek(target)
    setIsSeeking(false)
  }, [])

  return { displayTime: isSeeking ? seekTime : currentTime, isSeeking, beginPreview, commitSeek }
}

interface ProgressProps {
  disabled: boolean
  canSeek: boolean
  onSeek: (time: number) => void
  /** `line` 是 Folia 收起胶囊里那条 3px 细线，不带时间。 */
  variant?: 'full' | 'line'
}

/** 隔离 10Hz 播放时钟，避免整组按钮跟随重渲染。 */
export const TransportProgress = memo(function TransportProgress({
  disabled,
  canSeek,
  onSeek,
  variant = 'full',
}: ProgressProps) {
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const { displayTime, beginPreview, commitSeek } = useSeekPreview(currentTime)
  const progress = duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0

  const handleSeekChange = useCallback(
    (value: number) => {
      if (duration > 0) beginPreview((value / 100) * duration)
    },
    [duration, beginPreview],
  )

  const handleSeekCommit = useCallback(
    (value: number) => {
      if (duration > 0) commitSeek((value / 100) * duration, onSeek)
    },
    [duration, commitSeek, onSeek],
  )

  if (variant === 'line') {
    return (
      <Slider
        className="mt-console-progress mt-console-progress--line"
        aria-label="播放进度"
        alignRangeWithThumb
        min={0}
        max={100}
        step={0.1}
        value={[progress]}
        disabled={disabled || !canSeek}
        onValueChange={([value]) => handleSeekChange(value)}
        onValueCommit={([value]) => handleSeekCommit(value)}
      />
    )
  }

  return (
    <div className="mt-console-progress-row">
      <span className="mt-console-time">{formatTime(displayTime)}</span>
      <Slider
        className="mt-console-progress"
        aria-label="播放进度"
        alignRangeWithThumb
        min={0}
        max={100}
        step={0.1}
        value={[progress]}
        disabled={disabled || !canSeek}
        onValueChange={([value]) => handleSeekChange(value)}
        onValueCommit={([value]) => handleSeekCommit(value)}
      />
      <span className="mt-console-time mt-console-time--right">{formatTime(duration)}</span>
    </div>
  )
})

type TransportButtonProps = { actions: TransportActions; className?: string }

export function TransportModeButton({ actions, className = 'mt-console-btn' }: TransportButtonProps) {
  const { playMode, canSetMode, canVote, handlePlayModeToggle } = actions
  const modeConfig = PLAY_MODE_CONFIG[playMode] ?? PLAY_MODE_CONFIG.sequential
  const ModeIcon = modeConfig.icon

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          onClick={handlePlayModeToggle}
          disabled={!canSetMode && !canVote}
          aria-label={modeConfig.label}
        >
          <ModeIcon className="size-[18px]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{modeConfig.label}</TooltipContent>
    </Tooltip>
  )
}

export function TransportSkipButton({
  actions,
  direction,
  className = 'mt-console-btn',
  icon = 'skip',
}: TransportButtonProps & { direction: 'prev' | 'next'; icon?: 'skip' | 'chevron' }) {
  const { disabled, canVote, canPrev, canNext, skipCooldown, handleSkip } = actions
  const isPrev = direction === 'prev'
  const Icon = isPrev ? (icon === 'chevron' ? ChevronLeft : SkipBack) : icon === 'chevron' ? ChevronRight : SkipForward

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          onClick={() => handleSkip(direction)}
          disabled={disabled || skipCooldown || (isPrev ? !canPrev && !canVote : !canNext && !canVote)}
          aria-label={isPrev ? '上一首' : '下一首'}
        >
          <Icon
            className={icon === 'chevron' ? 'size-4' : 'size-[18px]'}
            fill={icon === 'chevron' ? 'none' : 'currentColor'}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isPrev ? '上一首' : '下一首'}</TooltipContent>
    </Tooltip>
  )
}

export function TransportPlayButton({ actions, className = 'mt-console-play' }: TransportButtonProps) {
  const { disabled, playing, canVote, playCooldown, canPlay, handlePlayPause } = actions

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={handlePlayPause}
      disabled={disabled || playCooldown || (!canPlay && !canVote)}
      aria-label={playing ? '暂停' : '播放'}
    >
      {playing ? (
        <Pause className="size-5" fill="currentColor" />
      ) : (
        <Play className="ml-0.5 size-5" fill="currentColor" />
      )}
    </Button>
  )
}

/** 播放模式 / 上一首 / 播放 / 下一首 —— 两族共用的核心键。 */
export function TransportButtons({ actions, className }: { actions: TransportActions; className?: string }) {
  return (
    <div className={cn('mt-console-transport', className)}>
      <TransportModeButton actions={actions} />
      <TransportSkipButton actions={actions} direction="prev" />
      <TransportPlayButton actions={actions} />
      <TransportSkipButton actions={actions} direction="next" />
    </div>
  )
}

/** 音量键 + 滑杆浮层。 */
export function VolumeControl({ actions }: { actions: TransportActions }) {
  const { volume, setVolume, toggleMute } = actions
  const [open, setOpen] = useState(false)

  return (
    <Tooltip delayDuration={300} open={open ? false : undefined}>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="mt-console-btn"
              aria-label={volume === 0 ? '取消静音' : '调节音量'}
            >
              {volume === 0 ? <VolumeX className="size-[18px]" /> : <Volume2 className="size-[18px]" />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>音量</TooltipContent>
        <PopoverContent side="top" align="center" className="flex w-44 items-center gap-2 rounded-xl px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={toggleMute}
            aria-label={volume === 0 ? '取消静音' : '静音'}
          >
            {volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <Slider
            aria-label="音量"
            min={0}
            max={100}
            value={[volume * 100]}
            onValueChange={([v]) => setVolume(v / 100)}
          />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-white/50">{Math.round(volume * 100)}</span>
        </PopoverContent>
      </Popover>
    </Tooltip>
  )
}

/** 队列入口 + 未读数角标。 */
export function QueueButton({ actions, onOpenQueue }: { actions: TransportActions; onOpenQueue: () => void }) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative mt-console-btn"
          onClick={onOpenQueue}
          aria-label="播放列表"
        >
          <ListMusic className="size-[18px]" />
          {actions.queueLength > 0 && (
            <span className="mt-console-badge">{actions.queueLength > 99 ? '99+' : actions.queueLength}</span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>播放列表</TooltipContent>
    </Tooltip>
  )
}

/** 封面 + 歌名/歌手（长名字跑马灯）。 */
export function TrackMeta({
  track,
  showCover = true,
  badge,
}: {
  track: Track | null
  showCover?: boolean
  badge?: ReactNode
}) {
  const cover = track?.cover ? getProxiedCoverUrl(track.cover) : null

  return (
    <>
      {showCover && (
        <div className="mt-console-cover">
          {cover ? (
            <img src={cover} alt="" width={44} height={44} referrerPolicy="no-referrer" />
          ) : (
            <Music4 className="size-5 text-white/25" />
          )}
        </div>
      )}
      <div className="mt-console-meta">
        <div className="mt-console-title">
          <MarqueeText>{track?.title ?? '暂无歌曲'}</MarqueeText>
        </div>
        <div className="mt-console-artist-row">
          <div className="mt-console-artist">
            <MarqueeText>{track ? track.artist.filter(Boolean).join(' / ') : '点击搜索添加歌曲'}</MarqueeText>
          </div>
          {badge}
        </div>
      </div>
    </>
  )
}
