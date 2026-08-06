import { ChevronRight, DoorOpen, Headphones, Link2, LockKeyhole, LogOut, Plus, Radio, RefreshCw, Server, Settings, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { connectClient, createRoom, disconnectClient, joinRoom, leaveRoom } from '../services/runtime'
import { useAppStore } from '../store/app-store'

export function Sidebar() {
  const serverUrl = useAppStore((state) => state.serverUrl)
  const nickname = useAppStore((state) => state.nickname)
  const status = useAppStore((state) => state.connectionStatus)
  const connectionError = useAppStore((state) => state.connectionError)
  const rooms = useAppStore((state) => state.rooms)
  const room = useAppStore((state) => state.room)
  const passwordRetry = useAppStore((state) => state.passwordRetry)
  const set = useAppStore((state) => state.set)
  const [creating, setCreating] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [newRoomPassword, setNewRoomPassword] = useState('')
  const [passwordRoom, setPasswordRoom] = useState<{ id: string; name: string } | null>(null)
  const [joinPassword, setJoinPassword] = useState('')
  const [directJoin, setDirectJoin] = useState(false)
  const [directRoomId, setDirectRoomId] = useState('')

  const submitConnection = (event: React.FormEvent) => {
    event.preventDefault()
    void connectClient(serverUrl, nickname)
  }

  useEffect(() => {
    if (!passwordRetry) return
    setPasswordRoom({ id: passwordRetry.roomId, name: passwordRetry.message })
    set({ passwordRetry: undefined })
  }, [passwordRetry, set])

  return (
    <aside className="sidebar">
      <div className="sidebar__section-label"><Server size={13} />服务器</div>
      <form className="connection-form" onSubmit={submitConnection}>
        <input aria-label="服务器地址" value={serverUrl} disabled={status !== 'disconnected'} onChange={(event) => set({ serverUrl: event.target.value })} placeholder="http://127.0.0.1:3001" />
        <input aria-label="昵称" value={nickname} disabled={status !== 'disconnected'} onChange={(event) => set({ nickname: event.target.value })} placeholder="你的昵称" maxLength={32} />
        {status === 'disconnected' ? (
          <button className="button button--primary" type="submit"><Radio size={15} />连接</button>
        ) : (
          <button className="button" type="button" onClick={disconnectClient}>
            {status === 'connecting' ? <RefreshCw className="spin" size={15} /> : <LogOut size={15} />}{status === 'connecting' ? '连接中' : '断开'}
          </button>
        )}
      </form>
      {status === 'connected' && <button className="sidebar-account-button" type="button" onClick={() => set({ settingsOpen: true })}><Settings size={15} />账号与设置</button>}
      {connectionError && <p className="inline-error">{connectionError}</p>}

      <div className="sidebar__section-heading">
        <span className="sidebar__section-label"><Headphones size={13} />房间</span>
        {status === 'connected' && <><button className="icon-button" title="通过房间号加入" onClick={() => setDirectJoin((value) => !value)}><Link2 size={15} /></button><button className="icon-button" title="创建房间" onClick={() => setCreating((value) => !value)}><Plus size={15} /></button></>}
      </div>

      {directJoin && status === 'connected' && <form className="create-room" onSubmit={(event) => { event.preventDefault(); if (!directRoomId.trim()) return; joinRoom(directRoomId.trim()); setDirectRoomId(''); setDirectJoin(false) }}><input autoFocus value={directRoomId} onChange={(event) => setDirectRoomId(event.target.value)} placeholder="房间号或房间链接" /><button className="icon-button" title="加入房间"><ChevronRight size={16} /></button></form>}

      {creating && (
        <form className="create-room" onSubmit={(event) => {
          event.preventDefault()
          createRoom(roomName.trim() || undefined, newRoomPassword || undefined)
          setCreating(false)
          setRoomName('')
          setNewRoomPassword('')
        }}>
          <input autoFocus value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="房间名称" maxLength={40} />
          <input type="password" value={newRoomPassword} onChange={(event) => setNewRoomPassword(event.target.value)} placeholder="密码（可选）" maxLength={64} />
          <button className="icon-button" title="确认创建"><ChevronRight size={16} /></button>
        </form>
      )}

      <div className="room-list">
        {rooms.map((item) => (
          <button key={item.id} className={`room-list__item ${room?.id === item.id ? 'is-active' : ''}`} onClick={() => item.hasPassword ? setPasswordRoom({ id: item.id, name: item.name }) : joinRoom(item.id)}>
            <span className="room-list__icon"><Headphones size={15} /></span>
            <span className="room-list__copy">
              <strong>{item.name}</strong>
              <small>{item.currentTrackTitle || '等待播放'}</small>
            </span>
            <span className="room-list__meta">{item.hasPassword && <LockKeyhole size={11} />}<Users size={11} />{item.userCount}</span>
          </button>
        ))}
        {status === 'connected' && !rooms.length && <div className="sidebar-empty">暂无公开房间</div>}
      </div>

      {room && (
        <div className="sidebar__room-footer">
          <div><span className="status-dot status-dot--online" /><strong>{room.users.length}</strong> 人在线</div>
          <button className="icon-button" title="离开房间" onClick={leaveRoom}><DoorOpen size={16} /></button>
        </div>
      )}
      {passwordRoom && (
        <div className="modal-backdrop modal-backdrop--compact" onMouseDown={(event) => { if (event.currentTarget === event.target) setPasswordRoom(null) }}>
          <form className="password-dialog" onSubmit={(event) => {
            event.preventDefault()
            joinRoom(passwordRoom.id, joinPassword)
            setPasswordRoom(null)
            setJoinPassword('')
          }}>
            <header><div><span>受保护的房间</span><strong>{passwordRoom.name}</strong></div><button type="button" className="icon-button" title="关闭" onClick={() => setPasswordRoom(null)}><X size={16} /></button></header>
            <input autoFocus type="password" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="输入房间密码" />
            <button className="button button--primary" disabled={!joinPassword}>加入房间</button>
          </form>
        </div>
      )}
    </aside>
  )
}
