import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MarqueeText } from '@/components/ui/marquee-text'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSocketContext } from '@/providers/socket-context'
import { PLAYER_PLAY_DEDUP_MS } from '@/lib/constants'
import { EVENTS, TIMING } from '@music-together/shared'
import type { PlayMode, VoteAction } from '@music-together/shared'
import {
  ListMusic,
  MessageSquare,
  Music4,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AbilityContext } from '@/providers/ability-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getProxiedCoverUrl } from '@/lib/cover'

/**
 * Mineradio 风格的三列控制栏。
 *
 * 结构参照 Mineradio 的 `#controls`：
 *
 *   grid-template-columns: minmax(0,1fr) max-content minmax(0,1fr)
 *   ├── .actions    左列：封面 + 标题/艺术家 + 聊天
 *   ├── .transport  中列：播放模式 / 上一首 / 播放 / 下一首
 *   └── .modes      右列：音量 / 队列 / 时间
 *
 * 为什么自建而不复用 `PlayerControls`：
 * 后者的布局假设是**经典播放器的左右分栏窄列**（内部用
 * `zoom = clientWidth / 300` 缩放），塞进横向胶囊里比例必然失调 ——
 * 这正是"控制栏不和谐"的原因。
 *
 * 播放、权限、投票逻辑**完全沿用现有 store 与 Ability**，
 * 因此行为与经典播放器一致，只是布局不同。
 */

const PLAY_MODE_CYCLE: PlayMode[] = ['sequential', 'loop-all', 'loop-one', 'shuffle']

const PLAY_MODE_CONFIG: Record<PlayMode, { label: string; icon: typeof Repeat }> = {
  sequential: { label: '顺序播放', icon: Music4 },
  'loop-all': { label: '列表循环', icon: Repeat },
  'loop-one': { label: '单曲循环', icon: Repeat1 },
  shuffle: { label: '随机播放', icon: Shuffle },
}

/**
 * 进度条的本地拖动预览。
 *
 * 实现与经典播放器 `PlayerControls.ProgressControl` **同构** —— 它经过
 * 长期验证，是这里最可靠的参照：
 *
 *   拖动中 (isSeeking) → 显示本地 seekTime
 *   提交时             → 调 onSeek 并**立即** setIsSeeking(false)
 *
 * 为什么提交后可以立即释放（前几轮我判断错了）：
 *   `usePlayer.seek()` 在**同一 tick** 就执行
 *   `usePlayerStore.getState().setCurrentTime(time)`，
 *   所以释放时 store 里已经是目标值，不存在"回退到旧值"的窗口。
 *
 * 这层只处理拖动期间的本地预览，提交后仍交给既有的服务端权威
 * 播放时间线。它不为视觉舞台另建一套 seek 状态机。
 */
function useSeekPreview(currentTime: number) {
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekTime, setSeekTime] = useState(0)

  const beginPreview = useCallback((target: number) => {
    setIsSeeking(true)
    setSeekTime(target)
  }, [])

  const commitSeek = useCallback(
    (target: number, onSeek: (t: number) => void) => {
      onSeek(target)
      // 与经典播放器一致：提交后立即释放。
      // 此时 store 已被 seek() 同步设为 target，不会回退。
      setIsSeeking(false)
    },
    [],
  )

  return {
    displayTime: isSeeking ? seekTime : currentTime,
    isSeeking,
    beginPreview,
    commitSeek,
  }
}

interface MineradioProgressProps {
  disabled: boolean
  canSeek: boolean
  onSeek: (time: number) => void
}

