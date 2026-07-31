import { ListMusic, MessageCircleMore, Minus, Plus, Search, Settings, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store/app-store'
import { LyricsView } from './LyricsView'
import { ArtworkView } from './ArtworkView'

export function NowPlaying() {
  const room = useAppStore((state) => state.room)!
  const centerView = useAppStore((state) => state.centerView)
  const lyricSource = useAppStore((state) => state.lyricSource)
  const set = useAppStore((state) => state.set)
  const [offsetOpen, setOffsetOpen] = useState(false)

  return (
    <section className="now-playing">
      {room.currentTrack?.cover && <img className="now-playing__backdrop" src={room.currentTrack.cover} alt="" aria-hidden="true" />}
      <header className="now-playing__header">
        <div>
          <span className="live-label"><span />正在播放</span>
          {lyricSource && centerView === 'lyrics' && <span className="source-label">{lyricSource}</span>}
        </div>
        <div className="now-playing__actions">
          <button className="icon-button" title="搜索并点歌" onClick={() => set({ searchOpen: true })}><Search size={17} /></button>
          <button className="icon-button" title="打开设置" onClick={() => set({ settingsOpen: true })}><Settings size={17} /></button>
          {centerView === 'lyrics' && <button className={`icon-button ${offsetOpen ? 'is-active' : ''}`} title="歌词时间校正" onClick={() => setOffsetOpen((value) => !value)}><SlidersHorizontal size={17} /></button>}
        </div>
      </header>
      {offsetOpen && <LyricOffsetControl onClose={() => setOffsetOpen(false)} />}
      {centerView === 'lyrics' ? <LyricsView /> : <ArtworkView />}
      <div className="stage-rail" aria-hidden="true">
        <ListMusic size={14} /><span /> <MessageCircleMore size={14} />
      </div>
    </section>
  )
}

function LyricOffsetControl({ onClose }: { onClose: () => void }) {
  const room = useAppStore((state) => state.room)!
  const notify = useAppStore((state) => state.notify)
  const track = room.currentTrack
  const key = track ? `${track.source}:${track.metadataSource ?? ''}:${track.lyricId ?? track.sourceId}` : ''
  const [offset, setOffset] = useState(() => key ? Number(localStorage.getItem(`music-together-desktop:lyric-offset:${key}`) ?? 0) : 0)

  const change = (next: number) => {
    const value = Math.min(10_000, Math.max(-10_000, next))
    setOffset(value)
    localStorage.setItem(`music-together-desktop:lyric-offset:${key}`, String(value))
    window.dispatchEvent(new CustomEvent('lyric-offset-change', { detail: value }))
  }

  return (
    <div className="offset-popover">
      <button className="icon-button" title="歌词提前 0.5 秒" onClick={() => change(offset - 500)}><Minus size={14} /></button>
      <button className="offset-value" onClick={() => { change(0); notify('歌词偏移已重置'); onClose() }} title="点击重置">{offset > 0 ? '+' : ''}{(offset / 1000).toFixed(1)}s</button>
      <button className="icon-button" title="歌词延后 0.5 秒" onClick={() => change(offset + 500)}><Plus size={14} /></button>
    </div>
  )
}
