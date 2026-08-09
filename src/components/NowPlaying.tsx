import { Maximize2, Minimize2, Minus, Plus, Search, Settings, SlidersHorizontal, SlidersVertical } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { ArtworkView } from './ArtworkView'
import { BackgroundRender } from './BackgroundRender'

const LyricsView = lazy(() => import('./LyricsView').then((module) => ({ default: module.LyricsView })))
const PlayerQuickSettings = lazy(() => import('./PlayerQuickSettings').then((module) => ({ default: module.PlayerQuickSettings })))
const LyricsOverview = lazy(() => import('./LyricsOverview').then((module) => ({ default: module.LyricsOverview })))

export function NowPlaying() {
  const room = useAppStore((state) => state.room)!
  const immersivePlayer = useAppStore((state) => state.immersivePlayer)
  const lyricSource = useAppStore((state) => state.lyricSource)
  const visual = useAppStore((state) => state.playerVisualSettings)
  const quickSettingsOpen = useAppStore((state) => state.playerQuickSettingsOpen)
  const lyricsOverviewOpen = useAppStore((state) => state.lyricsOverviewOpen)
  const set = useAppStore((state) => state.set)
  const [offsetOpen, setOffsetOpen] = useState(false)

  return (
    <section className={`now-playing now-playing--${visual.layout} now-playing--cover-${visual.coverHorizontalAlign} now-playing--cover-${visual.coverVerticalAlign} now-playing--lyrics-${visual.lyricTextAlign} now-playing--controls-${visual.controlsMode} ${visual.lyricFade ? 'now-playing--lyric-fade' : ''} ${visual.lyricGlow ? 'now-playing--lyric-glow' : ''} ${visual.textShadow ? 'now-playing--text-shadow' : ''} ${visual.progressAtBottom ? 'now-playing--progress-bottom' : ''}`} style={{ '--player-font-family': visual.customFontFamily || 'inherit' } as React.CSSProperties}>
      {room.currentTrack?.cover && <BackgroundRender cover={room.currentTrack.cover} />}
      <header className="now-playing__header">
        <div>
          <span className="live-label"><span />正在播放</span>
          {lyricSource && <span className="source-label">{lyricSource}</span>}
        </div>
        <div className="now-playing__actions">
          <button className="icon-button" title="搜索并点歌" aria-label="搜索并点歌" onClick={() => set({ searchOpen: true })}><Search size={17} /></button>
          <button className="icon-button" title="打开设置" aria-label="打开设置" onClick={() => set({ settingsOpen: true })}><Settings size={17} /></button>
          <button className={`icon-button ${quickSettingsOpen ? 'is-active' : ''}`} title="播放器快捷设置" aria-label="播放器快捷设置" aria-pressed={quickSettingsOpen} onClick={() => set({ playerQuickSettingsOpen: !quickSettingsOpen, lyricsOverviewOpen: false })}><SlidersVertical size={17} /></button>
          <button className={`icon-button ${offsetOpen ? 'is-active' : ''}`} title="歌词时间校正" aria-label="歌词时间校正" aria-pressed={offsetOpen} onClick={() => setOffsetOpen((value) => !value)}><SlidersHorizontal size={17} /></button>
          <button className={`icon-button ${immersivePlayer ? 'is-active' : ''}`} title={immersivePlayer ? '退出沉浸模式（Esc）' : '进入沉浸模式'} aria-label={immersivePlayer ? '退出沉浸模式' : '进入沉浸模式'} aria-pressed={immersivePlayer} onClick={() => set({ immersivePlayer: !immersivePlayer })}>{immersivePlayer ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        </div>
      </header>
      {offsetOpen && <LyricOffsetControl onClose={() => setOffsetOpen(false)} />}
      <div className={`player-stage player-stage--${visual.layout}`}>
        {visual.layout === 'split' && <aside className={`player-overview player-overview--${visual.coverHorizontalAlign} player-overview--${visual.coverVerticalAlign} player-overview--${visual.coverShape} ${visual.coverShadow ? 'player-overview--shadow' : ''}`} style={{ '--cover-scale': visual.coverScale } as React.CSSProperties}>
          <ArtworkView compact />
        </aside>}
        <div className="player-lyrics" aria-label="逐字歌词">
          <Suspense fallback={<div className="lyrics-state"><span className="loading-bars"><i /><i /><i /></span><strong>正在准备歌词动画</strong></div>}>
            <LyricsView />
          </Suspense>
        </div>
      </div>
      {quickSettingsOpen && <Suspense fallback={null}><PlayerQuickSettings /></Suspense>}
      {lyricsOverviewOpen && <Suspense fallback={null}><LyricsOverview /></Suspense>}
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
      <button className="icon-button" title="歌词提前 0.5 秒" aria-label="歌词提前 0.5 秒" onClick={() => change(offset - 500)}><Minus size={14} /></button>
      <button className="offset-value" onClick={() => { change(0); notify('歌词偏移已重置'); onClose() }} title="点击重置">{offset > 0 ? '+' : ''}{(offset / 1000).toFixed(1)}s</button>
      <button className="icon-button" title="歌词延后 0.5 秒" aria-label="歌词延后 0.5 秒" onClick={() => change(offset + 500)}><Plus size={14} /></button>
    </div>
  )
}
