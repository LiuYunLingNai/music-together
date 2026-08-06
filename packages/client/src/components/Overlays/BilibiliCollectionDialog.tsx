import { ResponsiveDialog, ResponsiveDialogBody, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle } from '@/components/ui/responsive-dialog'
import { VirtualTrackList } from '@/components/VirtualTrackList'
import { SERVER_URL } from '@/lib/config'
import type { Track } from '@music-together/shared'
import { ListMusic } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface BilibiliCollectionDialogProps {
  track: Track | null
  onOpenChange: (open: boolean) => void
  onSelectTrack: (track: Track) => void
  onNotCollection: () => void
  isTrackAdded: (track: Track) => boolean
}

/**
 * Resolves a Bilibili video on demand. If it belongs to a UGC collection,
 * show its individual videos so users choose what to add instead of queuing
 * the whole collection or blindly playing the first video.
 */
export function BilibiliCollectionDialog({
  track,
  onOpenChange,
  onSelectTrack,
  onNotCollection,
  isTrackAdded,
}: BilibiliCollectionDialogProps) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!track) {
      setTracks([])
      setTitle('')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setTracks([])
    setTitle('')
    setLoading(true)

    void fetch(`${SERVER_URL}/api/music/bilibili-collection?bvid=${encodeURIComponent(track.urlId)}`, {
      signal: controller.signal,
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to resolve Bilibili collection')
        return (await response.json()) as { title?: string; tracks?: Track[] }
      })
      .then((data) => {
        if (controller.signal.aborted) return
        const collectionTracks = data.tracks ?? []
        if (collectionTracks.length <= 1) {
          onNotCollection()
          return
        }
        setTitle(data.title || 'B站合集')
        setTracks(collectionTracks)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        toast.error('读取 B 站合集失败，已按单视频处理')
        onNotCollection()
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [track, onNotCollection])

  return (
    <ResponsiveDialog open={Boolean(track)} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex h-dvh max-h-dvh flex-col overflow-hidden sm:h-auto sm:max-h-[80vh] sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title ? `合集：${title}` : '正在读取合集…'}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <VirtualTrackList
            tracks={tracks}
            loading={loading}
            hasMore={false}
            loadingMore={false}
            onLoadMore={() => undefined}
            isTrackAdded={isTrackAdded}
            onAddTrack={onSelectTrack}
            emptyIcon={<ListMusic className="h-8 w-8" />}
            emptyMessage="合集内没有可播放的视频"
          />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
