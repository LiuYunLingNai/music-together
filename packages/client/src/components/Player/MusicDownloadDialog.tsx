import type { AudioQuality, DownloadOptionsResponse, DownloadQualityOption } from '@music-together/shared'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { SERVER_URL } from '@/lib/config'
import { getAudioQualityLabel } from '@/lib/audioQuality'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'

interface MusicDownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function optionDetails(option: DownloadQualityOption): string {
  return [option.format, option.actualBitrate ? `${option.actualBitrate} kbps` : null, formatFileSize(option.fileSize)]
    .filter(Boolean)
    .join(' · ')
}

export function MusicDownloadDialog({ open, onOpenChange }: MusicDownloadDialogProps) {
  const roomId = useRoomStore((state) => state.room?.id)
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const [options, setOptions] = useState<DownloadQualityOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open || !roomId || !currentTrack) return
    const controller = new AbortController()
    const trackId = currentTrack.id
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setLoading(true)
      setError(null)
      setOptions([])

      const params = new URLSearchParams({ roomId, trackId })
      void fetch(`${SERVER_URL}/api/music/download-options?${params}`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as
            | (DownloadOptionsResponse & { error?: string })
            | null
          if (!response.ok) throw new Error(body?.error ?? '获取下载音质失败')
          if (!body || body.trackId !== trackId) throw new Error('当前歌曲已切换')
          setOptions(body.options)
        })
        .catch((fetchError: unknown) => {
          if (controller.signal.aborted) return
          setError(fetchError instanceof Error ? fetchError.message : '获取下载音质失败')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    })

    return () => controller.abort()
  }, [open, roomId, currentTrack, reloadKey])

  const startDownload = useCallback(
    (quality: AudioQuality) => {
      if (!roomId || !currentTrack) return
      const params = new URLSearchParams({ roomId, trackId: currentTrack.id, quality: String(quality) })
      const anchor = document.createElement('a')
      anchor.href = `${SERVER_URL}/api/music/download?${params}`
      anchor.download = ''
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      onOpenChange(false)
      toast.success('已开始下载')
    },
    [currentTrack, onOpenChange, roomId],
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>下载音乐</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="line-clamp-2">
            {currentTrack ? `${currentTrack.title} · ${currentTrack.artist.join(' / ')}` : '暂无歌曲'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          {loading ? (
            <div className="flex min-h-36 items-center justify-center" role="status" aria-label="正在获取可用音质">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                <RefreshCw />
                重试
              </Button>
            </div>
          ) : options.length === 0 ? (
            <div className="flex min-h-36 items-center justify-center text-sm text-muted-foreground">
              暂无可下载音质
            </div>
          ) : (
            <div className="divide-y divide-border/60 border-y border-border/60">
              {[...options].reverse().map((option) => {
                const label = getAudioQualityLabel(option.quality)
                const details = optionDetails(option)
                return (
                  <button
                    type="button"
                    key={String(option.quality)}
                    className="flex min-h-16 w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => startDownload(option.quality)}
                    aria-label={`下载 ${label}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      {details && <div className="mt-0.5 text-xs text-muted-foreground">{details}</div>}
                    </div>
                    <Download className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                )
              })}
            </div>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
