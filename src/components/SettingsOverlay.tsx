import { ArrowDownToLine, CircleUserRound, Copy, DoorClosed, KeyRound, ListMusic, LoaderCircle, LogIn, LogOut, MonitorCog, Moon, Music, Network, RefreshCw, Save, Settings2, ShieldCheck, Sun, SunMoon, Trash2, Upload, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { canDirectly } from '../domain/permissions'
import { sortRoomMembers } from '../domain/room-state'
import type { AdminRoom, AdminUser, AudioQuality, MusicSource, Playlist, RoomMember, Track } from '../domain/types'
import { fetchAdminRooms, fetchAdminUsers, fetchAudioProxyPolicy, fetchPlaylistTracks, requestJson } from '../services/api'
import { addBatchToQueue, addToQueue, checkPlatformQr, claimKugouConceptVip, loginAccount, logoutAccount, logoutPlatform, protectAccount, refreshProfile, renameAccountId, requestMyPlaylists, requestPlatformQr, saveAvatar, saveNickname, setPlatformCookie, setRoomUserRole, updateBackgroundSettings, updateLyricSettings, updatePlaybackSyncSettings, updateRoomSettings, updateSyncInterval } from '../services/runtime'
import { useAppStore } from '../store/app-store'
import type { ThemePreference } from '../lib/theme'
import { setThemePreference, setUiScale } from '../services/theme'

type Section = 'room' | 'sources' | 'account' | 'appearance' | 'playback' | 'lyrics' | 'admin'
const PLATFORMS: Array<{ id: MusicSource; label: string }> = [
  { id: 'netease', label: '网易云音乐' }, { id: 'tencent', label: 'QQ 音乐' },
  { id: 'kugou', label: '酷狗音乐' }, { id: 'kugou_concept', label: '酷狗概念版' }, { id: 'bilibili', label: 'B 站' },
]
const QUALITY_OPTIONS: Array<{ value: AudioQuality; label: string }> = [
  { value: 128, label: '标准 128 kbps' }, { value: 192, label: '高品质 192 kbps' }, { value: 320, label: '高品质 320 kbps' }, { value: 999, label: '无损优先' },
  { value: 'highest', label: '平台最高音质' }, { value: 'netease_hires', label: '网易云 Hi-Res' },
  { value: 'tencent_flac', label: 'QQ FLAC' }, { value: 'kugou_hires', label: '酷狗 Hi-Res' }, { value: 'bilibili_hires', label: 'B 站 Hi-Res' },
]

export function SettingsOverlay() {
  const profile = useAppStore((state) => state.profile)
  const room = useAppStore((state) => state.room)
  const set = useAppStore((state) => state.set)
  const [section, setSection] = useState<Section>(() => room ? 'room' : 'account')
  const contentRef = useRef<HTMLElement | null>(null)
  const items: Array<{ id: Section; label: string; icon: React.ReactNode; hidden?: boolean }> = [
    { id: 'room', label: '房间与成员', icon: <Users size={16} />, hidden: !room },
    { id: 'sources', label: '音源账号', icon: <Music size={16} /> },
    { id: 'account', label: '用户账号', icon: <CircleUserRound size={16} /> },
    { id: 'appearance', label: '外观主题', icon: <SunMoon size={16} /> },
    { id: 'playback', label: '播放与同步', icon: <Settings2 size={16} /> },
    { id: 'lyrics', label: '歌词显示', icon: <ListMusic size={16} /> },
    { id: 'admin', label: '服务器管理', icon: <ShieldCheck size={16} />, hidden: profile?.role !== 'admin' },
  ]
  useEffect(() => {
    if (!room && section === 'room') setSection('account')
  }, [room, section])
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [section])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') set({ settingsOpen: false }) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [set])
  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) set({ settingsOpen: false }) }}>
      <section className="settings-window" role="dialog" aria-modal="true" aria-label="设置" onWheel={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.settings-content')) return
        const nav = target.closest('.settings-nav nav')
        if (nav && nav.scrollHeight > nav.clientHeight) return
        contentRef.current?.scrollBy({ top: event.deltaY })
      }}>
        <aside className="settings-nav">
          <header><strong>设置</strong><span>Windows / Linux</span></header>
          <nav>{items.filter((item) => !item.hidden).map((item) => <button key={item.id} className={section === item.id ? 'is-active' : ''} onClick={() => setSection(item.id)}>{item.icon}{item.label}</button>)}</nav>
          <div className="settings-identity"><code>{profile?.id ?? '访客身份'}</code><span>{profile?.nickname || '尚未设置昵称'}</span></div>
        </aside>
        <main ref={contentRef} className="settings-content" tabIndex={0}>
          <button className="settings-close icon-button" title="关闭设置" onClick={() => set({ settingsOpen: false })}><X size={18} /></button>
          {section === 'room' && room && <RoomSettings />}
          {section === 'sources' && <SourceAccounts />}
          {section === 'account' && <AccountSettings />}
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'playback' && <PlaybackSettings />}
          {section === 'lyrics' && <LyricsSettings />}
          {section === 'admin' && profile?.role === 'admin' && <AdminSettings />}
        </main>
      </section>
    </div>
  )
}

