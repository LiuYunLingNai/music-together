import { ListMusic, LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { bilibiliVideoId } from '../domain/bilibili'
import type { Track } from '../domain/types'
import { fetchBilibiliCollection } from '../services/api'
import { useAppStore } from '../store/app-store'

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

export function BilibiliCollectionDialog({ track, onClose, onSelect, onNotCollection }: { track: Track | null; onClose: () => void; onSelect: (track: Track) => void; onNotCollection: () => void }) {
  const serverUrl = useAppStore((state) => state.serverUrl)
  const [title, setTitle] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!track) return
    const bvid = bilibiliVideoId(track)
    if (!bvid) { onNotCollection(); return }
    setLoading(true)
    setTracks([])
    void fetchBilibiliCollection(serverUrl, bvid).then((data) => {
      if (data.tracks.length <= 1) { onNotCollection(); return }
      setTitle(data.title ?? 'B 站合集')
      setTracks(data.tracks)
    }).catch(() => onNotCollection()).finally(() => setLoading(false))
  }, [track?.id])
  const visible = useMemo(() => { const query = normalize(keyword); return query ? tracks.filter((item) => [item.title, item.album, ...item.artist].some((value) => normalize(value).includes(query))) : tracks }, [keyword, tracks])
  if (!track) return null
  return <div className="modal-backdrop modal-backdrop--compact"><section className="metadata-dialog" role="dialog" aria-modal="true"><header><div><span>B 站合集</span><strong>{title || '正在读取合集'}</strong></div><button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button></header><div className="metadata-controls"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索合集内视频" /></div><div className="metadata-results">{loading && <div className="settings-loading"><LoaderCircle className="spin" size={16} />正在读取合集</div>}{visible.map((item) => <button key={`${item.source}:${item.urlId}`} onClick={() => onSelect(item)}><img src={item.cover || item.bilibiliCover} alt="" /><span><strong>{item.title}</strong><small>{item.artist.join(' / ')}</small></span></button>)}{!loading && !visible.length && <p className="metadata-empty"><ListMusic size={20} />没有匹配的视频</p>}</div></section></div>
}
