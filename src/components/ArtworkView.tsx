import { Disc3, Users } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { getProxiedCoverUrl } from '../lib/cover'

export function ArtworkView({ compact = false }: { compact?: boolean }) {
  const room = useAppStore((state) => state.room)!
  const serverUrl = useAppStore((state) => state.serverUrl)
  const visual = useAppStore((state) => state.playerVisualSettings)
  const track = room.currentTrack
  if (!track) return <div className="artwork-empty"><Disc3 size={38} /><strong>等待播放</strong></div>
  return (
    <div className={`artwork-view ${compact ? 'artwork-view--compact' : ''} artwork-view--${visual.coverShape} ${visual.coverShadow ? 'artwork-view--shadow' : ''}`} style={{ '--cover-scale': visual.coverScale } as React.CSSProperties}>
      <div className="artwork-frame">
        <img src={getProxiedCoverUrl(serverUrl, track.cover || track.bilibiliCover || '')} alt={`${track.title} 封面`} width={640} height={640} />
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