function AppearanceSettings() {
  const preference = useAppStore((state) => state.themePreference)
  const resolved = useAppStore((state) => state.resolvedTheme)
  const uiScale = useAppStore((state) => state.uiScale)
  const backgroundFps = useAppStore((state) => state.backgroundFps)
  const backgroundFlowSpeed = useAppStore((state) => state.backgroundFlowSpeed)
  const backgroundRenderScale = useAppStore((state) => state.backgroundRenderScale)
  const options: Array<{ id: ThemePreference; label: string; icon: React.ReactNode }> = [
    { id: 'auto', label: '自动', icon: <MonitorCog size={16} /> },
    { id: 'light', label: '白天', icon: <Sun size={16} /> },
    { id: 'dark', label: '夜间', icon: <Moon size={16} /> },
  ]
  return <div className="settings-section"><SectionHeader title="外观主题" description="自动模式跟随 Windows / Linux 系统主题；手动选择会保存在本机。" />
    <div className="settings-group"><SettingRow label="主题模式" description={`当前显示：${resolved === 'dark' ? '夜间' : '白天'}`}><div className="theme-segment">{options.map((option) => <button key={option.id} className={preference === option.id ? 'is-active' : ''} onClick={(event) => void setThemePreference(option.id, event.clientX, event.clientY)}>{option.icon}<span>{option.label}</span></button>)}</div></SettingRow><SettingRow label="界面字号" description="调整桌面控件和文字；歌词字号请在歌词显示中单独设置"><Range value={uiScale} min={0.9} max={1.4} step={0.05} suffix="%" scale={100} onChange={setUiScale} /></SettingRow><SettingRow label="动态背景 FPS"><Range value={backgroundFps} min={15} max={60} step={1} suffix="" onChange={(value) => updateBackgroundSettings({ backgroundFps: value })} /></SettingRow><SettingRow label="动态背景流动速度"><Range value={backgroundFlowSpeed} min={0.1} max={2} step={0.1} suffix="x" onChange={(value) => updateBackgroundSettings({ backgroundFlowSpeed: value })} /></SettingRow><SettingRow label="动态背景渲染精度"><Range value={backgroundRenderScale} min={0.25} max={1} step={0.05} suffix="x" onChange={(value) => updateBackgroundSettings({ backgroundRenderScale: value })} /></SettingRow></div>
  </div>
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return <header className="settings-heading"><h2>{title}</h2><p>{description}</p></header>
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><strong>{label}</strong>{description && <span>{description}</span>}</div><div className="setting-control">{children}</div></div>
}

