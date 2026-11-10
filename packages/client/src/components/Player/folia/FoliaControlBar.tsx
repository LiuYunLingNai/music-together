import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { VoteState } from '@music-together/shared'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useHasHover } from '@/hooks/useHasHover'
import { VoteBanner } from '../../Vote/VoteBanner'
import { QualityBadge } from '../QualityBadge'
import {
  QueueButton,
  TransportModeButton,
  TransportPlayButton,
  TransportProgress,
  TransportSkipButton,
  VolumeControl,
} from '../stages/Transport'
import { useTransportActions, type StageTransportProps } from '../stages/useTransportActions'
import { FoliaSettingsPopover } from './FoliaSettingsPopover'
import { useFoliaStyleWindowStore } from './stage/foliaStyleWindowStore'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Settings2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type FoliaControlBarProps = StageTransportProps & {
  onOpenQueue: () => void
  activeVote: VoteState | null
  onCastVote: (approve: boolean) => void
}

/** Idle timers belong to chrome only; they never pause audio or the room timeline. */
function useChromeIdle(enabled: boolean) {
  const [state, setState] = useState({ enabled, idle: false })
  const inputMode = useRef<'pointer' | 'keyboard'>('pointer')
  // Starting a fresh playback/auto-hide session always grants a full idle interval.
  if (state.enabled !== enabled) setState({ enabled, idle: false })
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const active = document.activeElement
        // Pointer clicks also leave focus on buttons after the popover closes.
        // Only keyboard focus or a currently open panel should extend the idle timer.
        const keyboardFocus = inputMode.current === 'keyboard' && active?.closest('.folia-console')
        // 歌词样式窗口是自绘的工作窗口（`.st-window`），不在 radix 的 data-slot 里，单独判断。
        const openPanel = document.querySelector(
          '[data-slot="popover-content"][data-state="open"], [data-slot="dialog-content"][data-state="open"], .st-window',
        )
        if (keyboardFocus || openPanel || useFoliaStyleWindowStore.getState().open) schedule()
        else setState({ enabled, idle: true })
      }, 3000)
    }
    const wake = (event: Event) => {
      if (event.type === 'keydown') inputMode.current = 'keyboard'
      else if (event.type === 'pointermove' || event.type === 'pointerdown') inputMode.current = 'pointer'
      setState((previous) => (previous.idle ? { enabled, idle: false } : previous))
      schedule()
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const
    events.forEach((event) => window.addEventListener(event, wake, true))
    schedule()
    return () => {
      clearTimeout(timer)
      events.forEach((event) => window.removeEventListener(event, wake, true))
    }
  }, [enabled])
  return enabled && state.enabled === enabled && state.idle
}

/** 上游宽版胶囊的布局 spring（CONTROL_LAYOUT_SPRING）。 */
const CONTROL_LAYOUT_SPRING = { type: 'spring' as const, stiffness: 280, damping: 24 }

/**
 * Folia 的播放胶囊，按上游 progress-bar v3 的**宽版**移植：
 *
 * - 收起：一截约 60% 宽的迷你进度胶囊（时间 + 进度 + 时长），高度约 48px；
 * - 悬停/聚焦/触屏点按：spring 展开成约 512px 宽的完整胶囊 —— 左侧播放键、
 *   中间标题行（两侧箭头只在标题区悬停时浮出）与完整进度、右侧播放模式/音量/队列/设置；
 * - 颜色在收起/展开之间过渡，展开没有封面、没有常驻快捷行。
 *
 * 行为层仍全部来自 `Transport`，房间服务端权威 seek 不受影响。
 */
