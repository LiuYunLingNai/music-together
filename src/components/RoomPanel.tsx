import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Captions, Crown, ListMusic, MessageCircle, MoreHorizontal, Play, Search, Send, Shield, Trash2, UserRound, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { canDirectly, canManageQueueAction } from '../domain/permissions'
import { BILIBILI_METADATA_SOURCES } from '../domain/bilibili'
import { moveTrackAfterCurrent, sortRoomMembers } from '../domain/room-state'
import type { BilibiliMetadataSource, Track } from '../domain/types'
import { formatArtists, formatTime } from '../lib/format'
import { clearQueue, playQueuedTrack, removeFromQueue, reorderQueue, sendChat, setRoomUserRole, updateQueueMetadata } from '../services/runtime'
import { searchTracks } from '../services/api'
import { useAppStore } from '../store/app-store'
import { getProxiedCoverUrl } from '../lib/cover'

type PanelTab = 'queue' | 'chat' | 'members'

export function RoomPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<PanelTab>('queue')
  const [metadataTrack, setMetadataTrack] = useState<Track | null>(null)
  const room = useAppStore((state) => state.room)!
  const messages = useAppStore((state) => state.messages)
  const currentUserId = useAppStore((state) => state.currentUserId)
  const profile = useAppStore((state) => state.profile)
  const set = useAppStore((state) => state.set)
  const unreadChatCount = useAppStore((state) => state.unreadChatCount)
  const rttMs = useAppStore((state) => state.rttMs)
  const serverUrl = useAppStore((state) => state.serverUrl)
  const [message, setMessage] = useState('')
  const chatEnd = useRef<HTMLDivElement | null>(null)
  const currentUser = room.users.find((user) => user.id === currentUserId)
  const serverAdmin = profile?.role === 'admin' || currentUser?.isServerAdmin
  const canReorder = canDirectly(currentUser?.role, 'reorder', serverAdmin)
  const canClear = canManageQueueAction(currentUser?.role, 'clear-queue', { userId: currentUserId, temporaryAdminUserId: room.temporaryAdminUserId, allowTemporaryAdminQueueClear: room.allowTemporaryAdminQueueClear, allowTemporaryAdminTrackRemoval: room.allowTemporaryAdminTrackRemoval, isServerAdmin: serverAdmin })

  useEffect(() => {
    set({ chatOpen: tab === 'chat', unreadChatCount: tab === 'chat' ? 0 : unreadChatCount })
  }, [tab, set, unreadChatCount])

  useEffect(() => {
    if (tab === 'chat') chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, tab])

  const move = (index: number, target: number) => {
    if (target < 0 || target >= room.queue.length) return
    const ids = room.queue.map((track) => track.id)
    const [id] = ids.splice(index, 1)
    ids.splice(target, 0, id)
    reorderQueue(ids)
  }

  const pinAfterCurrent = (track: Track) => {
    reorderQueue(moveTrackAfterCurrent(room.queue.map((item) => item.id), track.id, room.currentTrack?.id))
  }

  return (
    <aside className={`room-panel ${collapsed ? 'room-panel--collapsed' : ''}`}>
      {collapsed ? (
        <button className="room-panel__expand icon-button" title="展开右侧栏" aria-label="展开右侧栏" onClick={onToggle}><ArrowLeft size={16} /></button>
      ) : <>
        <div className="panel-tabs">
          <button className={tab === 'queue' ? 'is-active' : ''} onClick={() => setTab('queue')}><ListMusic size={15} />队列 <span>{room.queue.length}</span></button>
          <button className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}><MessageCircle size={15} />聊天 {unreadChatCount > 0 && <span className="unread-badge">{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>}</button>
          <button className={tab === 'members' ? 'is-active' : ''} onClick={() => setTab('members')}><Users size={15} /><span>{room.users.length}</span></button>
          <button className="panel-tabs__collapse icon-button" title="收起右侧栏" aria-label="收起右侧栏" onClick={onToggle}><ArrowRight size={15} /></button>
        </div>
      </>}
      {!collapsed && <>
      {tab === 'queue' && (
        <>
          <div className="panel-toolbar">
            <div><strong>播放队列</strong><span>{canReorder ? '可拖动或使用箭头排序' : '成员移除歌曲需要投票'} · RTT {rttMs > 0 ? `${rttMs} ms` : '--'}</span></div>
            <div className="panel-toolbar__actions">
              {canClear && <button className="icon-button" title="清空队列" disabled={!room.queue.length} onClick={() => { if (window.confirm('确定清空整个播放队列？')) clearQueue() }}><Trash2 size={15} /></button>}
              <button className="icon-button" title="搜索并点歌" onClick={() => set({ searchOpen: true })}><Search size={16} /></button>
            </div>
          </div>
          <div className="queue-list">
            {room.queue.map((track, index) => (
              <div
                className={`queue-item ${room.currentTrack?.id === track.id ? 'is-current' : ''}`}
                key={`${track.id}-${index}`}
                draggable={canReorder}
                onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
                onDragOver={(event) => { if (canReorder) event.preventDefault() }}
                onDrop={(event) => move(Number(event.dataTransfer.getData('text/plain')), index)}
              >
                <span className="queue-index">{room.currentTrack?.id === track.id ? <Play size={11} fill="currentColor" /> : String(index + 1).padStart(2, '0')}</span>
                <img src={getProxiedCoverUrl(serverUrl, track.cover || track.bilibiliCover || '')} alt="" />
                <div className="queue-copy"><strong>{track.title}</strong><span>{formatArtists(track.artist)}{track.requestedBy ? ` · ${track.requestedBy}` : ''}</span></div>
                <span className="queue-duration">{formatTime(track.duration)}</span>
                <div className="queue-actions">
                  <button title="指定播放" onClick={() => playQueuedTrack(track)}><Play size={13} /></button>
                  {canReorder && <button title="置顶到当前播放之后" disabled={track.id === room.currentTrack?.id} onClick={() => pinAfterCurrent(track)}><ArrowDownToLine size={13} /></button>}
                  {canReorder && <button title="上移" disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={13} /></button>}
                  {canReorder && <button title="下移" disabled={index === room.queue.length - 1} onClick={() => move(index, index + 1)}><ArrowDown size={13} /></button>}
                  {track.source === 'bilibili' && <button title="匹配歌词与封面" onClick={() => setMetadataTrack(track)}><Captions size={13} /></button>}
                  <button title={canClear ? '从队列移除' : '投票移除'} onClick={() => removeFromQueue(track.id, track.title)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            {!room.queue.length && <div className="panel-empty"><ListMusic size={24} /><strong>队列是空的</strong><span>搜索一首歌加入房间</span></div>}
          </div>
          <div className="member-strip">
            <div className="member-strip__avatars">
              {room.users.slice(0, 4).map((user) => user.avatarUrl ? <img key={user.id} src={resolveAsset(user.avatarUrl)} alt={user.nickname} title={user.nickname} /> : <span key={user.id} title={user.nickname}>{user.nickname.slice(0, 1).toUpperCase()}</span>)}
            </div>
            <span><UserRound size={13} />{room.users.length} 人正在听</span>
            <button className="icon-button" title="房间成员" onClick={() => setTab('members')}><MoreHorizontal size={16} /></button>
          </div>
        </>
      )}
      {tab === 'chat' && (
        <>
          <div className="chat-list">
            {messages.map((entry) => (
              <div className={`chat-message ${entry.type === 'system' ? 'is-system' : ''}`} key={entry.id}>
                {entry.type === 'user' && <span className="chat-avatar">{entry.nickname.slice(0, 1).toUpperCase()}</span>}
                <div><div className="chat-meta"><strong>{entry.nickname}</strong><time>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{entry.content}</p></div>
              </div>
            ))}
            {!messages.length && <div className="panel-empty"><MessageCircle size={24} /><strong>还没有消息</strong><span>和房间里的朋友打个招呼</span></div>}
            <div ref={chatEnd} />
          </div>
          <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); sendChat(message); setMessage('') }}>
            <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="发送消息" maxLength={500} />
            <button className="icon-button is-active" title="发送" disabled={!message.trim()}><Send size={15} /></button>
          </form>
        </>
      )}
      {tab === 'members' && <MembersPanel />}
      {metadataTrack && <MetadataDialog track={metadataTrack} onClose={() => setMetadataTrack(null)} />}
      </>}
    </aside>
  )
}

