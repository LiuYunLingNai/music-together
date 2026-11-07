import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { PLATFORM_LABELS } from '@/lib/platform'
import { playbackFailureCopy, type PlaybackFailureTone } from '@/lib/playbackFailureText'
import { cn } from '@/lib/utils'
import { useSocketContext } from '@/providers/socket-context'
import { useManualFallbackStore } from '@/stores/manualFallbackStore'
import { usePlaybackFailureStore } from '@/stores/playbackFailureStore'
import { useRoomStore } from '@/stores/roomStore'
import { EVENTS, type PlaybackFailureEvent } from '@music-together/shared'
import {
  Ban,
  CircleAlert,
  Clock3,
  Crown,
  FileAudio,
  Gauge,
  LogIn,
  MapPinOff,
  ShoppingCart,
  SkipForward,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

const TONE: Record<PlaybackFailureTone, { bar: string; icon: string; ring: string }> = {
  amber: { bar: 'bg-amber-500', icon: 'bg-amber-500/10 text-amber-500', ring: 'ring-amber-500/20' },
  red: { bar: 'bg-rose-500', icon: 'bg-rose-500/10 text-rose-500', ring: 'ring-rose-500/20' },
  sky: { bar: 'bg-sky-500', icon: 'bg-sky-500/10 text-sky-500', ring: 'ring-sky-500/20' },
}

const REASON_ICON: Record<string, LucideIcon> = {
  'sign-in-needed': LogIn,
  'subscription-required': Crown,
  'purchase-required': ShoppingCart,
  'region-restricted': MapPinOff,
  'taken-down': Ban,
  'no-audio': FileAudio,
  'not-playable': CircleAlert,
  'unsupported-quality': Gauge,
  'upstream-unreachable': WifiOff,
  'rate-limited': Clock3,
  unknown: CircleAlert,
}

function formatWait(ms?: number): string | null {
  if (!ms || ms <= 0) return null
  const seconds = Math.ceil(ms / 1000)
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`
}

function FailureContent({
  failure,
  onOpenSettings,
  onClose,
}: {
  failure: PlaybackFailureEvent
  onOpenSettings: (tab: 'accounts') => void
  onClose: () => void
}) {
  const { socket } = useSocketContext()
  const copy = playbackFailureCopy(failure.failure, PLATFORM_LABELS[failure.failure.source])
  const tone = TONE[copy.tone]
  const Icon = REASON_ICON[failure.failure.reason] ?? CircleAlert
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [remainingMs, setRemainingMs] = useState<number | null>(failure.autoActionInMs ?? null)

  useEffect(() => {
    if (!failure.autoActionInMs) return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const left = failure.autoActionInMs! - (Date.now() - startedAt)
      setRemainingMs(Math.max(0, left))
      if (left <= 0) clearInterval(timer)
    }, 200)
    return () => clearInterval(timer)
  }, [failure.autoActionInMs])

  const retry = (degrade: boolean) => {
    socket.emit(EVENTS.PLAYER_RETRY_TRACK, { trackId: failure.trackId, degrade })
    onClose()
  }
  const skip = () => {
    socket.emit(EVENTS.PLAYER_NEXT, { trackId: failure.trackId })
    onClose()
  }
  const switchSource = () => {
    useManualFallbackStore.getState().open(failure.track)
    onClose()
  }
  const login = () => {
    onOpenSettings('accounts')
    onClose()
  }

  const primary =
    copy.primary === 'login'
      ? { label: '登录账号', onClick: login }
      : copy.primary === 'switch'
        ? { label: '换个音源', onClick: switchSource }
        : copy.primary === 'skip'
          ? { label: '跳过这首', onClick: skip }
          : {
              label: failure.failure.reason === 'unsupported-quality' ? '降低音质重试' : '重试',
              onClick: () => retry(failure.failure.reason === 'unsupported-quality'),
            }

  return (
    <ResponsiveDialog open onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className={cn('h-1 w-full', tone.bar)} />
        <ResponsiveDialogHeader className="gap-0 px-5 pt-5 pb-0 text-left">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1',
                tone.icon,
                tone.ring,
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {PLATFORM_LABELS[failure.failure.source]}
                </span>
                <span className="text-[11px] text-muted-foreground">播放中断</span>
              </div>
              <ResponsiveDialogTitle className="mt-1 text-base font-semibold">{copy.title}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {copy.note}
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>

        <div className="px-5 pt-4">
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
            <p className="truncate text-sm font-medium">{failure.track.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {failure.track.artist.join(' / ')}
              {failure.track.album ? ` · ${failure.track.album}` : ''}
            </p>
          </div>

          {failure.failure.providerMessage && (
            <blockquote className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <span className="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground/80">
                平台原话
              </span>
              {failure.failure.providerMessage}
              {failure.failure.providerCode ? `（${failure.failure.providerCode}）` : ''}
            </blockquote>
          )}

          <button
            type="button"
            className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? '收起详情' : '查看详情'}
          </button>
          {detailsOpen && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs">
              <dt className="text-muted-foreground">原因</dt>
              <dd className="font-mono">{failure.failure.reason}</dd>
              {failure.failure.providerCode && (
                <>
                  <dt className="text-muted-foreground">平台状态码</dt>
                  <dd className="font-mono">{failure.failure.providerCode}</dd>
                </>
              )}
              {failure.failure.httpStatus && (
                <>
                  <dt className="text-muted-foreground">HTTP</dt>
                  <dd className="font-mono">{failure.failure.httpStatus}</dd>
                </>
              )}
              {formatWait(failure.failure.retryAfterMs) && (
                <>
                  <dt className="text-muted-foreground">建议等待</dt>
                  <dd>{formatWait(failure.failure.retryAfterMs)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">音源</dt>
              <dd>{PLATFORM_LABELS[failure.failure.source]}</dd>
            </dl>
          )}
        </div>

        <ResponsiveDialogFooter className="mt-4 flex-row flex-wrap gap-2 border-t bg-muted/20 px-5 py-3 sm:justify-start">
          <Button size="sm" onClick={primary.onClick}>
            {primary.label}
          </Button>
          {copy.primary !== 'switch' && (
            <Button size="sm" variant="outline" onClick={switchSource}>
              换个音源
            </Button>
          )}
          {copy.primary !== 'retry' && (
            <Button size="sm" variant="outline" onClick={() => retry(false)}>
              重试
            </Button>
          )}
          {copy.primary !== 'skip' && (
            <Button size="sm" variant="ghost" onClick={skip}>
              <SkipForward className="mr-1 h-3.5 w-3.5" />
              跳过
            </Button>
          )}
        </ResponsiveDialogFooter>

        {remainingMs !== null && failure.nextAction === 'skip' && (
          <div className="border-t bg-muted/30 px-5 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>将在 {Math.ceil(remainingMs / 1000)} 秒后自动跳过</span>
              <span>选择换源或重试可取消</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-[width] duration-200', tone.bar)}
                style={{
                  width: `${failure.autoActionInMs ? (remainingMs / failure.autoActionInMs) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

export function PlaybackFailureDialog({ onOpenSettings }: { onOpenSettings: (tab: 'accounts') => void }) {
  const failure = usePlaybackFailureStore((state) => state.failure)
  const dismiss = usePlaybackFailureStore((state) => state.dismiss)
  const currentTrackId = useRoomStore((state) => state.room?.currentTrack?.id)

  useEffect(() => {
    if (!failure || !currentTrackId || currentTrackId === failure.trackId) return
    dismiss()
  }, [currentTrackId, failure, dismiss])

  if (!failure) return null
  return (
    <FailureContent
      key={`${failure.trackId}:${failure.failure.reason}:${failure.failure.providerCode ?? ''}`}
      failure={failure}
      onOpenSettings={onOpenSettings}
      onClose={dismiss}
    />
  )
}