function RoomSettings() {
  const room = useAppStore((state) => state.room)!
  const serverUrl = useAppStore((state) => state.serverUrl)
  const userId = useAppStore((state) => state.currentUserId)
  const profile = useAppStore((state) => state.profile)
  const drift = useAppStore((state) => state.syncDriftMs)
  const notify = useAppStore((state) => state.notify)
  const user = room.users.find((member) => member.id === userId)
  const serverAdmin = profile?.role === 'admin' || user?.isServerAdmin
  const owner = canDirectly(user?.role, 'room-settings', serverAdmin)
  const quality = owner || user?.role === 'admin'
  const [name, setName] = useState(room.name)
  const [password, setPassword] = useState('')
  const members = useMemo(() => sortRoomMembers(room.members), [room.members])
  return <div className="settings-section"><SectionHeader title="房间与成员" description="房间状态由服务器保存；临时管理员可控制播放和队列，成员使用投票。" />
    <div className="settings-group">
      <SettingRow label="房间名称"><div className="inline-editor"><input value={name} disabled={!owner} maxLength={40} onChange={(event) => setName(event.target.value)} /><button className="icon-button" title="保存房间名称" disabled={!owner || !name.trim() || name === room.name} onClick={() => updateRoomSettings({ name: name.trim() })}><Save size={15} /></button></div></SettingRow>
      <SettingRow label="邀请链接" description="包含服务器地址和房间号"><div className="copy-field"><code>{`${serverUrl}/room/${room.id}`}</code><button className="icon-button" title="复制完整邀请链接" onClick={() => { void navigator.clipboard.writeText(`${serverUrl}/room/${room.id}`); notify('邀请链接已复制') }}><Copy size={14} /></button></div></SettingRow>
      <SettingRow label="同步偏差"><code className={Math.abs(drift) > 500 ? 'drift-high' : ''}>{drift > 0 ? '+' : ''}{drift} ms</code></SettingRow>
      <SettingRow label="音质" description={quality ? '对下一首或重新加载后的歌曲生效' : '仅房主和管理员可修改'}><select value={String(room.audioQuality)} disabled={!quality} onChange={(event) => { const value = Number(event.target.value); updateRoomSettings({ audioQuality: (Number.isNaN(value) ? event.target.value : value) as AudioQuality }) }}>{QUALITY_OPTIONS.map((item) => <option key={String(item.value)} value={String(item.value)}>{item.label}</option>)}</select></SettingRow>
      <SettingRow label="隐藏房间" description="从大厅隐藏，但仍可通过房间号加入"><label className="switch"><input type="checkbox" disabled={!owner} checked={room.hidden} onChange={(event) => updateRoomSettings({ hidden: event.target.checked })} /><span /></label></SettingRow>
      <SettingRow label="永久房间" description="空房不会回收，服务器重启后保留"><label className="switch"><input type="checkbox" disabled={!owner} checked={room.permanent} onChange={(event) => updateRoomSettings({ permanent: event.target.checked })} /><span /></label></SettingRow>
      <SettingRow label="密码保护" description={room.hasPassword ? '当前房间已设置密码' : '当前房间公开加入'}><div className="inline-editor">{owner && room.password && <button className="icon-button" title="复制当前密码" onClick={() => { void navigator.clipboard.writeText(room.password!); notify('房间密码已复制') }}><Copy size={14} /></button>}<input type="password" disabled={!owner} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入新密码" /><button className="button" disabled={!owner || !password.trim()} onClick={() => { updateRoomSettings({ password: password.trim() }); setPassword('') }}>设置</button>{room.hasPassword && <button className="button" disabled={!owner} onClick={() => updateRoomSettings({ password: null })}>移除</button>}</div></SettingRow>
    </div>
    {owner && <div className="settings-group"><SettingRow label="临时管理员删除单曲" description="允许临时管理员删除单首歌曲"><label className="switch"><input type="checkbox" checked={room.allowTemporaryAdminTrackRemoval} onChange={(event) => updateRoomSettings({ allowTemporaryAdminTrackRemoval: event.target.checked })} /><span /></label></SettingRow><SettingRow label="临时管理员清空队列" description="允许临时管理员清空整个队列"><label className="switch"><input type="checkbox" checked={room.allowTemporaryAdminQueueClear} onChange={(event) => updateRoomSettings({ allowTemporaryAdminQueueClear: event.target.checked })} /><span /></label></SettingRow></div>}
    {!owner && <div className="permission-note">当前身份：{user?.role === 'admin' ? '临时管理员，可控制播放、队列和音质' : '成员，可点歌并对受限操作发起投票'}</div>}
    <div className="settings-group members-settings"><h3>房间成员 <span>{room.users.length}/{members.length}</span></h3>{members.map((member) => <div className={`settings-member ${member.isOnline ? '' : 'is-offline'}`} key={member.id}>{member.avatarUrl ? <img src={resolveAsset(member.avatarUrl)} alt="" /> : <span>{member.nickname.slice(0, 1).toUpperCase()}</span>}<div><strong>{member.nickname}{member.id === userId ? '（你）' : ''}</strong><code>{member.id}</code><small>{memberTimeSummary(member)}</small></div><em>{member.isOnline ? '' : '离线 · '}{member.isServerAdmin ? '服务器管理员' : member.role === 'owner' ? '房主' : member.role === 'admin' ? '管理员' : '成员'}</em>{owner && member.isOnline && member.role !== 'owner' && !member.isServerAdmin && member.id !== userId && <select value={member.role} onChange={(event) => setRoomUserRole(member.id, event.target.value as 'admin' | 'member')}><option value="admin">管理员</option><option value="member">成员</option></select>}</div>)}</div>
  </div>
}

