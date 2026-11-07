import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SERVER_URL } from '@/lib/config'
import { formatDuration } from '@/lib/format'
import { PLATFORM_LABELS } from '@/lib/platform'
import { useSocketContext } from '@/providers/socket-context'
import { useManualFallbackStore } from '@/stores/manualFallbackStore'
import { EVENTS, type Track } from '@music-together/shared'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface FallbackCandidate {
  track: Track
  score: number
}

export function ManualFallbackDialog() {
  const track = useManualFallbackStore((state) => state.track)
  const close = useManualFallbackStore((state) => state.close)
  const { socket } = useSocketContext()
  const [candidates, setCandidates] = useState<FallbackCandidate[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!track) {
      setCandidates([])
      return
    }
    let alive = true
    setLoading(true)
    const params = new URLSearchParams({
      source: track.source,
      title: track.title,
      duration: String(track.duration),
    })
    if (track.album) params.set('album', track.album)
    for (const artist of track.artist) params.append('artists', artist)

    void fetch(`${SERVER_URL}/api/music/fallback-candidates?${params}`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('lookup failed')
        const data = (await response.json()) as { candidates?: FallbackCandidate[] }
        if (alive) setCandidates(data.candidates ?? [])
      })
      .catch(() => {
        if (alive) setCandidates([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [track])

  const useCandidate = (candidate: FallbackCandidate) => {
    if (!track || !socket) return
    socket.emit(EVENTS.PLAYER_SOURCE_SWITCH, { trackId: track.id, track: candidate.track })
    toast.loading(`正在切换到${PLATFORM_LABELS[candidate.track.source]}…`, {
      id: 'manual-source-switch',
      duration: 8_000,
    })
    close()
  }

  return (
    <ResponsiveDialog open={Boolean(track)} onOpenChange={(next) => !next && close()}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>手动换源</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {track ? `${track.title} · ${track.artist.join(' / ')}，选择其他平台的同一首歌` : ''}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">正在查找其他音源…</p>
          ) : candidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">没有找到可信的其他平台音源。</p>
          ) : (
            <ScrollArea className="max-h-[50vh]">
              <div className="space-y-2 pr-2">
                {candidates.map((candidate) => (
                  <button
                    key={`${candidate.track.source}:${candidate.track.sourceId}`}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-left hover:bg-muted/70"
                    onClick={() => useCandidate(candidate)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {candidate.track.title} · {candidate.track.artist.join(' / ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {PLATFORM_LABELS[candidate.track.source]} · {formatDuration(candidate.track.duration)} · 匹配度{' '}
                        {Math.round(candidate.score)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">使用</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            取消
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
