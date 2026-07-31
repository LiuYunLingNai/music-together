import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VirtualTrackList, type VirtualTrackListRef } from '@/components/VirtualTrackList'
import { PLATFORM_ACTIVE, PLATFORM_TEXT } from '@/lib/platform'
import { cn, trackKey } from '@/lib/utils'
import { useRoomStore } from '@/stores/roomStore'
import { useSearch } from '@/hooks/useSearch'
import { useRecommendations } from '@/hooks/useRecommendations'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSocketContext } from '@/providers/socket-context'
import { EVENTS } from '@music-together/shared'
import type { MusicSource, Track, Playlist } from '@music-together/shared'
import type { BilibiliMetadataSource } from '@music-together/shared'
import { Loader2, Music2, Search, ListMusic, RefreshCw, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { PlaylistDetail } from './Settings/PlaylistDetail'
import { BilibiliMetadataDialog } from './BilibiliMetadataDialog'

const EMPTY_QUEUE: Track[] = []
type BilibiliQueueAction = 'add' | 'insert'
type SearchMode = 'song' | 'album' | 'playlist' | 'recommend'

const SOURCES: { id: MusicSource; label: string }[] = [
  { id: 'netease', label: '网易云' },
  { id: 'tencent', label: 'QQ' },
  { id: 'kugou', label: '酷狗' },
  { id: 'kugou_concept', label: '概念版' },
  { id: 'bilibili', label: 'B站' },
]

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddToQueue: (track: Track) => void
  onInsertAfterCurrent: (track: Track) => void
}