function SourceAccounts() {
  const myStatus = useAppStore((state) => state.myPlatformAuth)
  const sharedStatus = useAppStore((state) => state.platformStatus)
  const playlists = useAppStore((state) => state.playlists)
  const qrData = useAppStore((state) => state.qrData)
  const qrStatus = useAppStore((state) => state.qrStatus)
  const authBusy = useAppStore((state) => state.authBusy)
  const [cookies, setCookies] = useState<Partial<Record<MusicSource, string>>>({})
  const [expanded, setExpanded] = useState<MusicSource | null>(null)
  const [playlistLoading, setPlaylistLoading] = useState<MusicSource | null>(null)
  const [selected, setSelected] = useState<Playlist | null>(null)
  useEffect(() => {
    if (!qrData || qrStatus?.status === 803 || qrStatus?.status === 800) return
    const timer = window.setInterval(() => checkPlatformQr(qrData.key, qrData.platform), 2_000)
    return () => window.clearInterval(timer)
  }, [qrData, qrStatus])
  useEffect(() => { if (playlistLoading) setPlaylistLoading(null) }, [playlists])
  return <div className="settings-section"><SectionHeader title="音源账号" description="Cookie 由服务端验证并参与房间音源池；本机持久化仅用于断线重连恢复。" />
    <div className="platform-grid">{PLATFORMS.map((platform) => { const mine = myStatus.find((item) => item.platform === platform.id); const shared = sharedStatus.find((item) => item.platform === platform.id); return <article className="platform-card" key={platform.id}><header><div><strong>{platform.label}</strong><span>{mine?.loggedIn ? `${mine.nickname || '已登录'}${mine.vipLabel ? ` · ${mine.vipLabel}` : ''}` : '未登录'} · 房间 {shared?.loggedInCount ?? 0} 个账号</span></div><i className={mine?.loggedIn ? 'is-online' : ''} /></header><div className="platform-actions"><button className="button" disabled={authBusy} onClick={() => requestPlatformQr(platform.id)}>二维码登录</button><button className="button" onClick={() => setExpanded(expanded === platform.id ? null : platform.id)}>手动 Cookie</button>{mine?.loggedIn && <button className="icon-button" title="退出此音源账号" onClick={() => logoutPlatform(platform.id)}><LogOut size={14} /></button>}</div>{expanded === platform.id && <div className="cookie-editor"><textarea value={cookies[platform.id] ?? ''} onChange={(event) => setCookies((current) => ({ ...current, [platform.id]: event.target.value }))} placeholder="粘贴完整 Cookie" /><button className="button button--primary" disabled={!cookies[platform.id]?.trim() || authBusy} onClick={() => setPlatformCookie(platform.id, cookies[platform.id]!.trim())}>验证并保存</button></div>}{mine?.loggedIn && <button className="playlist-link" onClick={() => { setPlaylistLoading(platform.id); requestMyPlaylists(platform.id) }}><ListMusic size={14} />我的歌单</button>}{playlistLoading === platform.id && <span className="platform-loading"><LoaderCircle className="spin" size={13} />正在读取歌单</span>}{playlists[platform.id].length > 0 && <div className="mini-playlists">{playlists[platform.id].map((list) => <button key={list.id} onClick={() => setSelected(list)}>{list.cover && <img src={list.cover} alt="" />}<span><strong>{list.name}</strong><small>{list.trackCount} 首</small></span></button>)}</div>}{platform.id === 'kugou_concept' && mine?.loggedIn && <button className="playlist-link" onClick={claimKugouConceptVip}>领取概念版会员权益</button>}</article> })}</div>
    {qrData && <div className="qr-login"><img src={qrData.qrimg} alt="登录二维码" /><div><strong>使用 {PLATFORMS.find((item) => item.id === qrData.platform)?.label} 扫码</strong><span>{qrStatus?.message || '等待扫码'}</span><button className="button" onClick={() => requestPlatformQr(qrData.platform)}>刷新二维码</button></div></div>}
    {selected && <PlaylistDetail playlist={selected} onClose={() => setSelected(null)} />}
  </div>
}

