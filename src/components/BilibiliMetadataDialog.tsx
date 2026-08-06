import { LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BILIBILI_METADATA_SOURCES } from '../domain/bilibili'
import type { BilibiliMetadataSource, Track } from '../domain/types'
import { searchTracks } from '../services/api'
import { useAppStore } from '../store/app-store'

const SOURCE_LABELS: Record<BilibiliMetadataSource, string> = {
  netease: '网易云',
  tencent: 'QQ 音乐',
  kugou: '酷狗',
  kugou_concept: '酷狗概念版',
}

export function BilibiliMetadataDialog({ track, onClose, onSelect, onSkip }: { track: Track | null; onClose: () => void; onSelect: (track: Track, source: BilibiliMetadataSource) => void; onSkip: () => void }) {
  const serverUrl = useAppStore((state) => state.serverUrl)
  const roomId = useAppStore((state) => state.room?.id)
  const [source, setSource] = useState<BilibiliMetadataSource>('netease')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!track) return
    setKeyword(`${track.title} ${track.artist.join(' ')}`)
    setResults([])
    setError('')
    void runSearch(`${track.title} ${track.artist.join(' ')}`, source)
  }, [track?.id])

  const runSearch = async (value = keyword, nextSource = source) => {
    if (!roomId || !value.trim()) return
    setLoading(true)
    setError('')
    try {
      const data = await searchTracks(serverUrl, roomId, nextSource, value.trim())
      setResults(data.items.filter((item): item is Track => 'title' in item))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '匹配搜索失败')
    } finally {
      setLoading(false)
    }
  }

  if (!track) return null
  return <div className="modal-backdrop modal-backdrop--compact" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="metadata-dialog" role="dialog" aria-modal="true"><header><div><span>B 站元数据</span><strong>选择歌词和封面</strong></div><button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button></header><div className="metadata-source-switch">{BILIBILI_METADATA_SOURCES.map((item) => <button key={item} className={source === item ? 'is-active' : ''} onClick={() => { setSource(item); void runSearch(keyword, item) }}>{SOURCE_LABELS[item]}</button>)}</div><div className="metadata-controls"><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch() }} /><button className="button" onClick={() => void runSearch()} disabled={loading}>{loading ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}搜索</button></div><button className="button" onClick={onSkip}>跳过匹配，直接使用 B 站视频</button><div className="metadata-results">{loading && <div className="settings-loading"><LoaderCircle className="spin" size={16} />正在搜索</div>}{results.map((item) => <button key={`${item.source}:${item.id}`} onClick={() => onSelect(item, source)}><img src={item.cover} alt="" /><span><strong>{item.title}</strong><small>{item.artist.join(' / ')}{item.album ? ` · ${item.album}` : ''}</small></span></button>)}{!loading && !results.length && !error && <p className="metadata-empty">暂无匹配结果</p>}{error && <p className="inline-error">{error}</p>}</div></section></div>
}
