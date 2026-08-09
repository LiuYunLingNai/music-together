import { BookOpenText, Captions, ListMusic, ListRestart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { formatArtists, formatTime } from '../lib/format'
import { nextTrack, previousTrack, seekPlayback, setPlayMode, setVolume, togglePlayback, updatePlayerVisualSettings } from '../services/runtime'
import { useAppStore } from '../store/app-store'
import { canDirectly } from '../domain/permissions'
import { getProxiedCoverUrl } from '../lib/cover'
import { findActiveGroup } from '../lyrics/engine'
import { useRef, useState } from 'react'

export function TransportBar({ rightPanelOpen, onToggleRightPanel }: { rightPanelOpen: boolean; onToggleRightPanel: () => void }) {
  const room = useAppStore((state) => state.room)!
  const isPlaying = useAppStore((state) => state.isPlaying)
  const volume = useAppStore((state) => state.volume)
  const set = useAppStore((state) => state.set)
  const lyricsOverviewOpen = useAppStore((state) => state.lyricsOverviewOpen)
  const currentUserId = useAppStore((state) => state.currentUserId)
  const profile = useAppStore((state) => state.profile)
  const track = room.currentTrack
  const serverUrl = useAppStore((state) => state.serverUrl)
  const visual = useAppStore((state) => state.playerVisualSettings)
  const user = room.users.find((member) => member.id === currentUserId)
  const canSeek = canDirectly(user?.role, 'seek', profile?.role === 'admin' || user?.isServerAdmin)
  const voteLabel = user?.role === 'member' && profile?.role !== 'admin' ? '（将发起投票）' : ''

  const cycleMode = () => {
    const modes = ['sequential', 'loop-all', 'loop-one', 'shuffle'] as const
    setPlayMode(modes[(modes.indexOf(room.playMode) + 1) % modes.length])
  }

  return (
    <footer className={`transport ${visual.progressAtBottom ? 'transport--progress-bottom' : ''}`}>
      <div className="transport-track">
        {track?.cover ? <img src={getProxiedCoverUrl(serverUrl, track.cover)} alt="" width={96} height={96} /> : <span className="transport-placeholder"><Captions size={18} /></span>}
        <div><strong>{track?.title ?? '尚未播放'}</strong><span>{track ? formatArtists(track.artist) : '等待房主点歌'}</span></div>
      </div>
      <div className="transport-center">
        <div className="transport-controls">
          <button className="icon-button" title={`上一首${voteLabel}`} aria-label={`上一首${voteLabel}`} onClick={previousTrack}><SkipBack size={17} fill="currentColor" /></button>
          <button className="play-button" title={`${isPlaying ? '暂停' : '播放'}${voteLabel}`} aria-label={`${isPlaying ? '暂停' : '播放'}${voteLabel}`} onClick={togglePlayback}>{isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
          <button className="icon-button" title={`下一首${voteLabel}`} aria-label={`下一首${voteLabel}`} onClick={nextTrack}><SkipForward size={17} fill="currentColor" /></button>
        </div>
        <TransportProgress canSeek={canSeek} trackDuration={track?.duration || 0} remainingTime={visual.remainingTime} />
      </div>
      <div className="transport-actions">
        <button className="icon-button" title={`播放模式：${room.playMode}`} aria-label={`切换播放模式，当前为 ${room.playMode}`} onClick={cycleMode}>{modeIcon(room.playMode)}</button>
        <div className="volume-control" style={{ '--volume': volume } as React.CSSProperties}>
          {volume === 0 ? <VolumeX size={16} /> : volume < 0.55 ? <Volume1 size={16} /> : <Volume2 size={16} />}
          <div className="volume-track" aria-hidden="true"><span style={{ width: `${Math.min(1, Math.max(0, volume)) * 100}%` }} /><i className="range-thumb" style={{ left: `${Math.min(1, Math.max(0, volume)) * 100}%` }} /></div>
          <input type="range" aria-label="音量" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
        </div>
        <button className={`icon-button ${lyricsOverviewOpen ? 'is-active' : ''}`} title="歌词总览" aria-label="歌词总览" aria-pressed={lyricsOverviewOpen} onClick={() => set({ lyricsOverviewOpen: !lyricsOverviewOpen, playerQuickSettingsOpen: false })}><BookOpenText size={17} /></button>
        <button className={`icon-button ${rightPanelOpen ? 'is-active' : ''}`} title={rightPanelOpen ? '收起播放队列' : '展开播放队列'} aria-label={rightPanelOpen ? '收起播放队列' : '展开播放队列'} aria-controls="room-detail-panel" aria-expanded={rightPanelOpen} onClick={onToggleRightPanel}><ListMusic size={17} /></button>
      </div>
    </footer>
  )
}

function TransportProgress({ canSeek, trackDuration, remainingTime }: { canSeek: boolean; trackDuration: number; remainingTime: boolean }) {
  const currentTime = useAppStore((state) => state.currentTime)
  const duration = useAppStore((state) => state.duration)
  const buffered = useAppStore((state) => state.buffered)
  const resolvedDuration = duration || trackDuration
  const progress = resolvedDuration ? currentTime / resolvedDuration : 0
  return (
    <div className="progress-row">
      <time>{formatTime(currentTime)}</time>
      <ProgressControl canSeek={canSeek} duration={resolvedDuration} currentTime={currentTime} buffered={buffered} progress={progress} />
      <button type="button" className="progress-time" title="切换总时长或剩余时间" aria-label="切换总时长或剩余时间" onClick={() => updatePlayerVisualSettings({ remainingTime: !remainingTime })}>{remainingTime ? `-${formatTime(Math.max(0, resolvedDuration - currentTime))}` : formatTime(resolvedDuration)}</button>
    </div>
  )
}

function ProgressControl({ canSeek, duration, currentTime, buffered, progress }: { canSeek: boolean; duration: number; currentTime: number; buffered: number; progress: number }) {
  const groups = useAppStore((state) => state.lyricGroups)
  const enabled = useAppStore((state) => state.playerVisualSettings.progressPreview)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const frame = useRef(0)
  const updateHover = (clientX: number, element: HTMLElement) => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect()
      setHoverTime(Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration)))
    })
  }
  const groupIndex = hoverTime === null ? -1 : findActiveGroup(groups, hoverTime * 1000)
  const group = groups[groupIndex]
  const original = group?.main.words.map((word) => word.text).join('')
  return (
    <div className="progress-control" onPointerMove={(event) => { if (enabled) updateHover(event.clientX, event.currentTarget) }} onPointerLeave={() => setHoverTime(null)}>
      {enabled && hoverTime !== null && <div className="progress-preview" style={{ left: `${duration ? hoverTime / duration * 100 : 0}%` }}><time>{formatTime(hoverTime)}</time>{original && <strong>{original}</strong>}{group?.main.translatedLyric && <span>{group.main.translatedLyric}</span>}</div>}
      <div className="progress-track" aria-hidden="true">
        <span className="progress-buffer" style={{ width: `${Math.min(1, Math.max(0, buffered)) * 100}%` }} />
        <span className="progress-played" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
        <i className="range-thumb" style={{ left: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
      </div>
      <input type="range" aria-label={canSeek ? '播放进度' : '成员不能调整播放进度'} disabled={!canSeek} min={0} max={duration || 1} step={0.1} value={Math.min(currentTime, duration || 1)} onChange={(event) => seekPlayback(Number(event.target.value))} />
    </div>
  )
}

function modeIcon(mode: string) {
  if (mode === 'shuffle') return <Shuffle size={17} />
  if (mode === 'loop-one') return <Repeat1 size={17} />
  if (mode === 'loop-all') return <Repeat size={17} />
  return <ListRestart size={17} />
}