/** 隔离 10Hz 播放时钟，避免整组按钮、Tooltip 与 Popover 跟随重渲染。 */
const MineradioProgress = memo(function MineradioProgress({ disabled, canSeek, onSeek }: MineradioProgressProps) {
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
    [duration, onSeek, commitSeek],
  )

  return (
    <div className="mt-mr-progress-row">
      <span className="mt-mr-time">{formatTime(displayTime)}</span>
      <Slider
        aria-label="播放进度"
        className="mt-mr-progress"
        value={[progress]}
        min={0}
        max={100}
        step={0.1}
        disabled={disabled || !canSeek || duration <= 0}
        onValueChange={([value]) => handleSeekChange(value)}
        onValueCommit={([value]) => handleSeekCommit(value)}
      />
      <span className="mt-mr-time mt-mr-time--right">{formatTime(duration)}</span>
    </div>
  )
})

/**
 * 播放/暂停的乐观状态。
 *
 * `isPlaying` 只在 Howler 的 onplay/onpause 回调里更新（useHowl.ts:327/336），
 * 而暂停要走一整条 WebSocket 往返才触发它。在这段窗口里：
 *   - 按钮仍显示"暂停"图标 → 用户以为"点了没作用"
 *   - currentTime 仍被 startTimeUpdate 推进 → 进度条继续跑
 *
 * 因此本地记一个短暂的预期值（PLAYER_PLAY_DEDUP_MS 后超时失效），
 * 服务端权威值一旦变化就立刻让位。
 */
function useOptimisticPlaying(isPlaying: boolean) {
  // 乐观意图 + 记录意图发出时的权威值。
  // 基线放在 state 里而不是 ref：渲染期读 ref 是 React 禁止的。
  const [intent, setIntentState] = useState<{ value: boolean; baseline: boolean } | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const setIntent = useCallback(
    (next: boolean) => {
      setIntentState({ value: next, baseline: isPlaying })
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      // 超时兜底：服务端拒绝或广播丢失时回到权威值
      timerRef.current = window.setTimeout(() => {
        setIntentState(null)
        timerRef.current = null
      }, PLAYER_PLAY_DEDUP_MS)
    },
    [isPlaying],
  )

  // 让位条件：**权威值已经等于我们的预期值** → 服务端确认了，乐观值完成使命。
  //
  // 不能用"权威值偏离基线"作为判据：服务端把状态回滚到基线值
  // （例如暂停被拒绝、或别人又 resume）时，基线判据会让我们继续显示
  // 一个错误的乐观值，覆盖掉真实状态。
  //
  // 用"到达预期值"判定则天然安全：
  //   - 服务端确认 → isPlaying === intent.value → 让位（此时两者相等，无差别）
  //   - 服务端回滚 → isPlaying === baseline ≠ intent.value → 继续显示乐观值
  //     直到超时兜底把它清掉，随后回到权威值
  const reachedIntent = intent !== null && isPlaying === intent.value
  const effectivePlaying = intent !== null && !reachedIntent ? intent.value : isPlaying

  return { effectivePlaying, setIntent }
}

interface MineradioTransportProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenQueue: () => void
  onOpenChat: () => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
  chatUnreadCount: number
}

