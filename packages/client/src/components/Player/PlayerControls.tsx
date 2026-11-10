import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTime } from '@/lib/format'
import {
  getActiveTransitionCue,
  shouldDrawCue,
  subscribeTransitionCue,
} from '@/lib/automix/transitionCue'
import { AbilityContext } from '@/providers/ability-context'
import { useSocketContext } from '@/providers/socket-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { PlayMode, VoteAction } from '@music-together/shared'
import { EVENTS, TIMING } from '@music-together/shared'
import { ArrowRightToLine, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'

/** Design-time width (px) at which the controls are laid out — CSS zoom scales from this baseline */
const DESIGN_WIDTH = 300

const PLAY_MODE_CYCLE: PlayMode[] = ['sequential', 'loop-all', 'loop-one', 'shuffle']

const PLAY_MODE_CONFIG: Record<PlayMode, { icon: typeof Repeat; label: string }> = {
  sequential: { icon: ArrowRightToLine, label: '顺序播放' },
  'loop-all': { icon: Repeat, label: '列表循环' },
  'loop-one': { icon: Repeat1, label: '单曲循环' },
  shuffle: { icon: Shuffle, label: '随机播放' },
}

interface PlayerControlsProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenQueue: () => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

interface ProgressControlProps {
  disabled: boolean
  canSeek: boolean
  onSeek: (time: number) => void
}

/** 波纹的名义周期；每个过渡切成整数趟，最后一趟正好在过渡结束时走完。 */
const WAVE_NOMINAL_SEC = 2.8

/** Keep the 10 Hz playback clock isolated from the buttons and tooltips. */
const ProgressControl = memo(function ProgressControl({ disabled, canSeek, onSeek }: ProgressControlProps) {
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekTime, setSeekTime] = useState(0)
  /**
   * 过渡提示：交叉淡化期间进度条亮起辉光、时间行中间显示「过渡」。
   *
   * 订阅是事件驱动的 —— 一次过渡只在开场/收场各多出两次渲染；呼吸、波纹与
   * 淡入淡出全部交给 CSS（只动 opacity / transform），这里不跑 rAF、不读时钟。
   */
  const cue = useSyncExternalStore(subscribeTransitionCue, getActiveTransitionCue, getActiveTransitionCue)
  const cueEnabled = useSettingsStore((s) => s.transitionCueEnabled)
  const showRemainingTime = useSettingsStore((s) => s.showRemainingTime)
  const setShowRemainingTime = useSettingsStore((s) => s.setShowRemainingTime)
  const position = isSeeking ? seekTime : currentTime
  const transitioning = cue !== null && shouldDrawCue(cue, cueEnabled)
  // 与出歌速度同步呼吸：四拍一个来回；没测到 BPM 时用固定的 2.4 秒。
  const pulseSec = Math.min(3.2, Math.max(1.4, (cue?.periodSec ?? 0.6) * 4))

  /**
   * 波纹的周期按过渡时长均分：过渡结束时最后一趟刚好走完、柔光带停在条外，
   * 收场因此不会出现波到一半突然消失。周期改变时重挂节点，从条首重新出发。
   */
  const cueSeconds = cue?.seconds ?? WAVE_NOMINAL_SEC
  const waveSec = cueSeconds / Math.max(1, Math.round(cueSeconds / WAVE_NOMINAL_SEC))

  return (
    <div
      className="mt-progress flex w-full flex-col gap-1"
      data-transition={transitioning ? 'true' : undefined}
      style={
        {
          '--mt-transition-pulse': `${pulseSec}s`,
          '--mt-transition-wave': `${waveSec}s`,
        } as CSSProperties
      }
    >
      <div className="relative">
        <span aria-hidden="true" className="mt-transition-glow">
          <span className="mt-transition-glow-inner" />
          <span className="mt-transition-glow-wave">
            <span key={cue?.startsAt ?? 0} className="mt-transition-glow-wave-band" />
          </span>
        </span>
        <Slider
          value={[duration > 0 ? ((isSeeking ? seekTime : currentTime) / duration) * 100 : 0]}
          max={100}
          step={0.1}
          alignRangeWithThumb
          disabled={disabled || !canSeek}
          onValueChange={(value) => {
            if (duration > 0) {
              setIsSeeking(true)
              setSeekTime((value[0] / 100) * duration)
            }
          }}
          onValueCommit={(value) => {
            if (duration > 0) onSeek((value[0] / 100) * duration)
            setIsSeeking(false)
          }}
          className="w-full"
        />
      </div>
      <div className="relative flex w-full justify-between">
        <button
          type="button"
          onClick={() => setShowRemainingTime(!showRemainingTime)}
          className="text-xs tabular-nums text-white/50 transition-colors hover:text-white/80"
          aria-label={showRemainingTime ? '显示已播放时间' : '显示剩余时间'}
        >
          {showRemainingTime
            ? `-${formatTime(Math.max(0, duration - position))}`
            : formatTime(position)}
        </button>
        <span aria-hidden={!transitioning} className="mt-transition-label">
          <span className="mt-transition-label-inner">过渡</span>
        </span>
        <span className="text-xs tabular-nums text-white/50">{formatTime(duration)}</span>
      </div>
    </div>
  )
})

