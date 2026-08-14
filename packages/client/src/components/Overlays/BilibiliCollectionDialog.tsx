import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Input } from '@/components/ui/input'
import { VirtualTrackList } from '@/components/VirtualTrackList'
import { SERVER_URL } from '@/lib/config'
import type { Track } from '@music-together/shared'
import { ListMusic, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

interface BilibiliCollectionDialogProps {
  track: Track | null
  onOpenChange: (open: boolean) => void
  onSelectTrack: (track: Track) => void
  onNotCollection: () => void
  isTrackAdded: (track: Track) => boolean
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
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
  const [query, setQuery] = useState('')
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null)
  const [queryTrackId, setQueryTrackId] = useState<string | null>(null)

  const currentTrackId = track?.id ?? null
  const hasCurrentResult = Boolean(currentTrackId && loadedTrackId === currentTrackId)
  const currentTitle = hasCurrentResult ? title : ''
  const currentQuery = currentTrackId && queryTrackId === currentTrackId ? query : ''
  const loading = Boolean(track) && !hasCurrentResult

  const filteredTracks = useMemo(() => {
    const currentTracks = hasCurrentResult ? tracks : []
    const keyword = normalizeSearchText(currentQuery)
    if (!keyword) return currentTracks

    return currentTracks.filter((collectionTrack) =>
      [collectionTrack.title, collectionTrack.album, ...collectionTrack.artist]
        .filter(Boolean)
        .some((value) => normalizeSearchText(value).includes(keyword)),
    )
  }, [currentQuery, hasCurrentResult, tracks])

  useEffect(() => {
    if (!track) return

    const controller = new AbortController()
    const requestedTrackId = track.id

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
        setLoadedTrackId(requestedTrackId)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        toast.error('读取 B 站合集失败，已按单视频处理')
        onNotCollection()
      })
    return () => controller.abort()
  }, [track, onNotCollection])

  return (
    <ResponsiveDialog open={Boolean(track)} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex h-dvh max-h-dvh flex-col overflow-hidden sm:h-auto sm:max-h-[80vh] sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{currentTitle ? `合集：${currentTitle}` : '正在读取合集…'}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={currentQuery}
              onChange={(event) => {
                setQueryTrackId(currentTrackId)
                setQuery(event.target.value)
              }}
              placeholder="搜索视频、作者或专辑..."
              aria-label="搜索合集内容"
              className="pl-9"
            />
          </div>
          <VirtualTrackList
            tracks={filteredTracks}
            loading={loading}
            hasMore={false}
            loadingMore={false}
            onLoadMore={() => undefined}
            isTrackAdded={isTrackAdded}
            onAddTrack={onSelectTrack}
            emptyIcon={<ListMusic className="h-8 w-8" />}
            emptyMessage={currentQuery.trim() ? '没有匹配的视频' : '合集内没有可播放的视频'}
          />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