/** 把秒格式化为 m:ss。 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MineradioTransport({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onOpenQueue,
  onOpenChat,
  onStartVote,
  chatUnreadCount,
}: MineradioTransportProps) {
  const ability = useContext(AbilityContext)
  const { socket } = useSocketContext()
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const queueLength = useRoomStore((s) => s.room?.queue?.length ?? 0)

  // 播放模式：与经典播放器同源（同一 store 字段与 VoteAction）
  const playMode = useRoomStore((s) => s.room?.playMode ?? 'sequential')
  const canSetMode = ability.can('set-mode', 'Player')
  const canVote = ability.can('vote', 'Player')
  const canSeek = ability.can('seek', 'Player')
  const canPlay = ability.can('play', 'Player')
  const disabled = !currentTrack
  const [skipCooldown, setSkipCooldown] = useState(false)
  const [playCooldown, setPlayCooldown] = useState(false)
  const skipCooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const playCooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)

  // 音量弹出层与静音记忆
  const [popoverOpen, setPopoverOpen] = useState(false)
  const prevVolumeRef = useRef(0.8)

  useEffect(() => {
    return () => {
      if (skipCooldownTimer.current) clearTimeout(skipCooldownTimer.current)
      if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    }
  }, [])

  const toggleMute = useCallback(() => {
    if (volume === 0) setVolume(prevVolumeRef.current)
    else {
      prevVolumeRef.current = volume
      setVolume(0)
    }
  }, [volume, setVolume])

  // ---------------------------------------------------------------- 播放/暂停
  //
  // ★ 必须做**乐观状态**，否则暂停按钮"看起来没作用"。
  //
  // 为什么：`isPlaying` 只在 Howler 的 onplay/onpause 回调里更新
  // （useHowl.ts:327/336），而暂停要走一整条 WebSocket 往返：
  //
  //   点击 → emit(PLAYER_PAUSE) → 服务端 → 广播 → usePlayerSync.onPause
  //        → pausePlayback() → Howler onpause → setIsPlaying(false)
  //
  // 在这段窗口里 isPlaying 仍是 true，于是：
  //   - 按钮还显示"暂停"图标  → 用户以为"点了没作用"
  //   - currentTime 仍被 startTimeUpdate 推进 → 进度条继续跑
  //
  // 做法与经典播放器一致：本地维护一个短暂(PLAYER_PLAY_DEDUP_MS)的
  // 预期值，服务端状态追上后自动让位给权威值。
  const { effectivePlaying, setIntent } = useOptimisticPlaying(isPlaying)

  const handlePlayPause = useCallback(() => {
    if (playCooldown || disabled) return
    const next = !effectivePlaying
    if (canPlay) {
      setIntent(next)
      if (next) onPlay()
      else onPause()
    } else if (canVote) {
      onStartVote(next ? 'resume' : 'pause')
    }
    setPlayCooldown(true)
    if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    playCooldownTimer.current = setTimeout(
      () => setPlayCooldown(false),
      TIMING.PLAYER_NEXT_DEBOUNCE_MS,
    )
  }, [playCooldown, disabled, canPlay, canVote, effectivePlaying, setIntent, onPlay, onPause, onStartVote])

  /**
   * 上一首 / 下一首。
   *
   * 同样必须走权限判定。曾经的 bug：直接把 `onPrev` / `onNext`
   * 绑到 onClick 上，而它们就是 `socket.emit(PLAYER_PREV/NEXT)`，
   * 于是**普通成员可以任意切歌**，绕过了服务端权威与投票机制。
   */
  const handleSkip = useCallback(
    (dir: 'prev' | 'next') => {
      if (skipCooldown || disabled) return
      if (ability.can(dir, 'Player')) {
        if (dir === 'next') onNext()
        else onPrev()
      } else if (canVote) {
        onStartVote(dir)
      }
      setSkipCooldown(true)
      if (skipCooldownTimer.current) clearTimeout(skipCooldownTimer.current)
      skipCooldownTimer.current = setTimeout(
        () => setSkipCooldown(false),
        TIMING.PLAYER_NEXT_DEBOUNCE_MS,
      )
    },
    [skipCooldown, disabled, ability, canVote, onNext, onPrev, onStartVote],
  )

  const handlePlayModeToggle = useCallback(() => {
    const idx = PLAY_MODE_CYCLE.indexOf(playMode)
    const next = PLAY_MODE_CYCLE[(idx + 1) % PLAY_MODE_CYCLE.length]
    // 权限足够时**直接切换**，否则走投票 —— 与经典播放器完全一致。
    //
    // 注意：这里必须用 socket 直发，而不是无脑调 onStartVote。
    // 曾经的 bug：两个分支都调 onStartVote，导致**房主点模式按钮会发起投票**；
    // 更严重的是 owner 只有 `manage all`、并没有 `vote` 权限
    // （见 packages/shared/src/abilities.ts），于是房主发起了一个
    // 自己都不该能投的票。
    if (canSetMode) {
      socket.emit(EVENTS.PLAYER_SET_MODE, { mode: next })
    } else if (canVote) {
      onStartVote('set-mode', { mode: next })
    }
  }, [playMode, canSetMode, canVote, onStartVote, socket])

  const modeConfig = PLAY_MODE_CONFIG[playMode] ?? PLAY_MODE_CONFIG.sequential
  const ModeIcon = modeConfig.icon

  const cover = currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : null

  return (
    <div className="mt-mr-transport">
      {/* 进度条：跨越整行，位于三列之上（与上游的 #progress-bar 一致） */}
      <MineradioProgress disabled={disabled} canSeek={canSeek} onSeek={onSeek} />

      {/* 三列主体 */}
      <div className="mt-mr-controls">
        {/* 左列：封面 + 曲目信息 */}
        <div className="mt-mr-cluster mt-mr-cluster--actions">
          <div className="mt-mr-cover">
            {cover ? (
              <img src={cover} alt="" width={52} height={52} referrerPolicy="no-referrer" />
            ) : (
              <Music4 className="size-5 text-white/25" />
            )}
          </div>
          <div className="mt-mr-meta">
            <div className="mt-mr-title">
              <MarqueeText>{currentTrack?.title ?? '暂无歌曲'}</MarqueeText>
            </div>
            <div className="mt-mr-artist">
              <MarqueeText>{currentTrack ? currentTrack.artist.filter(Boolean).join(' / ') : '点击搜索添加歌曲'}</MarqueeText>
            </div>
          </div>
          <MiniChatButton onOpenChat={onOpenChat} chatUnreadCount={chatUnreadCount} />
        </div>

        {/* 中列：播放控制 */}
        <div className="mt-mr-cluster mt-mr-cluster--transport">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mt-mr-btn"
                onClick={handlePlayModeToggle}
                disabled={!canSetMode && !canVote}
                aria-label={modeConfig.label}
              >
                <ModeIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{modeConfig.label}</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mt-mr-btn"
                onClick={() => handleSkip('prev')}
                disabled={disabled || skipCooldown || (!ability.can('prev', 'Player') && !canVote)}
                aria-label="上一首"
              >
                <SkipBack className="size-4" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>上一首</TooltipContent>
          </Tooltip>

          <Button
            variant="ghost"
            size="icon"
            className="mt-mr-play"
            onClick={handlePlayPause}
            disabled={disabled || playCooldown || (!canPlay && !canVote)}
            aria-label={effectivePlaying ? '暂停' : '播放'}
          >
            {effectivePlaying ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
          </Button>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mt-mr-btn"
                onClick={() => handleSkip('next')}
                disabled={disabled || skipCooldown || (!ability.can('next', 'Player') && !canVote)}
                aria-label="下一首"
              >
                <SkipForward className="size-4" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>下一首</TooltipContent>
          </Tooltip>
        </div>

        {/* 右列：音量 + 队列 */}
        <div className="mt-mr-cluster mt-mr-cluster--modes">
          <Tooltip delayDuration={300} open={popoverOpen ? false : undefined}>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-mr-btn"
                    aria-label={volume === 0 ? '取消静音' : '调节音量'}
                  >
                    {volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
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
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-white/50">
                  {Math.round(volume * 100)}
                </span>
              </PopoverContent>
            </Popover>
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative mt-mr-btn"
                onClick={onOpenQueue}
                aria-label="播放列表"
              >
                <ListMusic className="size-4" />
                {queueLength > 0 && (
                  <span className="mt-mr-badge">{queueLength > 99 ? '99+' : queueLength}</span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>播放列表</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

/** 聊天入口（左列尾部，带未读角标）。 */
function MiniChatButton({ onOpenChat, chatUnreadCount }: { onOpenChat: () => void; chatUnreadCount: number }) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('mt-mr-btn shrink-0')}
          onClick={onOpenChat}
          aria-label="聊天"
        >
          <MessageSquare className="size-4" />
          {chatUnreadCount > 0 && (
            <span className="mt-mr-badge">{chatUnreadCount > 99 ? '99+' : chatUnreadCount}</span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>聊天</TooltipContent>
    </Tooltip>
  )
}