export const PlayerControls = memo(function PlayerControls({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onOpenQueue,
  onStartVote,
}: PlayerControlsProps) {
  const { socket } = useSocketContext()
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const queueLength = useRoomStore((s) => s.room?.queue?.length ?? 0)
  const playMode = useRoomStore((s) => s.room?.playMode ?? 'sequential')
  const ability = useContext(AbilityContext)
  const canSeek = ability.can('seek', 'Player')
  const canPlay = ability.can('play', 'Player')
  const canSetMode = ability.can('set-mode', 'Player')
  const canVote = ability.can('vote', 'Player')
  const [skipCooldown, setSkipCooldown] = useState(false)
  const [playCooldown, setPlayCooldown] = useState(false)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const playCooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const disabled = !currentTrack
  // Clean up cooldown timers on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
      if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    }
  }, [])

  // Scale entire controls area proportionally — like the cover image
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const inner = innerRef.current
    if (!wrapper || !inner) return
    const update = () => {
      inner.style.setProperty('zoom', String(wrapper.clientWidth / DESIGN_WIDTH))
    }
    update()
    const ro = new ResizeObserver(() => update())
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [])

  const handleSkip = (action: () => void, voteAction: 'next' | 'prev') => {
    if (skipCooldown) return
    if (ability.can(voteAction, 'Player')) {
      action()
    } else if (canVote) {
      onStartVote(voteAction)
    }
    setSkipCooldown(true)
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
    cooldownTimer.current = setTimeout(() => setSkipCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
  }

  const handlePlayPause = () => {
    if (playCooldown) return
    if (canPlay) {
      if (isPlaying) onPause()
      else onPlay()
    } else if (canVote) {
      onStartVote(isPlaying ? 'pause' : 'resume')
    }
    setPlayCooldown(true)
    if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    playCooldownTimer.current = setTimeout(() => setPlayCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
  }

  const handlePlayModeToggle = () => {
    const currentIdx = PLAY_MODE_CYCLE.indexOf(playMode)
    const nextMode = PLAY_MODE_CYCLE[(currentIdx + 1) % PLAY_MODE_CYCLE.length]
    if (canSetMode) {
      socket.emit(EVENTS.PLAYER_SET_MODE, { mode: nextMode })
    } else if (canVote) {
      onStartVote('set-mode', { mode: nextMode })
    }
  }

  const modeConfig = PLAY_MODE_CONFIG[playMode]
  const ModeIcon = modeConfig.icon

  return (
    <div ref={wrapperRef} className="w-full">
      <div ref={innerRef} className="flex flex-col gap-6" style={{ width: DESIGN_WIDTH }}>
        {/* 1. Progress bar */}
        <ProgressControl disabled={disabled} canSeek={canSeek} onSeek={onSeek} />

        {/* 2. Controls row — left/right flex-1 keeps center truly centered */}
        <div className="flex w-full items-center">
          {/* Left: play mode */}
          <div className="flex flex-1 items-center justify-start">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-primary/75 hover:bg-primary/10 hover:text-primary"
                    onClick={handlePlayModeToggle}
                    disabled={!canSetMode && !canVote}
                    aria-label={modeConfig.label}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={playMode}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <ModeIcon className="size-5" />
                      </motion.div>
                    </AnimatePresence>
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{modeConfig.label}</TooltipContent>
            </Tooltip>
          </div>

          {/* Center: prev + play/pause + next */}
          <div className="flex items-center gap-2">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-primary/75 hover:bg-primary/10 hover:text-primary"
                    disabled={disabled || skipCooldown}
                    onClick={() => handleSkip(onPrev, 'prev')}
                    aria-label="上一首"
                  >
                    <SkipBack className="size-5" fill="currentColor" />
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>上一首</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-14 w-14 rounded-full bg-primary/20 text-primary hover:bg-primary/30 hover:text-primary"
                    disabled={disabled || playCooldown}
                    onClick={handlePlayPause}
                    aria-label={isPlaying ? '暂停' : '播放'}
                  >
                    {isPlaying ? (
                      <Pause className="size-7" fill="currentColor" />
                    ) : (
                      <Play className="ml-0.5 size-7" fill="currentColor" />
                    )}
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{isPlaying ? '暂停（空格）' : '播放（空格）'}</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-primary/75 hover:bg-primary/10 hover:text-primary"
                    disabled={disabled || skipCooldown}
                    onClick={() => handleSkip(onNext, 'next')}
                    aria-label="下一首"
                  >
                    <SkipForward className="size-5" fill="currentColor" />
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>下一首</TooltipContent>
            </Tooltip>
          </div>

          {/* Right: queue */}
          <div className="flex flex-1 items-center justify-end">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative h-9 w-9 text-primary/75 hover:bg-primary/10 hover:text-primary"
                    onClick={onOpenQueue}
                    aria-label="播放列表"
                  >
                    <ListMusic className="size-5" />
                    {queueLength > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/90 px-1 text-[10px] font-semibold leading-none text-black">
                        {queueLength > 99 ? '99+' : queueLength}
                      </span>
                    )}
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>播放列表</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
})
