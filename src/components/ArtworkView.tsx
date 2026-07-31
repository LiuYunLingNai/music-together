import { Disc3, Users } from 'lucide-react'
import { useAppStore } from '../store/app-store'

export function ArtworkView() {
  const room = useAppStore((state) => state.room)!
  const track = room.currentTrack
  if (!track) return <div className="artwork-empty"><Disc3 size={38} /><strong>等待播放</strong></div>
  return (
    <div className="artwork-view">
      <div className="artwork-frame">
        <img src={track.cover || track.bilibiliCover} alt={`${track.title} 封面`} />
      </div>
      <div className="artwork-copy">
        <p>{track.album || track.source}</p>
        <h1>{track.title}</h1>
        <h2>{track.artist.join(' / ')}</h2>
        <div className="artwork-meta"><span><Disc3 size={14} />{track.source}</span><span><Users size={14} />{room.users.length} 人同听</span></div>
      </div>
    </div>
  )
}
