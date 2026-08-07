import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { BilibiliMetadataDialog } from '@/components/Overlays/BilibiliMetadataDialog'
import { VirtualTrackList } from '@/components/VirtualTrackList'
import { trackKey } from '@/lib/utils'
import { useRoomStore } from '@/stores/roomStore'
import type { BilibiliMetadataSource, Playlist, Track } from '@music-together/shared'
import { LIMITS } from '@music-together/shared'
import { ArrowLeft, ListPlus, Loader2, Music } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

const EMPTY_QUEUE: Track[] = []
type BilibiliQueueAction = 'add' | 'insert'

interface PlaylistDetailProps {
  playlist: Playlist | null
  tracks: Track[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  total: number
  onBack: () => void
  onAddTrack: (track: Track) => void
  onInsertAfterCurrent?: (track: Track) => void
  onAddAll: (tracks: Track[], playlistName?: string) => void
  onLoadAll: () => Promise<Track[]>
  onLoadMore: () => void
}

export function PlaylistDetail({
  playlist,
  tracks,
  loading,
  loadingMore,
  hasMore,
  total,
  onBack,
  onAddTrack,
  onInsertAfterCurrent,
  onAddAll,
  onLoadAll,
  onLoadMore,
}: PlaylistDetailProps) {
  const queue = useRoomStore((s) => s.room?.queue ?? EMPTY_QUEUE)
  const roomId = useRoomStore((s) => s.room?.id)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [addingAll, setAddingAll] = useState(false)
  const [bilibiliMatch, setBilibiliMatch] = useState<{ track: Track; action: BilibiliQueueAction } | null>(null)
  const queueKeys = useMemo(() => new Set(queue.map(trackKey)), [queue])

  const isTrackAdded = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      return addedIds.has(key) || queueKeys.has(key)
    },
    [addedIds, queueKeys],
  )

  const handleAddTrack = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
        toast.info(`「${track.title}」已在队列中`)
        return
      }
      if (track.source === 'bilibili') {
        setBilibiliMatch({ track, action: 'add' })
        return
      }
      onAddTrack(track)
      setAddedIds((prev) => new Set(prev).add(key))
    },
    [onAddTrack, queueKeys, addedIds],
  )

  const handleInsertAfterCurrent = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
        toast.info(`「${track.title}」已在队列中`)
        return
      }
      if (track.source === 'bilibili') {
        setBilibiliMatch({ track, action: 'insert' })
        return
      }
      onInsertAfterCurrent?.(track)
      setAddedIds((prev) => new Set(prev).add(key))
    },
    [onInsertAfterCurrent, queueKeys, addedIds],
  )

  // Dynamic "add all" logic — filter duplicates
  const availableSlots = LIMITS.QUEUE_MAX_SIZE - queue.length
  const uniqueTracks = useMemo(() => {
    const seen = new Set([...queueKeys, ...addedIds])
    return tracks.filter((track) => {
      const key = trackKey(track)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [tracks, queueKeys, addedIds])
  const addCount = Math.min(availableSlots, uniqueTracks.length)
  const isQueueFull = availableSlots <= 0

  const handleAddAll = useCallback(async () => {
    if (addingAll || isQueueFull) return
    setAddingAll(true)

    try {
      const allTracks = hasMore ? await onLoadAll() : tracks
      const currentQueue = useRoomStore.getState().room?.queue ?? EMPTY_QUEUE
      const seen = new Set(currentQueue.map(trackKey))
      for (const id of addedIds) seen.add(id)

      const tracksToAdd = allTracks.filter((track) => {
        const key = trackKey(track)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      const currentAvailableSlots = LIMITS.QUEUE_MAX_SIZE - currentQueue.length
      const toAdd = tracksToAdd.slice(0, currentAvailableSlots)

      if (toAdd.length === 0) {
        toast.info('歌单中的歌曲已全部在队列中')
        return
      }

      onAddAll(toAdd, playlist?.name)
      setAddedIds((prev) => {
        const next = new Set(prev)
        for (const track of toAdd) next.add(trackKey(track))
        return next
      })

      const skippedCount = tracksToAdd.length - toAdd.length
      if (skippedCount > 0) {
        toast.success(`已添加 ${toAdd.length} 首到队列（队列已满，还有 ${skippedCount} 首未添加）`)
      } else {
        toast.success(`已添加歌单全部 ${toAdd.length} 首到队列`)
      }
    } catch {
      toast.error('完整歌单加载失败，请重试')
    } finally {
      setAddingAll(false)
    }
  }, [addingAll, isQueueFull, hasMore, onLoadAll, tracks, addedIds, onAddAll, playlist?.name])

  const applyBilibiliMetadataMatch = useCallback(
    (metadataTrack: Track, metadataSource: BilibiliMetadataSource) => {
      if (!bilibiliMatch) return
      const track = {
        ...bilibiliMatch.track,
        metadataSource,
        lyricId: metadataTrack.lyricId,
        picId: metadataTrack.picId,
        cover: metadataTrack.cover || bilibiliMatch.track.cover,
      }
      if (bilibiliMatch.action === 'insert') onInsertAfterCurrent?.(track)
      else onAddTrack(track)
      setAddedIds((prev) => new Set(prev).add(trackKey(track)))
      setBilibiliMatch(null)
    },
    [bilibiliMatch, onAddTrack, onInsertAfterCurrent],
  )

  const skipBilibiliMetadataMatch = useCallback(() => {
    if (!bilibiliMatch) return
    if (bilibiliMatch.action === 'insert') onInsertAfterCurrent?.(bilibiliMatch.track)
    else onAddTrack(bilibiliMatch.track)
    setAddedIds((prev) => new Set(prev).add(trackKey(bilibiliMatch.track)))
    setBilibiliMatch(null)
  }, [bilibiliMatch, onAddTrack, onInsertAfterCurrent])

  // Button label
  let addAllLabel: string
  if (loading) {
    addAllLabel = '加载中…'
  } else if (addingAll) {
    addAllLabel = '正在加载全部…'
  } else if (tracks.length === 0) {
    addAllLabel = '添加全部'
  } else if (isQueueFull) {
    addAllLabel = '队列已满'
  } else if (!hasMore && uniqueTracks.length === 0) {
    addAllLabel = '全部已添加'
  } else if (hasMore) {
    addAllLabel = `添加全部 ${Math.min(availableSlots, total)} 首`
  } else if (addCount === uniqueTracks.length) {
    addAllLabel = `添加全部 ${addCount} 首`
  } else {
    addAllLabel = `添加 ${addCount} 首到队列`
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Row 1: Back + Title — pr-8 reserves space for dialog close button */}
      <div className="flex shrink-0 items-center gap-2 pr-8">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{playlist?.name ?? '歌单详情'}</h4>
      </div>

      {/* Row 2: Info + Action */}
      <div className="flex shrink-0 items-center justify-between gap-3 py-1">
        <p className="text-muted-foreground text-xs">
          {loading
            ? '加载中…'
            : `${total} 首${tracks.length < total ? `（已加载 ${tracks.length}）` : ''}${playlist?.creator ? ` · ${playlist.creator}` : ''}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddAll}
          disabled={loading || loadingMore || addingAll || isQueueFull || (!hasMore && uniqueTracks.length === 0)}
          className="shrink-0 gap-1"
        >
          {addingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
          {addAllLabel}
        </Button>
      </div>

      <Separator className="shrink-0" />

      {/* Track list with shared virtual scrolling component */}
      <VirtualTrackList
        tracks={tracks}
        loading={loading}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        isTrackAdded={isTrackAdded}
        onAddTrack={handleAddTrack}
        onInsertAfterCurrent={onInsertAfterCurrent ? handleInsertAfterCurrent : undefined}
        emptyIcon={<Music className="h-8 w-8" />}
        emptyMessage="歌单为空"
        className="border-0 rounded-none"
      />

      <BilibiliMetadataDialog
        track={bilibiliMatch?.track ?? null}
        roomId={roomId}
        onOpenChange={(open) => !open && setBilibiliMatch(null)}
        onSelect={applyBilibiliMetadataMatch}
        onSkip={skipBilibiliMetadataMatch}
      />
    </div>
  )
}
