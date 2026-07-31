import { Captions, ListRestart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { formatArtists, formatTime } from '../lib/format'
import { nextTrack, previousTrack, seekPlayback, setPlayMode, setVolume, togglePlayback } from '../services/runtime'
import { useAppStore } from '../store/app-store'
import { canDirectly } from '../domain/permissions'

export function TransportBar() {
  const room = useAppStore((state) => state.room)!
  const currentTime = useAppStore((state) => state.currentTime)
  const duration = useAppStore((state) => state.duration)
  const isPlaying = useAppStore((state) => state.isPlaying)
  const volume = useAppStore((state) => state.volume)
  const buffered = useAppStore((state) => state.buffered)
  const centerView = useAppStore((state) => state.centerView)
  const set = useAppStore((state) => state.set)
  const currentUserId = useAppStore((state) => state.currentUserId)
  const profile = useAppStore((state) => state.profile)
  const track = room.currentTrack
  const progress = duration ? currentTime / duration : 0
  const user = room.users.find((member) => member.id === currentUserId)
  const canSeek = canDirectly(user?.role, 'seek', profile?.role === 'admin' || user?.isServerAdmin)
  const voteLabel = user?.role === 'member' && profile?.role !== 'admin' ? '（将发起投票）' : ''

  const cycleMode = () => {
    const modes = ['sequential', 'loop-all', 'loop-one', 'shuffle'] as const
    setPlayMode(modes[(modes.indexOf(room.playMode) + 1) % modes.length])
  }

  return (
    <footer className="transport">
      <div className="transport-track">
        {track?.cover ? <img src={track.cover} alt="" /> : <span className="transport-placeholder"><Captions size={18} /></span>}
        <div><strong>{track?.title ?? '尚未播放'}</strong><span>{track ? formatArtists(track.artist) : '等待房主点歌'}</span></div>
      </div>
      <div className="transport-center">
        <div className="transport-controls">
          <button className="icon-button" title={`上一首${voteLabel}`} onClick={previousTrack}><SkipBack size={17} fill="currentColor" /></button>
          <button className="play-button" title={`${isPlaying ? '暂停' : '播放'}${voteLabel}`} onClick={togglePlayback}>{isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
          <button className="icon-button" title={`下一首${voteLabel}`} onClick={nextTrack}><SkipForward size={17} fill="currentColor" /></button>
        </div>
        <div className="progress-row">
          <time>{formatTime(currentTime)}</time>
          <div className="progress-control">
            <div className="progress-track" aria-hidden="true">
              <span className="progress-buffer" style={{ width: `${Math.min(1, Math.max(0, buffered)) * 100}%` }} />
              <span className="progress-played" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
              <i className="range-thumb" style={{ left: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
            </div>
            <input type="range" aria-label={canSeek ? '播放进度' : '成员不能调整播放进度'} disabled={!canSeek} min={0} max={duration || 1} step={0.1} value={Math.min(currentTime, duration || 1)} onChange={(event) => seekPlayback(Number(event.target.value))} />
          </div>
          <time>{formatTime(duration || track?.duration || 0)}</time>
        </div>
      </div>
      <div className="transport-actions">
        <button className={`icon-button ${centerView === 'lyrics' ? 'is-active' : ''}`} title="切换歌词" onClick={() => set({ centerView: centerView === 'lyrics' ? 'artwork' : 'lyrics' })}><Captions size={17} /></button>
        <button className="icon-button" title={`播放模式：${room.playMode}`} onClick={cycleMode}>{modeIcon(room.playMode)}</button>
        <div className="volume-control" style={{ '--volume': volume } as React.CSSProperties}>
          {volume === 0 ? <VolumeX size={16} /> : volume < 0.55 ? <Volume1 size={16} /> : <Volume2 size={16} />}
          <div className="volume-track" aria-hidden="true"><span style={{ width: `${Math.min(1, Math.max(0, volume)) * 100}%` }} /><i className="range-thumb" style={{ left: `${Math.min(1, Math.max(0, volume)) * 100}%` }} /></div>
          <input type="range" aria-label="音量" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
        </div>
      </div>
    </footer>
  )
}

function modeIcon(mode: string) {
  if (mode === 'shuffle') return <Shuffle size={17} />
  if (mode === 'loop-one') return <Repeat1 size={17} />
  if (mode === 'loop-all') return <Repeat size={17} />
  return <ListRestart size={17} />
}