function PlaylistDetail({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const room = useAppStore((state) => state.room)!
  const serverUrl = useAppStore((state) => state.serverUrl)
  const [tracks, setTracks] = useState<Track[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async (more = false) => { setLoading(true); setError(''); try { const data = await fetchPlaylistTracks(serverUrl, room.id, playlist.source, playlist.id, more ? tracks.length : 0, total || playlist.trackCount); setTracks((current) => more ? [...current, ...data.tracks] : data.tracks); setTotal(data.total); setHasMore(data.hasMore) } catch (caught) { setError(caught instanceof Error ? caught.message : '歌单加载失败') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [playlist.id])
  return <div className="settings-drawer"><header><div><strong>{playlist.name}</strong><span>{total || playlist.trackCount} 首</span></div><button className="icon-button" title="关闭歌单" onClick={onClose}><X size={16} /></button></header><button className="button button--primary" disabled={!tracks.length} onClick={() => addBatchToQueue(tracks, playlist.name)}>批量加入已加载的 {tracks.length} 首</button><div className="drawer-tracks">{tracks.map((track) => <div key={track.id}><img src={track.cover} alt="" /><span><strong>{track.title}</strong><small>{track.artist.join(' / ')}</small></span><span className="drawer-track-actions"><button className="icon-button" title="下一首播放" onClick={() => addToQueue(track, true)}><ArrowDownToLine size={13} /></button><button className="icon-button" title="加入队列" onClick={() => addToQueue(track)}><ListMusic size={13} /></button></span></div>)}{loading && <div className="settings-loading"><LoaderCircle className="spin" />加载中</div>}{error && <p className="inline-error">{error}</p>}{hasMore && !loading && <button className="load-more" onClick={() => void load(true)}>加载更多</button>}</div></div>
}

function AccountSettings() {
  const profile = useAppStore((state) => state.profile)
  const nickname = useAppStore((state) => state.nickname)
  const [name, setName] = useState(profile?.nickname || nickname)
  const [accountId, setAccountId] = useState(profile?.id || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [loginId, setLoginId] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const avatarInput = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    setName(profile?.nickname || nickname)
    setAccountId(profile?.id || '')
    setCurrentPassword('')
    setLoginId('')
    setLoginPassword('')
  }, [profile?.id, profile?.nickname, nickname])
  const run = async (key: string, task: () => Promise<void>) => { setBusy(key); setError(''); try { await task(); await refreshProfile() } catch (caught) { setError(caught instanceof Error ? caught.message : '账号操作失败') } finally { setBusy('') } }
  const upload = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => void run('avatar', () => saveAvatar(String(reader.result))); reader.readAsDataURL(file) }
  return <div className="settings-section"><SectionHeader title="用户账号" description="账号 ID 与密码用于在其他设备恢复身份；房间权限绑定账号 ID。" />
    <div className="profile-editor"><button className="profile-avatar" title="上传头像" onClick={() => avatarInput.current?.click()}>{profile?.avatarUrl ? <img src={resolveAsset(profile.avatarUrl)} alt="" /> : <Upload size={22} />}</button><input ref={avatarInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => upload(event.target.files?.[0])} /><div><strong>{profile?.nickname || '访客'}</strong><code>{profile?.id || '尚未建立资料'}</code></div></div>
    <div className="settings-group"><SettingRow label="昵称"><div className="inline-editor"><input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /><button className="button" disabled={busy !== '' || !name.trim() || name === profile?.nickname} onClick={() => void run('name', () => saveNickname(name))}>保存</button></div></SettingRow><SettingRow label="账号 ID" description="3-32 位小写字母、数字、_ 或 -"><div className="stacked-editor"><input value={accountId} onChange={(event) => setAccountId(event.target.value.toLowerCase())} />{profile?.hasPassword && <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前密码" />}<button className="button" disabled={busy !== '' || !/^[a-z0-9_-]{3,32}$/.test(accountId) || accountId === profile?.id} onClick={() => void run('id', () => renameAccountId(accountId, currentPassword))}>修改 ID</button></div></SettingRow></div>
    {!profile?.hasPassword && <div className="settings-group"><h3><KeyRound size={15} />保护当前账号</h3><SettingRow label="设置密码" description="至少 8 位；设置后可在其他设备登录"><div className="inline-editor"><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><button className="button" disabled={busy !== '' || newPassword.length < 8} onClick={() => void run('protect', () => protectAccount(newPassword))}>启用保护</button></div></SettingRow></div>}
    <div className="settings-group"><h3><LogIn size={15} />登录已有账号</h3><div className="login-grid"><input value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="账号 ID" /><input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="密码" /><button className="button button--primary" disabled={busy !== '' || !loginId.trim() || !loginPassword} onClick={() => void run('login', () => loginAccount(loginId, loginPassword))}>登录</button>{profile?.hasPassword && <button className="button" disabled={busy !== ''} onClick={() => { if (window.confirm('确定退出当前身份并切换到新的访客账号？')) void run('logout', logoutAccount) }}><LogOut size={14} />退出身份</button>}</div></div>
    {busy && <div className="settings-loading"><LoaderCircle className="spin" size={16} />正在处理账号</div>}{error && <p className="inline-error">{error}</p>}
  </div>
}

function PlaybackSettings() {
  const interval = useAppStore((state) => state.syncInterval)
  const drift = useAppStore((state) => state.syncDriftMs)
  const status = useAppStore((state) => state.connectionStatus)
  const tempoSync = useAppStore((state) => state.playbackTempoSyncEnabled)
  const hardSeekSync = useAppStore((state) => state.playbackHardSeekSyncEnabled)
  return <div className="settings-section"><SectionHeader title="播放与同步" description="客户端定期向服务器请求权威播放时间；大偏差会自动校正。" /><div className="settings-group"><SettingRow label="连接状态"><span className={`connection-pill connection-pill--${status}`}>{status === 'connected' ? '已连接' : status === 'reconnecting' ? '正在重连' : status === 'connecting' ? '正在连接' : '已断开'}</span></SettingRow><SettingRow label="当前同步偏差"><code className={Math.abs(drift) > 500 ? 'drift-high' : ''}>{drift > 0 ? '+' : ''}{drift} ms</code></SettingRow><SettingRow label="自动变速校准" description="在约 1% 范围内平滑修正小偏差"><label className="switch"><input type="checkbox" checked={tempoSync} onChange={(event) => updatePlaybackSyncSettings({ playbackTempoSyncEnabled: event.target.checked })} /><span /></label></SettingRow>{!tempoSync && <SettingRow label="关闭变速时，大偏差直接 Seek"><label className="switch"><input type="checkbox" checked={hardSeekSync} onChange={(event) => updatePlaybackSyncSettings({ playbackHardSeekSyncEnabled: event.target.checked })} /><span /></label></SettingRow>}<SettingRow label="同步请求间隔" description="1-60 秒；网络不稳定时可缩短"><div className="range-setting"><input type="range" min={1} max={60} value={interval} onChange={(event) => updateSyncInterval(Number(event.target.value))} /><strong>{interval} 秒</strong></div></SettingRow></div></div>
}

function LyricsSettings() {
  const settings = useAppStore((state) => state.lyricSettings)
  return <div className="settings-section"><SectionHeader title="歌词显示" description="逐词歌词设置即时作用于桌面播放区，并保存在本机。" /><div className="settings-group"><SettingRow label="TTML 逐词歌词"><label className="switch"><input type="checkbox" checked={settings.ttmlEnabled} onChange={(event) => updateLyricSettings({ ttmlEnabled: event.target.checked })} /><span /></label></SettingRow><SettingRow label="TTML 数据库地址" description="使用 %s 作为歌词 ID 占位符"><input className="wide-input" value={settings.ttmlDbUrl} onChange={(event) => updateLyricSettings({ ttmlDbUrl: event.target.value })} /></SettingRow><SettingRow label="对齐锚点"><select value={settings.alignAnchor} onChange={(event) => updateLyricSettings({ alignAnchor: event.target.value as typeof settings.alignAnchor })}><option value="top">顶部</option><option value="center">中央</option><option value="bottom">底部</option></select></SettingRow><SettingRow label="锚点位置"><Range value={settings.alignPosition} min={0} max={1} step={0.05} suffix="%" scale={100} onChange={(alignPosition) => updateLyricSettings({ alignPosition })} /></SettingRow><SettingRow label="弹性动画"><label className="switch"><input type="checkbox" checked={settings.animation} onChange={(event) => updateLyricSettings({ animation: event.target.checked })} /><span /></label></SettingRow><SettingRow label="非活动歌词模糊"><label className="switch"><input type="checkbox" checked={settings.blur} onChange={(event) => updateLyricSettings({ blur: event.target.checked })} /><span /></label></SettingRow><SettingRow label="逐字缩放"><label className="switch"><input type="checkbox" checked={settings.scale} onChange={(event) => updateLyricSettings({ scale: event.target.checked })} /><span /></label></SettingRow><SettingRow label="主歌词字号"><Range value={settings.fontSize} min={50} max={140} step={5} suffix="%" onChange={(fontSize) => updateLyricSettings({ fontSize })} /></SettingRow><SettingRow label="字体粗细"><Range value={settings.fontWeight} min={300} max={900} step={100} onChange={(fontWeight) => updateLyricSettings({ fontWeight })} /></SettingRow><SettingRow label="翻译字号"><Range value={settings.translationFontSize} min={50} max={120} step={5} suffix="%" onChange={(translationFontSize) => updateLyricSettings({ translationFontSize })} /></SettingRow><SettingRow label="音译字号"><Range value={settings.romanFontSize} min={50} max={120} step={5} suffix="%" onChange={(romanFontSize) => updateLyricSettings({ romanFontSize })} /></SettingRow></div></div>
}

function Range({ value, min, max, step, suffix = '', scale = 1, onChange }: { value: number; min: number; max: number; step: number; suffix?: string; scale?: number; onChange: (value: number) => void }) { return <div className="range-setting"><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><strong>{Math.round(value * scale)}{suffix}</strong></div> }

function AdminSettings() {
  const serverUrl = useAppStore((state) => state.serverUrl)
  const currentUserId = useAppStore((state) => state.currentUserId)
  const set = useAppStore((state) => state.set)
  const audioProxyPolicy = useAppStore((state) => state.audioProxyPolicy)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [rooms, setRooms] = useState<AdminRoom[]>([])
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => { setLoading(true); setError(''); try { const [userData, roomData, policy] = await Promise.all([fetchAdminUsers(serverUrl), fetchAdminRooms(serverUrl), fetchAudioProxyPolicy(serverUrl)]); setUsers(userData.users); setRooms(roomData.rooms); set({ audioProxyPolicy: policy }) } catch (caught) { setError(caught instanceof Error ? caught.message : '管理数据加载失败') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const run = async (task: () => Promise<unknown>) => { try { await task(); await load() } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败') } }
  return <div className="settings-section"><SectionHeader title="服务器管理" description={`账号 ${users.length} · 活跃房间 ${rooms.length}；危险操作需要再次确认。`} /><button className="admin-refresh icon-button" title="刷新管理数据" onClick={() => void load()}><RefreshCw className={loading ? 'spin' : ''} size={16} /></button>{error && <p className="inline-error">{error}</p>}
    <div className="settings-group"><h3><Network size={15} />酷狗代理策略</h3><SettingRow label="强制服务器代理" description="B 站始终走服务器代理；加密酷狗资源仍由服务端解密"><label className="switch"><input type="checkbox" checked={audioProxyPolicy.kugouForceProxy} onChange={(event) => void run(() => requestJson(serverUrl, '/api/admin/audio-proxy-policy', { method: 'PATCH', body: JSON.stringify({ kugouForceProxy: event.target.checked }) }))} /><span /></label></SettingRow></div>
    <div className="settings-group admin-list"><h3><CircleUserRound size={15} />用户列表</h3>{users.map((user) => <div className="admin-row" key={user.id}><div><strong>{user.nickname || '未设置昵称'}</strong><code>{user.id}</code></div><span>{user.role === 'admin' ? '管理员' : user.hasPassword ? '已设密码' : '访客'}</span><input type="password" placeholder="新密码（至少 8 位）" value={passwords[user.id] ?? ''} onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))} /><button className="button" disabled={(passwords[user.id]?.length ?? 0) < 8} onClick={() => { if (window.confirm(`确定重置 ${user.id} 的密码？`)) void run(() => requestJson(serverUrl, `/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, { method: 'POST', body: JSON.stringify({ password: passwords[user.id] }) })) }}>重置密码</button><button className="icon-button danger" title="删除用户" disabled={user.id === currentUserId} onClick={() => { if (window.confirm(`确定永久删除账号 ${user.id}？此操作不可撤销。`)) void run(() => requestJson(serverUrl, `/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })) }}><Trash2 size={14} /></button></div>)}{!loading && !users.length && <p className="empty-text">暂无用户</p>}</div>
    <div className="settings-group admin-list"><h3><DoorClosed size={15} />房间列表</h3>{rooms.map((room) => <div className="admin-row admin-room" key={room.id}><div><strong>{room.name}</strong><code>{room.id} · {room.userCount} 人</code></div><span>{room.hidden ? '隐藏' : '公开'} · {room.permanent ? '永久' : '临时'}</span><button className="button danger" onClick={() => { if (window.confirm(`确定解散房间 ${room.name}（${room.id}）？`)) void run(() => requestJson(serverUrl, `/api/admin/rooms/${encodeURIComponent(room.id)}/dissolve`, { method: 'POST' })) }}>解散</button></div>)}{!loading && !rooms.length && <p className="empty-text">暂无活跃房间</p>}</div>
  </div>
}

function resolveAsset(url: string): string { return url.startsWith('/') ? `${useAppStore.getState().serverUrl}${url}` : url }

function memberTimeSummary(member: RoomMember): string {
  const format = (value: number) => new Date(value).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return `加入 ${format(member.joinedAt)} · ${member.isOnline ? '当前在线' : `最后在线 ${format(member.lastSeenAt ?? member.joinedAt)}`}`
}
