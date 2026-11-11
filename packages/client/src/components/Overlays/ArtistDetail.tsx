import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VirtualTrackList } from '@/components/VirtualTrackList'
import type { ArtistLoadError } from '@/hooks/useArtist'
import { getDirectCoverUrl } from '@/lib/cover'
import { useQueueMembership } from '@/hooks/useQueueMembership'
import type { Artist, Playlist, Track } from '@music-together/shared'
import { Disc3, ListPlus, Loader2, Music2, User } from 'lucide-react'
import { useState } from 'react'
import { CollectionRow } from './CoverCard'

const ERROR_MESSAGES: Record<ArtistLoadError, string> = {
  unsupported: '当前平台暂不支持歌手主页',
  'not-found': '没有找到这位歌手',
  failed: '加载失败，请稍后重试',
}

interface ArtistDetailProps {
  artist: Artist | null
  loading: boolean
  error: ArtistLoadError | null
  songs: Track[]
  songsTotal: number
  songsHasMore: boolean
  songsLoadingMore: boolean
  albums: Playlist[]
  albumsHasMore: boolean
  albumsLoadingMore: boolean
  onRetry: () => void
  onAddTrack: (track: Track) => void
  onInsertAfterCurrent?: (track: Track) => void
  onAddAll: (tracks: Track[], name?: string) => void
  onLoadMoreSongs: () => void
  onLoadMoreAlbums: () => void
  onSelectAlbum: (album: Playlist) => void
}

function ArtistHeader({ artist, loading }: { artist: Artist | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const avatar = artist?.thumbnailCover || artist?.cover
  const description = artist?.description
  const counts = [
    artist?.songCount != null ? `${artist.songCount} 首歌曲` : null,
    artist?.albumCount != null ? `${artist.albumCount} 张专辑` : null,
  ].filter(Boolean)
  return (
    <div className="flex shrink-0 gap-3 py-2">
      <Avatar className="size-14 sm:size-16">
        {avatar ? <AvatarImage src={getDirectCoverUrl(avatar)} alt={artist?.name} referrerPolicy="no-referrer" /> : null}
        <AvatarFallback>
          <User className="h-6 w-6" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        {counts.length > 0 ? <p className="text-muted-foreground text-xs">{counts.join(' · ')}</p> : null}
        {description ? (
          <div>
            <p className={expanded ? 'text-xs whitespace-pre-line' : 'line-clamp-2 text-xs'}>{description}</p>
            {description.length > 60 ? (
              <button type="button" className="text-primary mt-0.5 text-xs" onClick={() => setExpanded((v) => !v)}>
                {expanded ? '收起' : '展开'}
              </button>
            ) : null}
          </div>
        ) : loading ? (
          <Skeleton className="h-3 w-2/3" />
        ) : null}
      </div>
    </div>
  )
}

/** 歌手主页主体：资料、热门歌曲（无限滚动、全部添加）与专辑。 */
export function ArtistDetail({
  artist,
  loading,
  error,
  songs,
  songsTotal,
  songsHasMore,
  songsLoadingMore,
  albums,
  albumsHasMore,
  albumsLoadingMore,
  onRetry,
  onAddTrack,
  onInsertAfterCurrent,
  onAddAll,
  onLoadMoreSongs,
  onLoadMoreAlbums,
  onSelectAlbum,
}: ArtistDetailProps) {
  const [tab, setTab] = useState<'songs' | 'albums'>('songs')
  const { isAdded: isTrackAdded, markPending: markAdded } = useQueueMembership()
  const pending = songs.filter((track) => !isTrackAdded(track))

  if (error) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 py-8 text-sm">
        <span>{ERROR_MESSAGES[error]}</span>
        {error === 'failed' ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ArtistHeader artist={artist} loading={loading} />

      <div className="flex shrink-0 items-center gap-2">
        <Tabs value={tab} onValueChange={(value) => setTab(value as 'songs' | 'albums')} className="min-w-0 flex-1">
          <TabsList className="w-full">
            <TabsTrigger value="songs" className="flex-1 text-xs sm:text-sm">
              热门歌曲{songsTotal > 0 ? ` ${songsTotal}` : ''}
            </TabsTrigger>
            <TabsTrigger value="albums" className="flex-1 text-xs sm:text-sm">
              专辑
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === 'songs' ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={pending.length === 0}
            onClick={() => {
              onAddAll(pending, artist?.name)
              markAdded(pending)
            }}
          >
            <ListPlus className="mr-1 h-4 w-4" />
            全部添加
          </Button>
        ) : null}
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {tab === 'songs' ? (
          <VirtualTrackList
            tracks={songs}
            loading={loading && songs.length === 0}
            hasMore={songsHasMore}
            loadingMore={songsLoadingMore}
            onLoadMore={onLoadMoreSongs}
            isTrackAdded={isTrackAdded}
            onAddTrack={(track) => {
              onAddTrack(track)
              markAdded([track])
            }}
            onInsertAfterCurrent={
              onInsertAfterCurrent &&
              ((track) => {
                onInsertAfterCurrent(track)
                markAdded([track])
              })
            }
            emptyIcon={<Music2 className="h-8 w-8" />}
            emptyMessage="暂无歌曲"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-2">
            {loading && albums.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            ) : albums.length === 0 ? (
              <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2">
                <Disc3 className="h-8 w-8" />
                <span className="text-sm">暂无专辑</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {albums.map((album) => (
                  <CollectionRow
                    key={album.id}
                    title={album.name}
                    subtitle={`${album.trackCount} 首${album.creator ? ` · ${album.creator}` : ''}`}
                    cover={album.thumbnailCover ?? album.cover}
                    fallback={<Disc3 className="text-muted-foreground size-5" />}
                    onClick={() => onSelectAlbum(album)}
                  />
                ))}
                {albumsHasMore ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={onLoadMoreAlbums}
                    disabled={albumsLoadingMore}
                  >
                    {albumsLoadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {albumsLoadingMore ? '加载中...' : '加载更多'}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
