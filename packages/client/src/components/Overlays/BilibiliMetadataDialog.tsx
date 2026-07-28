import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSearch } from '@/hooks/useSearch'
import { trackKey } from '@/lib/utils'
import type { BilibiliMetadataSource, Track } from '@music-together/shared'
import { Loader2, Music2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'

interface BilibiliMetadataDialogProps {
  track: Track | null
  roomId?: string
  onOpenChange: (open: boolean) => void
  onSelect: (metadataTrack: Track, source: BilibiliMetadataSource) => void
  onSkip: () => void
}

export function BilibiliMetadataDialog({ track, roomId, onOpenChange, onSelect, onSkip }: BilibiliMetadataDialogProps) {
  const [source, setSource] = useState<BilibiliMetadataSource>('netease')
  const trackId = track?.id
  const trackTitle = track?.title
  const [query, setQuery] = useState({ trackId, value: trackTitle ?? '' })
  const keyword = query.trackId === trackId ? query.value : (trackTitle ?? '')
  const { results, loading, loadingMore, hasMore, hasSearched, search, loadMore, resetState } = useSearch(
    source,
    'song',
    roomId,
  )

  useEffect(() => {
    if (!trackTitle) return
    resetState()
    search(trackTitle)
  }, [trackId, trackTitle, source, resetState, search])

  return (
    <ResponsiveDialog open={Boolean(track)} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>选择歌词和封面</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <Tabs value={source} onValueChange={(value) => setSource(value as BilibiliMetadataSource)}>
            <TabsList className="w-full">
              <TabsTrigger value="netease" className="flex-1 text-xs sm:text-sm">
                网易云音乐
              </TabsTrigger>
              <TabsTrigger value="tencent" className="flex-1 text-xs sm:text-sm">
                QQ 音乐
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-2">
            <Input
              value={keyword}
              onChange={(event) => setQuery({ trackId, value: event.target.value })}
              onKeyDown={(event) => event.key === 'Enter' && search(keyword)}
              placeholder="搜索歌曲或歌手..."
              autoFocus
              aria-label="搜索歌词和封面"
            />
            <Button onClick={() => search(keyword)} disabled={loading} aria-label="搜索">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          <Button variant="outline" onClick={onSkip}>
            直接播放 B 站视频
          </Button>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !hasSearched || results.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Music2 className="h-8 w-8" />
                <span className="text-sm">{hasSearched ? '暂无匹配结果' : '搜索后选择一首歌曲'}</span>
              </div>
            ) : (
              <div className="divide-y">
                {(results as Track[]).map((metadataTrack) => (
                  <button
                    key={trackKey(metadataTrack)}
                    className="hover:bg-accent flex w-full min-w-0 items-center gap-3 p-3 text-left transition-colors"
                    onClick={() => onSelect(metadataTrack, source)}
                  >
                    {metadataTrack.cover ? (
                      <img
                        src={metadataTrack.cover}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded">
                        <Music2 className="text-muted-foreground h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{metadataTrack.title}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {metadataTrack.artist.join(' / ')}
                        {metadataTrack.album ? ` · ${metadataTrack.album}` : ''}
                      </p>
                    </div>
                  </button>
                ))}
                {hasMore && (
                  <Button className="m-2 w-[calc(100%-1rem)]" variant="ghost" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? '加载中...' : '加载更多'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
