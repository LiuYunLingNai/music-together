import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ArrowRightToLine, Repeat, Repeat1, Shuffle } from 'lucide-react'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSocketContext } from '@/providers/socket-context'
import { AbilityContext } from '@/providers/ability-context'
import { PLAYER_PLAY_DEDUP_MS } from '@/lib/constants'
import { EVENTS, TIMING } from '@music-together/shared'
import type { PlayMode, Track, VoteAction } from '@music-together/shared'

/**
 * 舞台控制条的行为层。
 *
 * 3D（Mineradio）与 Folia 两族共用这里的权限、投票、乐观播放、跳过冷却与
 * seek 逻辑；视觉部分各自实现（`MineradioControlBar` 长条 /
 * `FoliaControlBar` 胶囊）。
 */

export const PLAY_MODE_CYCLE: PlayMode[] = ['sequential', 'loop-all', 'loop-one', 'shuffle']

export const PLAY_MODE_CONFIG: Record<PlayMode, { label: string; icon: typeof Repeat }> = {
  sequential: { icon: ArrowRightToLine, label: '顺序播放' },
  'loop-all': { icon: Repeat, label: '列表循环' },
  'loop-one': { icon: Repeat1, label: '单曲循环' },
  shuffle: { icon: Shuffle, label: '随机播放' },
}

/**
 * 播放/暂停的乐观状态。
 *
 * `isPlaying` 只在 Howler 的 onplay/onpause 回调里更新，而暂停要走一整条
 * WebSocket 往返。在这段窗口里按钮仍显示"暂停"图标，用户会以为没点动。
 * 这里记一个短暂预期值，服务端权威值一旦到达预期就立刻让位；未确认时靠
 * 超时兜底回到权威值。
 */
function useOptimisticPlaying(isPlaying: boolean) {
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
      timerRef.current = window.setTimeout(() => {
        setIntentState(null)
        timerRef.current = null
      }, PLAYER_PLAY_DEDUP_MS)
    },
    [isPlaying],
  )

  const reachedIntent = intent !== null && isPlaying === intent.value
  const effectivePlaying = intent !== null && !reachedIntent ? intent.value : isPlaying

  return { effectivePlaying, setIntent }
}

export interface StageTransportProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

export interface TransportActions {
  currentTrack: Track | null
  disabled: boolean
  playing: boolean
  playMode: PlayMode
  canPlay: boolean
  canVote: boolean
  canSeek: boolean
  canSetMode: boolean
  /** 该方向是否可直发（否则退回投票）。 */
  canPrev: boolean
  canNext: boolean
  skipCooldown: boolean
  playCooldown: boolean
  queueLength: number
  volume: number
  setVolume: (v: number) => void
  toggleMute: () => void
  onSeek: (time: number) => void
  handlePlayPause: () => void
  handleSkip: (dir: 'prev' | 'next') => void
  handlePlayModeToggle: () => void
}

export function useTransportActions({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onStartVote,
}: StageTransportProps): TransportActions {
  const ability = useContext(AbilityContext)
  const { socket } = useSocketContext()
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const queueLength = useRoomStore((s) => s.room?.queue?.length ?? 0)
  const playMode = useRoomStore((s) => s.room?.playMode ?? 'sequential')

  const canSetMode = ability.can('set-mode', 'Player')
  const canVote = ability.can('vote', 'Player')
  const canSeek = ability.can('seek', 'Player')
  const canPlay = ability.can('play', 'Player')
  const canPrev = ability.can('prev', 'Player')
  const canNext = ability.can('next', 'Player')
  const disabled = !currentTrack

  const [skipCooldown, setSkipCooldown] = useState(false)
  const [playCooldown, setPlayCooldown] = useState(false)
  const skipCooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const playCooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const prevVolumeRef = useRef(0.8)

  useEffect(() => {
    return () => {
      if (skipCooldownTimer.current) clearTimeout(skipCooldownTimer.current)
      if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    }
  }, [])

  const { effectivePlaying, setIntent } = useOptimisticPlaying(isPlaying)

  const toggleMute = useCallback(() => {
    if (volume === 0) setVolume(prevVolumeRef.current)
    else {
      prevVolumeRef.current = volume
      setVolume(0)
    }
  }, [volume, setVolume])

  const handlePlayPause = useCallback(() => {
    if (playCooldown || disabled || (!canPlay && !canVote)) return
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
    playCooldownTimer.current = setTimeout(() => setPlayCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
  }, [playCooldown, disabled, canPlay, canVote, effectivePlaying, setIntent, onPlay, onPause, onStartVote])

  /**
   * 上一首 / 下一首必须走权限判定：直接绑 `onNext` 等于让普通成员绕过服务端
   * 权威与投票机制。
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
      skipCooldownTimer.current = setTimeout(() => setSkipCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
    },
    [skipCooldown, disabled, ability, canVote, onNext, onPrev, onStartVote],
  )

  const handlePlayModeToggle = useCallback(() => {
    const idx = PLAY_MODE_CYCLE.indexOf(playMode)
    const next = PLAY_MODE_CYCLE[(idx + 1) % PLAY_MODE_CYCLE.length]
    // 能直接改就直发，否则走投票；两个分支反了会让房主发起自己无权投的票。
    if (canSetMode) {
      socket.emit(EVENTS.PLAYER_SET_MODE, { mode: next })
    } else if (canVote) {
      onStartVote('set-mode', { mode: next })
    }
  }, [playMode, canSetMode, canVote, onStartVote, socket])

  return {
    currentTrack,
    disabled,
    playing: effectivePlaying,
    playMode,
    canPlay,
    canVote,
    canSeek,
    canSetMode,
    canPrev,
    canNext,
    skipCooldown,
    playCooldown,
    queueLength,
    volume,
    setVolume,
    toggleMute,
    onSeek,
    handlePlayPause,
    handleSkip,
    handlePlayModeToggle,
  }
}
