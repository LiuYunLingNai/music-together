import { ArrowRight, Headphones, LockKeyhole, Music2, Radio, Users } from 'lucide-react'
import { joinRoom } from '../services/runtime'
import { useAppStore } from '../store/app-store'

export function Lobby() {
  const status = useAppStore((state) => state.connectionStatus)
  const rooms = useAppStore((state) => state.rooms)
  const serverUrl = useAppStore((state) => state.serverUrl)

  if (status !== 'connected') {
    return (
      <section className="welcome-stage">
        <div className="welcome-signal"><Music2 size={42} strokeWidth={1.5} /></div>
        <p className="eyebrow">桌面聆听空间</p>
        <h1>连接你的音乐房间</h1>
        <p>在左侧输入 Music Together 服务器和昵称，房间、同步播放与逐词歌词会在这里展开。</p>
        <div className="welcome-status"><Radio size={15} />{status === 'connecting' ? '正在建立安全连接' : '等待连接'}</div>
      </section>
    )
  }

  return (
    <section className="lobby-stage">
      <header className="stage-heading">
        <div><p className="eyebrow">{new URL(serverUrl).host}</p><h1>选择一个房间</h1></div>
        <span>{rooms.length} 个公开房间</span>
      </header>
      <div className="lobby-room-grid">
        {rooms.map((room) => (
          <button className="lobby-room" key={room.id} onClick={() => joinRoom(room.id)}>
            <div className="lobby-room__top"><span><Headphones size={18} /></span>{room.hasPassword && <LockKeyhole size={14} />}</div>
            <h2>{room.name}</h2>
            <p>{room.currentTrackTitle || '等待第一首歌'}</p>
            <div className="lobby-room__footer"><span><Users size={14} />{room.userCount}</span><ArrowRight size={16} /></div>
          </button>
        ))}
        {!rooms.length && <div className="lobby-empty"><Headphones size={26} /><strong>还没有公开房间</strong><span>使用左侧的加号创建一个</span></div>}
      </div>
    </section>
  )
}