export function FoliaControlBar({ activeVote, onCastVote, onOpenQueue, ...transport }: FoliaControlBarProps) {
  const actions = useTransportActions(transport)
  const settings = useSettingsStore((s) => s.foliaSettings)
  const roomQuality = useRoomStore((s) => s.room?.audioQuality)
  const setSettings = useSettingsStore((s) => s.setFoliaSettings)
  const playing = usePlayerStore((s) => s.isPlaying)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const idle = useChromeIdle(settings.autoHide && playing && !settingsOpen && !activeVote && !settings.manualHide)
  const hidden = settings.manualHide || idle

  const hasHover = useHasHover()
  const reduceMotion = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const capsuleRef = useRef<HTMLDivElement>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveringRef = useRef(false)
  const inputMode = useRef<'pointer' | 'keyboard'>('pointer')

  const cancelCollapse = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = null
  }, [])

  const scheduleCollapse = useCallback(() => {
    if (hoveringRef.current) return
    cancelCollapse()
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null
      if (hoveringRef.current) return
      const active = document.activeElement
      if (active && capsuleRef.current?.contains(active)) return
      if (document.querySelector('[data-slot="popover-content"][data-state="open"]')) return
      setExpanded(false)
    }, 120)
  }, [cancelCollapse])

  useEffect(() => cancelCollapse, [cancelCollapse])

  // 只有键盘移动焦点才自动展开；鼠标点按钮留下的 focus 不应该把刚收起的胶囊再顶开。
  useEffect(() => {
    const onKeyDown = () => {
      inputMode.current = 'keyboard'
    }
    const onPointerDown = () => {
      inputMode.current = 'pointer'
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  // 触屏：展开后点胶囊以外的地方收起。
  useEffect(() => {
    if (!expanded || hasHover) return
    const onPointerDown = (event: PointerEvent) => {
      if (!capsuleRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [expanded, hasHover])

  const handleOpenQueue = useCallback(() => {
    setExpanded(false)
    onOpenQueue()
  }, [onOpenQueue])

  const handleCapsuleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (hasHover) return
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, [role="slider"], [data-slot^="slider"]')
      ) {
        return
      }
      setExpanded((value) => !value)
    },
    [hasHover],
  )

  const track = actions.currentTrack
  const title = track?.title ?? '暂无歌曲'
  const visibilityLabel = settings.manualHide ? '恢复播放栏' : '隐藏播放栏'
  const canNavPrev = !actions.disabled && (actions.canPrev || actions.canVote)
  const canNavNext = !actions.disabled && (actions.canNext || actions.canVote)

  return (
    <>
      <div className="folia-visibility-toggle absolute top-4 z-30">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 rounded-full text-white/65 hover:bg-white/10 hover:text-white"
              aria-label={visibilityLabel}
              aria-pressed={settings.manualHide}
              onClick={() => {
                setSettingsOpen(false)
                setSettings({ manualHide: !settings.manualHide })
              }}
            >
              {settings.manualHide ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{visibilityLabel}</TooltipContent>
        </Tooltip>
      </div>
      <div
        className="folia-console"
        data-hidden={hidden || undefined}
        style={{ '--folia-bar-offset': `${settings.barOffset}px` } as CSSProperties}
      >
        {activeVote && (
          <div className="folia-vote">
            <VoteBanner vote={activeVote} onCastVote={onCastVote} />
          </div>
        )}
        {!settings.manualHide && (
          <div className="folia-console__frame">
            <motion.div
              ref={capsuleRef}
              layout
              transition={{ layout: reduceMotion ? { duration: 0 } : CONTROL_LAYOUT_SPRING }}
              className="folia-console__inner"
              data-expanded={expanded || undefined}
              tabIndex={0}
              role="group"
              aria-label="Folia 播放控制"
              onPointerEnter={() => {
                if (!hasHover) return
                hoveringRef.current = true
                cancelCollapse()
                setExpanded(true)
              }}
              onPointerLeave={() => {
                if (!hasHover) return
                hoveringRef.current = false
                scheduleCollapse()
              }}
              onFocusCapture={() => {
                if (inputMode.current !== 'keyboard') return
                cancelCollapse()
                setExpanded(true)
              }}
              onBlurCapture={(event) => {
                if (capsuleRef.current?.contains(event.relatedTarget as Node | null)) return
                scheduleCollapse()
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                setExpanded(false)
              }}
              onClick={handleCapsuleClick}
            >
              {expanded ? (
                <div className="folia-capsule__expanded">
                  <div className="folia-capsule__play-slot">
                    <TransportPlayButton actions={actions} className="mt-console-play folia-capsule__play-btn" />
                  </div>
                  <div className="folia-capsule__center">
                    <div className="folia-capsule__title-row">
                      <div className="folia-capsule__nav-zone folia-capsule__nav-zone--prev">
                        {canNavPrev && (
                          <TransportSkipButton
                            actions={actions}
                            direction="prev"
                            icon="chevron"
                            className="folia-capsule__nav"
                          />
                        )}
                      </div>
                      <div className="folia-capsule__title">
                        <span className="folia-capsule__title-text">{title}</span>
                        <QualityBadge
                          quality={track?.audioQuality}
                          bitrate={track?.audioBitrate}
                          downgraded={track?.qualityDowngraded}
                          requested={roomQuality}
                          className="folia-capsule__quality"
                        />
                      </div>
                      <div className="folia-capsule__nav-zone folia-capsule__nav-zone--next">
                        {canNavNext && (
                          <TransportSkipButton
                            actions={actions}
                            direction="next"
                            icon="chevron"
                            className="folia-capsule__nav"
                          />
                        )}
                      </div>
                    </div>
                    {settings.showProgress && (
                      <div className="folia-capsule__progress">
                        <TransportProgress
                          disabled={actions.disabled}
                          canSeek={actions.canSeek}
                          onSeek={transport.onSeek}
                        />
                      </div>
                    )}
                  </div>
                  <div className="folia-capsule__slots">
                    <TransportModeButton actions={actions} className="folia-capsule__slot-btn" />
                    <span className="folia-capsule__volume">
                      <VolumeControl actions={actions} />
                    </span>
                    <QueueButton actions={actions} onOpenQueue={handleOpenQueue} />
                    <FoliaSettingsPopover>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="folia-capsule__slot-btn"
                        aria-label="Folia 播放器设置"
                      >
                        <Settings2 className="size-4" />
                      </Button>
                    </FoliaSettingsPopover>
                  </div>
                </div>
              ) : (
                <div className="folia-capsule__collapsed">
                  {settings.showProgress ? (
                    <TransportProgress
                      disabled={actions.disabled}
                      canSeek={actions.canSeek}
                      onSeek={transport.onSeek}
                    />
                  ) : (
                    <span className="folia-capsule__collapsed-title">{title}</span>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </>
  )
}
