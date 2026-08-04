import { useEffect, useState } from 'react'
import { useAppStore } from './store/app-store'
import { Titlebar } from './components/Titlebar'
import { Sidebar } from './components/Sidebar'
import { Lobby } from './components/Lobby'
import { NowPlaying } from './components/NowPlaying'
import { RoomPanel } from './components/RoomPanel'
import { TransportBar } from './components/TransportBar'
import { SearchOverlay } from './components/SearchOverlay'
import { VoteBanner } from './components/VoteBanner'
import { SettingsOverlay } from './components/SettingsOverlay'
import { syncSystemTheme } from './services/theme'

export default function App() {
  const room = useAppStore((state) => state.room)
  const notice = useAppStore((state) => state.notice)
  const searchOpen = useAppStore((state) => state.searchOpen)
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const set = useAppStore((state) => state.set)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

  useEffect(() => {
    if (!room) setRightPanelOpen(true)
  }, [room])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => set({ notice: undefined }), 4_000)
    return () => window.clearTimeout(timer)
  }, [notice, set])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', syncSystemTheme)
    return () => media.removeEventListener('change', syncSystemTheme)
  }, [])

  return (
    <div className="app-shell">
      <Titlebar />
      <div className={`workspace ${room ? `workspace--room${rightPanelOpen ? '' : ' workspace--room-collapsed'}` : 'workspace--lobby'}`}>
        <Sidebar />
        <main className="main-stage">
          {room ? <NowPlaying /> : <Lobby />}
        </main>
        {room && <RoomPanel collapsed={!rightPanelOpen} onToggle={() => setRightPanelOpen((open) => !open)} />}
      </div>
      {room && <TransportBar />}
      {room && <VoteBanner />}
      {searchOpen && <SearchOverlay />}
      {settingsOpen && <SettingsOverlay />}
      {room && connectionStatus !== 'connected' && <div className="reconnect-banner" role="status">{connectionStatus === 'reconnecting' ? '连接中断，正在恢复房间与播放状态…' : '服务器连接已断开，操作将在重连后恢复'}</div>}
      {notice && <div className={`toast ${notice.error ? 'toast--error' : ''}`} role="status">{notice.text}</div>}
    </div>
  )
}
