import { useMemo, useState } from 'react'
import { Check, Flame, Loader2, Music2, Plus, RefreshCw, X } from 'lucide-react'
import type { HotSongsSource, Track } from '@music-together/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHotSongs } from '@/hooks/useHotSongs'
import { cn, trackKey } from '@/lib/utils'
import { useRoomStore } from '@/stores/roomStore'
import { toast } from 'sonner'

interface HotSongsPanelProps {
  roomId: string
  onAddTrack: (track: Track) => void
  onCollapse?: () => void
  className?: string
  enabled?: boolean
}

const EMPTY_QUEUE: Track[] = []
const SOURCE_STORAGE_KEY = 'music-together:hot-songs-source'
const SOURCE_ORDER: HotSongsSource[] = ['netease', 'tencent', 'kugou']
const SOURCE_LABELS: Record<HotSongsSource, string> = {
  netease: '网易',
  tencent: 'QQ',
  kugou: '酷狗',
}

function readStoredSource(): HotSongsSource {
  try {
    const value = localStorage.getItem(SOURCE_STORAGE_KEY)
    if (value === 'netease' || value === 'tencent' || value === 'kugou') return value
  } catch {
    // localStorage may be unavailable in private mode.
  }
  return 'netease'
}

function storeSource(source: HotSongsSource) {
  try {
    localStorage.setItem(SOURCE_STORAGE_KEY, source)
  } catch {
    // Keep the in-memory choice when localStorage is unavailable.
  }
}

export function HotSongsPanel({ roomId, onAddTrack, onCollapse, className, enabled = true }: HotSongsPanelProps) {
  const [source, setSource] = useState<HotSongsSource>(readStoredSource)
  const { tracks, name, loading, loadingMore, hasMore, error, refresh, loadMore } = useHotSongs(
    roomId,
    source,
    30,
    enabled,
  )
  const queue = useRoomStore((state) => state.room?.queue ?? EMPTY_QUEUE)
  const queueKeys = useMemo(() => new Set(queue.map(trackKey)), [queue])

  const handleSourceChange = (value: string) => {
    const nextSource = value as HotSongsSource
    setSource(nextSource)
    storeSource(nextSource)
  }

  const handleAdd = (track: Track) => {
    if (queueKeys.has(trackKey(track))) {
      toast.info(`「${track.title}」已在队列中`)
      return
    }
    onAddTrack(track)
    toast.success(`已提交「${track.title}」`)
  }

  return (
    <section className={cn('mt-card flex h-full min-h-0 flex-col overflow-hidden rounded-2xl', className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Flame className="h-4 w-4 shrink-0 text-orange-400" />
          <h2 className="truncate text-sm font-semibold">{name}</h2>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={refresh}
                disabled={loading}
                aria-label="刷新热歌榜"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新热歌榜</TooltipContent>
          </Tooltip>
          {onCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCollapse} aria-label="收起热歌榜">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>收起热歌榜</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <Tabs
        value={source}
        onValueChange={handleSourceChange}
        className="shrink-0 gap-0 border-b border-border/50 px-2 py-2"
      >
        <TabsList className="grid w-full grid-cols-3">
          {SOURCE_ORDER.map((item) => (
            <TabsTrigger key={item} value={item} className="text-xs">
              {SOURCE_LABELS[item]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onScroll={(event) => {
          const target = event.currentTarget
          if (!error && target.scrollHeight - target.scrollTop - target.clientHeight < 160) loadMore()
        }}
      >
        {loading && tracks.length === 0 && (
          <div className="space-y-2 p-1">
            {Array.from({ length: 8 }, (_, index) => (
              <div className="flex items-center gap-2" key={index}>
                <Skeleton className="h-4 w-5" />
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-2.5 w-3/5" />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && tracks.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">{error}</p>}
        {!loading && !error && tracks.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">暂无热歌</p>
        )}
        <div className="space-y-0.5">
          {tracks.map((track, index) => {
            const added = queueKeys.has(trackKey(track))
            return (
              <div
                className="mt-hot-song-row group flex min-h-14 items-center gap-2 rounded-lg px-1.5 py-1"
                key={`${track.source}:${track.sourceId}`}
                onDoubleClick={() => handleAdd(track)}
              >
                <span
                  className={cn(
                    'w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground',
                    index === 0 && 'text-red-400',
                    index === 1 && 'text-orange-400',
                    index === 2 && 'text-yellow-400',
                  )}
                >
                  {index + 1}
                </span>
                {track.thumbnailCover || track.cover ? (
                  <img
                    src={track.thumbnailCover || track.cover}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-md object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Music2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{track.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{track.artist.join(' / ')}</p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={added ? 'ghost' : 'secondary'}
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleAdd(track)}
                      disabled={added}
                      aria-label={added ? '已在队列中' : '加入队列'}
                    >
                      {added ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Plus className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{added ? '已在队列中' : '加入队列'}</TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>
        {loadingMore && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在加载更多
          </div>
        )}
        {error && tracks.length > 0 && (
          <div className="flex flex-col items-center gap-2 py-4 text-center text-xs text-muted-foreground">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore}>
              重试加载
            </Button>
          </div>
        )}
        {!loading && !loadingMore && !error && tracks.length > 0 && !hasMore && (
          <p className="py-4 text-center text-xs text-muted-foreground">已加载全部 {tracks.length} 首</p>
        )}
      </div>
    </section>
  )
}
