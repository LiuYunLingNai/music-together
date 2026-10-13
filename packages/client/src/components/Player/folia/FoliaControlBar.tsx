import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { VoteState } from '@music-together/shared'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { VoteBanner } from '../../Vote/VoteBanner'
import { Transport, type TransportProps } from '../stages/Transport'
import { FoliaSettingsPopover } from './FoliaSettingsPopover'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, Settings2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type FoliaControlBarProps = Omit<
  TransportProps,
  'variant' | 'showProgress' | 'onSettings' | 'settingsButton'
> & {
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
        const openPanel = document.querySelector(
          '[data-slot="popover-content"][data-state="open"], [data-slot="dialog-content"][data-state="open"]',
        )
        if (keyboardFocus || openPanel) schedule()
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

export function FoliaControlBar({ activeVote, onCastVote, ...transport }: FoliaControlBarProps) {
  const settings = useSettingsStore((s) => s.foliaSettings)
  const setSettings = useSettingsStore((s) => s.setFoliaSettings)
  const playing = usePlayerStore((s) => s.isPlaying)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const idle = useChromeIdle(settings.autoHide && playing && !settingsOpen && !activeVote && !settings.manualHide)
  const hidden = settings.manualHide || idle
  const visibilityLabel = settings.manualHide ? '恢复播放栏' : '隐藏播放栏'
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
              {settings.manualHide ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{visibilityLabel}</TooltipContent>
        </Tooltip>
      </div>
      <div
        className="folia-console"
        data-hidden={hidden || undefined}
        data-expanded={settings.alwaysExpand || undefined}
        style={{ '--folia-bar-offset': `${settings.barOffset}px` } as CSSProperties}
      >
        {activeVote && (
          <div className="folia-vote">
            <VoteBanner vote={activeVote} onCastVote={onCastVote} />
          </div>
        )}
        {!settings.manualHide && (
          <div className="folia-console__inner" tabIndex={0} role="group" aria-label="Folia 播放控制">
            <Transport
              {...transport}
              variant="folia"
              showProgress={settings.showProgress}
              settingsButton={
                <FoliaSettingsPopover open={settingsOpen} onOpenChange={setSettingsOpen} side="top">
                  <Button variant="ghost" size="icon" className="mt-mr-btn" aria-label="Folia 播放器设置">
                    <Settings2 className="size-4" />
                  </Button>
                </FoliaSettingsPopover>
              }
            />
          </div>
        )}
      </div>
    </>
  )
}
