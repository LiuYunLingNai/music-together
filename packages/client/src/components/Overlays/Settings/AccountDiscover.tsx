import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CoverCard, CoverGrid } from '@/components/Overlays/CoverCard'
import { useDiscoverHome } from '@/hooks/useDiscoverHome'
import { openArtistPage } from '@/stores/artistPageStore'
import type { MusicSource, Playlist, PlatformRecommendation, Track } from '@music-together/shared'
import { Disc3, ListMusic, Radar, RefreshCw, Sparkles, User } from 'lucide-react'
import { useState, type ReactNode } from 'react'

const COLLAPSED_COUNT = 10

const TRACK_FEED_TITLES: Partial<Record<MusicSource, string>> = {
  netease: '每日推荐',
  tencent: '雷达歌曲',
  bilibili: '推荐视频',
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0">
        <h4 className="truncate text-sm font-semibold">{title}</h4>
        {subtitle ? <p className="text-muted-foreground mt-0.5 truncate text-xs">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Note({ children, onRetry }: { children: string; onRetry?: () => void }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-5 text-sm">
      <span>{children}</span>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          重试
        </Button>
      ) : null}
    </div>
  )
}

function GridSkeleton({ round }: { round?: boolean }) {
  return (
    <CoverGrid>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="space-y-2 p-2">
          <Skeleton className={round ? 'aspect-square w-full rounded-full' : 'aspect-square w-full rounded-lg'} />
          <Skeleton className="mx-auto h-3.5 w-3/4" />
        </div>
      ))}
    </CoverGrid>
  )
}

function ExpandableGrid<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT)
  return (
    <>
      <CoverGrid>{visible.map(render)}</CoverGrid>
      {items.length > COLLAPSED_COUNT ? (
        <Button variant="ghost" size="sm" className="self-center" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `展开全部 ${items.length} 个`}
        </Button>
      ) : null}
    </>
  )
}

interface AccountDiscoverProps {
  platform: MusicSource
  loggedIn: boolean
  /** 当前平台标签是否可见；不可见时不请求公共发现内容。 */
  active: boolean
  recommendation?: PlatformRecommendation
  recommendationsLoading: boolean
  onReloadRecommendations: () => void
  onOpenPlaylist: (playlist: Playlist, type: 'playlist' | 'album') => void
  onOpenTracks: (title: string, tracks: Track[]) => void
  titlePrefix?: string
}

/** 账号主页的推荐与发现区块：平台原生推荐（复用推荐点歌接口）+ 网易云雷达、热门歌手、新碟。 */
export function AccountDiscover({
  platform,
  loggedIn,
  active,
  recommendation,
  recommendationsLoading,
  onReloadRecommendations,
  onOpenPlaylist,
  onOpenTracks,
  titlePrefix = '',
}: AccountDiscoverProps) {
  const discover = useDiscoverHome(platform, active)
  const tracks = recommendation?.tracks ?? []
  const playlists = recommendation?.playlists ?? []
  const feedTitle = TRACK_FEED_TITLES[platform] ?? '推荐歌曲'

  let recommended: ReactNode
  if (!loggedIn) {
    recommended = <Note>登录后查看平台为你推荐的歌曲与歌单</Note>
  } else if (recommendationsLoading && !recommendation) {
    recommended = <GridSkeleton />
  } else if (tracks.length === 0 && playlists.length === 0) {
    recommended = (
      <Note onRetry={onReloadRecommendations}>
        {recommendation?.unavailableReason === 'upstream_unavailable' ? '平台推荐暂时不可用' : '平台暂时没有返回推荐内容'}
      </Note>
    )
  } else {
    const feedTile: Playlist | null =
      tracks.length > 0
        ? {
            id: `feed:${platform}`,
            name: feedTitle,
            cover: tracks[0]!.cover,
            thumbnailCover: tracks[0]!.thumbnailCover,
            trackCount: tracks.length,
            source: platform,
          }
        : null
    recommended = (
      <ExpandableGrid
        items={feedTile ? [feedTile, ...playlists] : playlists}
        render={(playlist) => (
          <CoverCard
            key={playlist.id}
            title={playlist.name}
            subtitle={playlist === feedTile ? `${tracks.length} 首` : playlist.description || `${playlist.trackCount} 首`}
            cover={playlist.thumbnailCover ?? playlist.cover}
            fallback={
              playlist === feedTile ? (
                <Sparkles className="text-muted-foreground size-7" />
              ) : (
                <ListMusic className="text-muted-foreground size-7" />
              )
            }
            onClick={() => (playlist === feedTile ? onOpenTracks(feedTitle, tracks) : onOpenPlaylist(playlist, 'playlist'))}
          />
        )}
      />
    )
  }

  const blockNote = (block: 'radar' | 'artists' | 'albums', label: string) =>
    discover.failed || discover.home.failed.includes(block) ? (
      <Note onRetry={discover.reload}>{`${label}加载失败`}</Note>
    ) : discover.loading ? (
      <GridSkeleton round={block === 'artists'} />
    ) : (
      <Note>暂无内容</Note>
    )

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Section title={`${titlePrefix}为你推荐`} subtitle={loggedIn ? '平台根据你的口味推荐' : undefined}>
        {recommended}
      </Section>

      {discover.supported ? (
        <>
          <Section title="私人雷达" subtitle="为你定制的雷达歌单">
            {discover.home.radar.length > 0
              ? (
                <ExpandableGrid
                  items={discover.home.radar}
                  render={(playlist) => (
                    <CoverCard
                      key={playlist.id}
                      title={playlist.name}
                      subtitle={`${playlist.trackCount} 首`}
                      cover={playlist.thumbnailCover ?? playlist.cover}
                      fallback={<Radar className="text-muted-foreground size-7" />}
                      onClick={() => onOpenPlaylist(playlist, 'playlist')}
                    />
                  )}
                />
              )
              : blockNote('radar', '私人雷达')}
          </Section>
          <Section title="热门歌手">
            {discover.home.artists.length > 0
              ? (
                <ExpandableGrid
                  items={discover.home.artists}
                  render={(artist) => (
                    <CoverCard
                      key={artist.id}
                      title={artist.name}
                      subtitle={artist.songCount != null ? `${artist.songCount} 首歌曲` : undefined}
                      cover={artist.thumbnailCover ?? artist.cover}
                      fallback={<User className="text-muted-foreground size-7" />}
                      round
                      onClick={() => openArtistPage({ source: artist.source, id: artist.id, name: artist.name })}
                    />
                  )}
                />
              )
              : blockNote('artists', '热门歌手')}
          </Section>
          <Section title="新碟上架">
            {discover.home.albums.length > 0
              ? (
                <ExpandableGrid
                  items={discover.home.albums}
                  render={(album) => (
                    <CoverCard
                      key={album.id}
                      title={album.name}
                      subtitle={album.creator || undefined}
                      cover={album.thumbnailCover ?? album.cover}
                      fallback={<Disc3 className="text-muted-foreground size-7" />}
                      onClick={() => onOpenPlaylist(album, 'album')}
                    />
                  )}
                />
              )
              : blockNote('albums', '新碟上架')}
          </Section>
        </>
      ) : null}
    </div>
  )
}
