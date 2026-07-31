import { ArrowDownToLine, ChevronLeft, Clock3, Disc3, ListMusic, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MusicSource, Playlist, Track } from '../domain/types'
import { formatArtists, formatTime } from '../lib/format'
import { addBatchToQueue, addToQueue, search } from '../services/runtime'
import { fetchPlaylistTracks } from '../services/api'
import { useAppStore } from '../store/app-store'

const SOURCES: Array<{ value: MusicSource; label: string }> = [
  { value: 'netease', label: '网易云' },
  { value: 'tencent', label: 'QQ 音乐' },
  { value: 'kugou', label: '酷狗' },
  { value: 'kugou_concept', label: '酷狗概念版' },
  { value: 'bilibili', label: 'B 站' },
]

type SearchType = 'song' | 'album' | 'playlist'

function isTrack(item: Track | Playlist): item is Track {
  return 'title' in item
}

export function SearchOverlay() {
  const [source, setSource] = useState<MusicSource>('netease')
  const [type, setType] = useState<SearchType>('song')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [collection, setCollection] = useState<Playlist | null>(null)
  const [collectionTracks, setCollectionTracks] = useState<Track[]>([])
  const [collectionTotal, setCollectionTotal] = useState(0)
  const [collectionHasMore, setCollectionHasMore] = useState(false)
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionError, setCollectionError] = useState('')
  const results = useAppStore((state) => state.searchResults)
  const loading = useAppStore((state) => state.searchLoading)
  const error = useAppStore((state) => state.searchError)
  const room = useAppStore((state) => state.room)!
  const set = useAppStore((state) => state.set)
  const queuedIds = useMemo(() => new Set([room.currentTrack?.id, ...room.queue.map((track) => track.id)]), [room])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') set({ searchOpen: false }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [set])

  const runSearch = async (nextPage = 1, append = false) => {
    const more = await search(source, keyword, nextPage, type, append)
    setPage(nextPage)
    setHasMore(more)
  }

  const openCollection = async (item: Playlist) => {
    setCollection(item)
    setCollectionTracks([])
    setCollectionError('')
    setCollectionLoading(true)
    try {
      const data = await fetchPlaylistTracks(useAppStore.getState().serverUrl, room.id, item.source, item.id, 0, item.trackCount, type === 'album' ? 'album' : 'playlist')
      setCollectionTracks(data.tracks)
      setCollectionTotal(data.total)
      setCollectionHasMore(data.hasMore)
    } catch (caught) {
      setCollectionError(caught instanceof Error ? caught.message : '歌单加载失败')
    } finally {
      setCollectionLoading(false)
    }
  }

  const loadMoreCollection = async () => {
    if (!collection || collectionLoading) return
    setCollectionLoading(true)
    try {
      const data = await fetchPlaylistTracks(useAppStore.getState().serverUrl, room.id, collection.source, collection.id, collectionTracks.length, collectionTotal, type === 'album' ? 'album' : 'playlist')
      setCollectionTracks((current) => [...current, ...data.tracks])
      setCollectionHasMore(data.hasMore)
    } catch (caught) {
      setCollectionError(caught instanceof Error ? caught.message : '加载更多失败')
    } finally {
      setCollectionLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) set({ searchOpen: false }) }}>
      <section className="search-dialog" role="dialog" aria-modal="true" aria-label="点歌台">
        <header className="dialog-header">
          <div>
            {collection ? <button className="dialog-back" onClick={() => setCollection(null)}><ChevronLeft size={15} />返回搜索</button> : <span>点歌台</span>}
            <h2>{collection?.name ?? '搜索音乐'}</h2>
          </div>
          <button className="icon-button" title="关闭" onClick={() => set({ searchOpen: false })}><X size={18} /></button>
        </header>

        {!collection ? (
          <>
            <form className="search-form" onSubmit={(event) => { event.preventDefault(); void runSearch() }}>
              <Search size={18} />
              <input autoFocus value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={source === 'bilibili' ? '输入关键词或 B 站视频链接' : '歌曲、歌手、专辑或歌单'} />
              <button className="button button--primary" disabled={!keyword.trim() || loading}>{loading ? '搜索中' : '搜索'}</button>
            </form>
            <div className="search-filters">
              <div className="source-switch">{SOURCES.map((item) => <button key={item.value} className={source === item.value ? 'is-active' : ''} onClick={() => { setSource(item.value); if (item.value === 'bilibili') setType('song') }}>{item.label}</button>)}</div>
              <div className="type-switch">
                <button className={type === 'song' ? 'is-active' : ''} onClick={() => setType('song')}><Disc3 size={14} />歌曲</button>
                {source !== 'bilibili' && <button className={type === 'album' ? 'is-active' : ''} onClick={() => setType('album')}><Disc3 size={14} />专辑</button>}
                {source !== 'bilibili' && <button className={type === 'playlist' ? 'is-active' : ''} onClick={() => setType('playlist')}><ListMusic size={14} />歌单</button>}
              </div>
            </div>
            <div className="search-results">
              {results.map((item) => isTrack(item) ? (
                <TrackResult key={`${item.source}:${item.id}`} track={item} duplicate={queuedIds.has(item.id)} />
              ) : (
                <button className="collection-result" key={`${item.source}:${item.id}`} onClick={() => void openCollection(item)}>
                  <img src={item.cover} alt="" />
                  <div><strong>{item.name}</strong><span>{item.creator || item.source} · {item.trackCount} 首</span></div>
                  <ChevronLeft className="collection-chevron" size={17} />
                </button>
              ))}
              {!loading && !results.length && <div className="search-empty"><Search size={28} /><strong>{error || '输入关键词开始搜索'}</strong><span>歌曲可以加入队列，专辑与歌单支持批量点歌</span></div>}
              {loading && <div className="search-loading"><LoaderCircle className="spin" size={22} />正在从 {SOURCES.find((item) => item.value === source)?.label} 获取结果</div>}
              {hasMore && !loading && <button className="load-more" onClick={() => void runSearch(page + 1, true)}>加载更多</button>}
            </div>
          </>
        ) : (
          <div className="collection-detail">
            <div className="collection-summary">
              <img src={collection.cover} alt="" />
              <div><strong>{collection.name}</strong><span>{collection.creator || '个人歌单'} · {collectionTotal || collection.trackCount} 首</span></div>
              <button className="button button--primary" disabled={!collectionTracks.length} onClick={() => addBatchToQueue(collectionTracks.filter((track) => !queuedIds.has(track.id)), collection.name)}><Plus size={15} />批量加入</button>
            </div>
            <div className="search-results collection-tracks">
              {collectionTracks.map((track) => <TrackResult key={`${track.source}:${track.id}`} track={track} duplicate={queuedIds.has(track.id)} />)}
              {collectionError && <div className="inline-error collection-error">{collectionError}</div>}
              {collectionLoading && <div className="search-loading"><LoaderCircle className="spin" size={20} />正在加载</div>}
              {collectionHasMore && !collectionLoading && <button className="load-more" onClick={() => void loadMoreCollection()}>加载更多</button>}
              {!collectionLoading && !collectionTracks.length && !collectionError && <div className="search-empty"><ListMusic size={28} /><strong>歌单是空的</strong></div>}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function TrackResult({ track, duplicate }: { track: Track; duplicate: boolean }) {
  return (
    <div className={`search-result ${duplicate ? 'is-duplicate' : ''}`}>
      <img src={track.cover || track.bilibiliCover} alt="" />
      <div><strong>{track.title}</strong><span>{formatArtists(track.artist)} · {track.album || track.source}{duplicate ? ' · 已在队列' : ''}</span></div>
      <span className="search-duration"><Clock3 size={12} />{formatTime(track.duration)}</span>
      <button className="icon-button" title="下一首播放" disabled={duplicate} onClick={() => addToQueue(track, true)}><ArrowDownToLine size={16} /></button>
      <button className="icon-button is-active" title="加入队列" disabled={duplicate} onClick={() => addToQueue(track)}><Plus size={17} /></button>
    </div>
  )
}