function MembersPanel() {
  const room = useAppStore((state) => state.room)!
  const currentUserId = useAppStore((state) => state.currentUserId)
  const profile = useAppStore((state) => state.profile)
  const currentUser = room.users.find((user) => user.id === currentUserId)
  const canSetRole = canDirectly(currentUser?.role, 'set-role', profile?.role === 'admin' || currentUser?.isServerAdmin)
  const users = useMemo(() => sortRoomMembers(room.members), [room.members])
  return (
    <div className="members-panel">
      <header><strong>房间成员</strong><span>{room.users.length}/{users.length} 在线</span></header>
      {users.map((user) => (
        <div className="member-row" key={user.id}>
          {user.avatarUrl ? <img src={resolveAsset(user.avatarUrl)} alt="" /> : <span className="member-avatar">{user.nickname.slice(0, 1).toUpperCase()}</span>}
          <div><strong>{user.nickname}{user.id === currentUserId ? '（你）' : ''}</strong><code>{user.id}</code><small>{memberTimeSummary(user)}</small></div>
          <span className={`role-badge role-badge--${user.role}`}>{user.role === 'owner' ? <Crown size={12} /> : user.role === 'admin' ? <Shield size={12} /> : <UserRound size={12} />}{user.isServerAdmin ? '服务器管理员' : user.role === 'owner' ? '房主' : user.role === 'admin' ? '管理员' : '成员'}</span>
          {canSetRole && user.role !== 'owner' && !user.isServerAdmin && user.id !== currentUserId && (
            <select value={user.role} onChange={(event) => setRoomUserRole(user.id, event.target.value as 'admin' | 'member')}>
              <option value="admin">管理员</option><option value="member">成员</option>
            </select>
          )}
        </div>
      ))}
    </div>
  )
}

function MetadataDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const room = useAppStore((state) => state.room)!
  const serverUrl = useAppStore((state) => state.serverUrl)
  const [source, setSource] = useState<BilibiliMetadataSource>('netease')
  const [keyword, setKeyword] = useState(`${track.title} ${track.artist.join(' ')}`)
  const [results, setResults] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    setLoading(true); setError('')
    try {
      const data = await searchTracks(serverUrl, room.id, source, keyword)
      setResults(data.items.filter((item): item is Track => 'title' in item))
    } catch (caught) { setError(caught instanceof Error ? caught.message : '匹配失败') } finally { setLoading(false) }
  }
  return (
    <div className="panel-modal-backdrop">
      <section className="metadata-dialog">
        <header><div><span>B 站元数据</span><strong>匹配歌词与封面</strong></div><button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button></header>
        <div className="metadata-controls"><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>{BILIBILI_METADATA_SOURCES.map((item) => <option key={item} value={item}>{({ netease: '网易云', tencent: 'QQ 音乐', kugou: '酷狗', kugou_concept: '酷狗概念版' })[item]}</option>)}</select><input value={keyword} onChange={(event) => setKeyword(event.target.value)} /><button className="button" onClick={() => void run()} disabled={loading}>{loading ? '搜索中' : '搜索'}</button></div>
        <div className="metadata-results">
          {results.map((result) => <button key={result.id} onClick={() => { updateQueueMetadata(track.id, { metadataSource: source, lyricId: result.lyricId ?? result.sourceId, picId: result.picId, cover: result.cover }); onClose() }}><img src={result.cover} alt="" /><span><strong>{result.title}</strong><small>{formatArtists(result.artist)}</small></span></button>)}
          {error && <p className="inline-error">{error}</p>}
          {!loading && !results.length && !error && <p className="metadata-empty">搜索并选择最匹配的歌曲</p>}
        </div>
        {track.metadataSource && <button className="button metadata-clear" onClick={() => { updateQueueMetadata(track.id, { clearMetadata: true }); onClose() }}>恢复 B 站原始封面</button>}
      </section>
    </div>
  )
}

function resolveAsset(url: string): string {
  if (!url.startsWith('/')) return url
  return `${useAppStore.getState().serverUrl}${url}`
}

function memberTimeSummary(member: import('../domain/types').RoomMember): string {
  const format = (value: number) => new Date(value).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return `加入 ${format(member.joinedAt)} · ${member.isOnline ? '当前在线' : `最后在线 ${format(member.lastSeenAt ?? member.joinedAt)}`}`
}