export function SearchDialog({ open, onOpenChange, onAddToQueue, onInsertAfterCurrent }: SearchDialogProps) {
  const [source, setSource] = useState<MusicSource>('netease')
  const [searchType, setSearchType] = useState<SearchMode>('song')
  const [bilibiliMatch, setBilibiliMatch] = useState<{ track: Track; action: BilibiliQueueAction } | null>(null)
  const [keyword, setKeyword] = useState('')
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const listRef = useRef<VirtualTrackListRef>(null)
  const dialogContentRef = useRef<HTMLDivElement>(null)
  const sourceContainerRef = useRef<HTMLDivElement>(null)
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 })
  const queue = useRoomStore((s) => s.room?.queue ?? EMPTY_QUEUE)
  const roomId = useRoomStore((s) => s.room?.id)
  const queueKeys = useMemo(() => new Set(queue.map(trackKey)), [queue])
  const { socket } = useSocketContext()
  const isMobile = useIsMobile()

  // Mobile browsers can pan the visual viewport when the keyboard focuses the
  // search input, which moves even fixed drawers above the visible screen.
  // Keep this search drawer pinned to the actual visible viewport instead.
  useLayoutEffect(() => {
    if (!open || !isMobile) return

    const content = dialogContentRef.current
    const viewport = window.visualViewport
    if (!content || !viewport) return

    let frame = 0
    const syncToVisualViewport = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        content.style.setProperty('top', `${Math.max(0, viewport.offsetTop)}px`, 'important')
        content.style.setProperty('bottom', 'auto', 'important')
        content.style.setProperty('height', `${viewport.height}px`, 'important')
        content.style.setProperty('max-height', `${viewport.height}px`, 'important')
      })
    }

    syncToVisualViewport()
    viewport.addEventListener('resize', syncToVisualViewport)
    viewport.addEventListener('scroll', syncToVisualViewport)

    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', syncToVisualViewport)
      viewport.removeEventListener('scroll', syncToVisualViewport)
      content.style.removeProperty('top')
      content.style.removeProperty('bottom')
      content.style.removeProperty('height')
      content.style.removeProperty('max-height')
    }
  }, [open, isMobile])

  // Album Detail view state
  const [selectedAlbum, setSelectedAlbum] = useState<Playlist | null>(null)
  const {
    playlistTracks,
    playlistTotal,
    tracksLoading,
    loadingMore: albumLoadingMore,
    hasMoreTracks,
    fetchPlaylistTracks,
    loadMoreTracks,
  } = usePlaylist()

  const { results, loading, loadingMore, hasMore, hasSearched, search, loadMore, resetState } = useSearch(
    source,
    searchType === 'recommend' ? 'song' : searchType,
    roomId,
  )
  const {
    recommendations,
    loading: recommendationsLoading,
    loaded: recommendationsLoaded,
    load: loadRecommendations,
    reset: resetRecommendations,
  } = useRecommendations(roomId)
  const activeRecommendation = useMemo(
    () => recommendations.find((recommendation) => recommendation.platform === source),
    [recommendations, source],
  )
  const visibleSources = useMemo(() => {
    if (searchType !== 'recommend') return SOURCES
    const recommendationSources = SOURCES.filter((item) => item.id !== 'tencent')
    if (!recommendationsLoaded) return recommendationSources
    const available = new Set(recommendations.map((recommendation) => recommendation.platform))
    return recommendationSources.filter((item) => available.has(item.id))
  }, [recommendations, recommendationsLoaded, searchType])

  // Auto re-search when source or type changes
  const prevSourceRef = useRef(source)
  const prevTypeRef = useRef(searchType)
  useEffect(() => {
    const sourceChanged = prevSourceRef.current !== source
    const typeChanged = prevTypeRef.current !== searchType
    prevSourceRef.current = source
    prevTypeRef.current = searchType
    if ((sourceChanged || typeChanged) && searchType !== 'recommend' && keyword.trim()) {
      search(keyword.trim())
      if (searchType === 'song') listRef.current?.scrollToTop()
    }
  }, [source, searchType, keyword, search])

  useEffect(() => {
    if (open && searchType === 'recommend' && !recommendationsLoaded && !recommendationsLoading) {
      loadRecommendations()
    }
  }, [loadRecommendations, open, recommendationsLoaded, recommendationsLoading, searchType])

  useEffect(() => {
    if (searchType !== 'recommend' || !recommendationsLoaded || recommendations.length === 0) return
    if (!recommendations.some((recommendation) => recommendation.platform === source)) {
      setSource(recommendations[0]!.platform)
    }
  }, [recommendations, recommendationsLoaded, searchType, source])

  // Measure active source button position for sliding pill
  const measurePill = useCallback(() => {
    const container = sourceContainerRef.current
    if (!container) return
    const activeBtn = container.querySelector<HTMLButtonElement>(`[data-source="${source}"]`)
    if (!activeBtn) return
    setPillStyle({ left: activeBtn.offsetLeft, width: activeBtn.offsetWidth })
  }, [source, visibleSources])

  useLayoutEffect(() => {
    measurePill()
  }, [measurePill])

  // Re-measure after dialog opens (DOM may not be ready on first render)
  useEffect(() => {
    if (open) requestAnimationFrame(measurePill)
  }, [open, measurePill])

  useEffect(() => {
    if (open) return
    const frame = requestAnimationFrame(() => {
      setSelectedAlbum(null)
      resetRecommendations()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, resetRecommendations])

  const handleSearch = (overrideKeyword?: string) => {
    const searchKeyword = (overrideKeyword ?? keyword).trim()
    if (!searchKeyword) return
    if (overrideKeyword !== undefined) setKeyword(overrideKeyword)
    setAddedIds(new Set())
    search(searchKeyword)
    if (searchType === 'song') {
      listRef.current?.scrollToTop()
    }
  }

  const beginBilibiliMetadataMatch = useCallback((track: Track, action: BilibiliQueueAction) => {
    setBilibiliMatch({ track, action })
  }, [])

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
      if (bilibiliMatch.action === 'insert') {
        onInsertAfterCurrent(track)
      } else {
        onAddToQueue(track)
      }
      setAddedIds((prev) => new Set(prev).add(trackKey(track)))
      setBilibiliMatch(null)
    },
    [bilibiliMatch, onAddToQueue, onInsertAfterCurrent],
  )

  const skipBilibiliMetadataMatch = useCallback(() => {
    if (!bilibiliMatch) return
    if (bilibiliMatch.action === 'insert') {
      onInsertAfterCurrent(bilibiliMatch.track)
    } else {
      onAddToQueue(bilibiliMatch.track)
    }
    setAddedIds((prev) => new Set(prev).add(trackKey(bilibiliMatch.track)))
    setBilibiliMatch(null)
  }, [bilibiliMatch, onAddToQueue, onInsertAfterCurrent])

  const handleAdd = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
        toast.info(`「${track.title}」已在队列中`)
        return
      }
      if (track.source === 'bilibili') {
        beginBilibiliMetadataMatch(track, 'add')
        return
      }
      onAddToQueue(track)
      setAddedIds((prev) => new Set(prev).add(key))
      // Removed duplicate toast.success since onAddToQueue (from useQueue) usually already handles it
      // or the UI handles feedback.
    },
    [onAddToQueue, queueKeys, addedIds, beginBilibiliMetadataMatch],
  )

  const handleInsertAfterCurrent = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
        toast.info(`「${track.title}」已在队列中`)
        return
      }
      if (track.source === 'bilibili') {
        beginBilibiliMetadataMatch(track, 'insert')
        return
      }
      onInsertAfterCurrent(track)
      setAddedIds((prev) => new Set(prev).add(key))
      // Removed duplicate toast.success
    },
    [onInsertAfterCurrent, queueKeys, addedIds, beginBilibiliMetadataMatch],
  )

  const handleAddBatch = useCallback(
    (tracks: Track[], playlistName?: string) => {
      if (tracks.length === 0) return
      socket.emit(EVENTS.QUEUE_ADD_BATCH, { tracks, playlistName })
      setAddedIds((prev) => {
        const next = new Set(prev)
        for (const t of tracks) next.add(trackKey(t))
        return next
      })
      toast.success(`已添加 ${tracks.length} 首歌曲`)
    },
    [socket],
  )

  const isTrackAdded = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      return addedIds.has(key) || queueKeys.has(key)
    },
    [addedIds, queueKeys],
  )

  const handleSelectAlbum = (album: Playlist) => {
    setSelectedAlbum(album)
    fetchPlaylistTracks(source, album.id, album.trackCount, searchType as 'album' | 'playlist')
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} mobileRepositionInputs={false}>
      <ResponsiveDialogContent
        ref={dialogContentRef}
        className="flex h-dvh max-h-dvh flex-col overflow-hidden sm:h-auto sm:max-h-[80vh] sm:max-w-2xl"
      >
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3">
            <ResponsiveDialogTitle className="shrink-0">
              {selectedAlbum ? selectedAlbum.name : searchType === 'recommend' ? '推荐点歌' : '搜索点歌'}
            </ResponsiveDialogTitle>
            {!selectedAlbum && visibleSources.length > 0 && (
              <div ref={sourceContainerRef} className="bg-muted/50 relative flex items-center rounded-lg p-0.5">
                <motion.div
                  className={cn('absolute inset-y-0.5 rounded-md', PLATFORM_ACTIVE[source])}
                  animate={{ left: pillStyle.left, width: pillStyle.width }}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }}
                />
                {visibleSources.map((s) => (
                  <button
                    key={s.id}
                    data-source={s.id}
                    className={cn(
                      'relative z-10 rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors',
                      source === s.id ? PLATFORM_TEXT[s.id] : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => {
                      setSource(s.id)
                      if (
                        (s.id === 'bilibili' || s.id === 'kugou_concept') &&
                        (searchType === 'album' || searchType === 'playlist')
                      ) {
                        setSearchType('song')
                      }
                      resetState()
                      setAddedIds(new Set())
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {selectedAlbum ? (
            <PlaylistDetail
              playlist={selectedAlbum}
              tracks={playlistTracks}
              loading={tracksLoading}
              loadingMore={albumLoadingMore}
              hasMore={hasMoreTracks}
              total={playlistTotal}
              onBack={() => setSelectedAlbum(null)}
              onAddTrack={handleAdd}
              onInsertAfterCurrent={handleInsertAfterCurrent}
              onAddAll={handleAddBatch}
              onLoadMore={loadMoreTracks}
            />
          ) : (
            <>
              <Tabs
                value={searchType}
                onValueChange={(value) => {
                  setSearchType(value as SearchMode)
                  resetState()
                  setAddedIds(new Set())
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="song" className="flex-1 text-xs sm:text-sm">
                    单曲
                  </TabsTrigger>
                  <TabsTrigger value="recommend" className="flex-1 gap-1 text-xs sm:text-sm">
                    <Sparkles className="h-3.5 w-3.5" />
                    推荐
                  </TabsTrigger>
                  {source !== 'bilibili' && source !== 'kugou_concept' && (
                    <>
                      <TabsTrigger value="album" className="flex-1 text-xs sm:text-sm">
                        专辑
                      </TabsTrigger>
                      <TabsTrigger value="playlist" className="flex-1 text-xs sm:text-sm">
                        歌单
                      </TabsTrigger>
                    </>
                  )}
                </TabsList>
              </Tabs>

              {searchType === 'recommend' ? (
                <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <Sparkles className={cn('h-4 w-4 shrink-0', PLATFORM_TEXT[source])} />
                    <span className="truncate">展示当前账号在平台上的原生推荐内容</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadRecommendations}
                    disabled={recommendationsLoading}
                    aria-label="刷新推荐"
                  >
                    <RefreshCw className={cn('h-4 w-4', recommendationsLoading && 'animate-spin')} />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder={
                      source === 'bilibili'
                        ? '搜索视频，或粘贴 B站链接 / BV号...'
                        : searchType === 'song'
                          ? '搜索歌曲、歌手...'
                          : searchType === 'album'
                            ? '搜索专辑...'
                            : '搜索歌单...'
                    }
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1"
                    autoFocus
                    aria-label="搜索关键词"
                  />
                  <Button onClick={() => handleSearch()} disabled={loading} aria-label="搜索">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              )}

              {/* Results area — virtual scrolling with auto-load */}
              {searchType === 'recommend' ? (
                !recommendationsLoaded || recommendationsLoading ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border">
                    <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
                  </div>
                ) : recommendations.length === 0 ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border">
                    <div className="text-muted-foreground flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
                      <Sparkles className="h-8 w-8" />
                      <span className="text-sm">请先在设置中登录音乐平台，再查看平台推荐</span>
                    </div>
                  </div>
                ) : (
                  <VirtualTrackList
                    ref={listRef}
                    tracks={activeRecommendation?.tracks ?? []}
                    loading={false}
                    hasMore={false}
                    loadingMore={false}
                    onLoadMore={() => undefined}
                    isTrackAdded={isTrackAdded}
                    onAddTrack={handleAdd}
                    onInsertAfterCurrent={handleInsertAfterCurrent}
                    onArtistClick={(artist) => {
                      setSearchType('song')
                      handleSearch(artist)
                    }}
                    emptyIcon={<Sparkles className="h-8 w-8" />}
                    emptyMessage={
                      activeRecommendation?.unavailableReason === 'upstream_unavailable'
                        ? '平台推荐暂时不可用，请刷新重试'
                        : '平台暂时没有返回推荐内容'
                    }
                  />
                )
              ) : hasSearched ? (
                searchType === 'song' ? (
                  <VirtualTrackList
                    ref={listRef}
                    tracks={results as Track[]}
                    loading={loading}
                    hasMore={hasMore}
                    loadingMore={loadingMore}
                    onLoadMore={loadMore}
                    isTrackAdded={isTrackAdded}
                    onAddTrack={handleAdd}
                    onInsertAfterCurrent={handleInsertAfterCurrent}
                    onArtistClick={(artist) => {
                      setSearchType('song')
                      handleSearch(artist)
                    }}
                    emptyIcon={<Music2 className="h-8 w-8" />}
                    emptyMessage={
                      source === 'bilibili' ? '暂无结果，请检查链接、BV号或更换关键词' : '暂无结果，换个关键词试试'
                    }
                  />
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-2">
                    {loading && results.length === 0 ? (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : results.length === 0 ? (
                      <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Music2 className="h-8 w-8" />
                        <span className="text-sm">暂无结果，换个关键词试试</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {(results as Playlist[]).map((album, index) => (
                          <button
                            key={`${album.id}-${index}`}
                            className="hover:bg-accent flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg p-2 text-left transition-colors"
                            onClick={() => handleSelectAlbum(album)}
                          >
                            {album.cover ? (
                              <img
                                src={album.cover}
                                alt={album.name}
                                referrerPolicy="no-referrer"
                                className="h-12 w-12 shrink-0 rounded-md object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-md">
                                <ListMusic className="text-muted-foreground h-5 w-5" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{album.name}</p>
                              <p className="text-muted-foreground truncate text-xs">
                                {album.trackCount} 首{album.creator ? ` · ${album.creator}` : ''}
                              </p>
                            </div>
                          </button>
                        ))}
                        {hasMore && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full mt-2"
                            onClick={loadMore}
                            disabled={loadingMore}
                          >
                            {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {loadingMore ? '加载中...' : '加载更多'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                  <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Music2 className="h-8 w-8" />
                    <span className="text-sm">输入关键词开始搜索</span>
                  </div>
                </div>
              )}
            </>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>

      <BilibiliMetadataDialog
        track={bilibiliMatch?.track ?? null}
        roomId={roomId}
        onOpenChange={(isOpen) => !isOpen && setBilibiliMatch(null)}
        onSelect={applyBilibiliMetadataMatch}
        onSkip={skipBilibiliMetadataMatch}
      />
    </ResponsiveDialog>
  )
}
