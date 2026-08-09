import { useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
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
import { UpdateOverlay } from './components/UpdateOverlay'
import { syncSystemTheme } from './services/theme'
import { joinRoom } from './services/runtime'

export default function App() {
  const room = useAppStore((state) => state.room)
  const notice = useAppStore((state) => state.notice)
  const searchOpen = useAppStore((state) => state.searchOpen)
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const set = useAppStore((state) => state.set)
  const deepLinkRoomId = useAppStore((state) => state.deepLinkRoomId)
  const immersivePlayer = useAppStore((state) => state.immersivePlayer)
  const controlsMode = useAppStore((state) => state.playerVisualSettings.controlsMode)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [controlsIdle, setControlsIdle] = useState(false)

  const exportLogs = async () => {
    if (!window.desktop?.isDebug) {
      set({ notice: { id: Date.now(), text: '正式版不支持导出调试日志', error: true } })
      return
    }
    try {
      const result = await window.desktop.exportLogs()
      if (!result.canceled) set({ notice: { id: Date.now(), text: `调试日志已导出到 ${result.path}` } })
    } catch (error) {
      set({ notice: { id: Date.now(), text: error instanceof Error ? `导出日志失败：${error.message}` : '导出日志失败', error: true } })
    }
  }

  useEffect(() => {
    setLeftPanelOpen(true)
    setRightPanelOpen(true)
  }, [room?.id])

  useEffect(() => {
    if (room || !immersivePlayer) return
    set({ immersivePlayer: false })
  }, [immersivePlayer, room, set])

  useEffect(() => {
    if (!room) {
      setControlsIdle(false)
      return
    }
    let timer = 0
    let activityFrame = 0
    const showControls = () => {
      setControlsIdle(false)
      window.clearTimeout(timer)
      if (controlsMode === 'auto') timer = window.setTimeout(() => setControlsIdle(true), 2_600)
    }
    const onPointerMove = () => {
      if (activityFrame) return
      activityFrame = window.requestAnimationFrame(() => {
        activityFrame = 0
        showControls()
      })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const state = useAppStore.getState()
        if (state.playerQuickSettingsOpen || state.lyricsOverviewOpen) set({ playerQuickSettingsOpen: false, lyricsOverviewOpen: false })
        else if (state.immersivePlayer) set({ immersivePlayer: false })
      }
      else showControls()
    }
    showControls()
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      window.cancelAnimationFrame(activityFrame)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [controlsMode, room?.id, set])

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

  useEffect(() => {
    const desktop = window.desktop
    if (!desktop) return
    const unsubscribe = desktop.onUpdateStatus((updateStatus) => set({ updateStatus }))
    void desktop.getUpdateStatus().then((updateStatus) => set({ updateStatus }))
    return unsubscribe
  }, [set])

  useEffect(() => {
    const desktop = window.desktop
    if (!desktop) return
    void desktop.getPendingRoomId().then((roomId) => { if (roomId) set({ deepLinkRoomId: roomId }) })
    return desktop.onRoomOpen((roomId) => set({ deepLinkRoomId: roomId }))
  }, [set])

  useEffect(() => {
    if (!deepLinkRoomId || connectionStatus !== 'connected' || room?.id === deepLinkRoomId) return
    joinRoom(deepLinkRoomId)
    set({ deepLinkRoomId: undefined })
  }, [deepLinkRoomId, connectionStatus, room?.id, set])

  return (
    <div className={`app-shell app-shell--controls-${controlsMode} ${immersivePlayer ? 'app-shell--immersive' : ''} ${room && (controlsIdle || controlsMode === 'hidden') ? 'app-shell--idle' : ''}`}>
      <Titlebar onOpenUpdate={() => setUpdateDialogOpen(true)} onExportLogs={() => void exportLogs()} />
      <div className={`workspace ${room ? `workspace--room workspace--left-${leftPanelOpen ? 'open' : 'closed'} workspace--right-${rightPanelOpen ? 'open' : 'closed'}${immersivePlayer ? ' workspace--immersive' : ''}` : 'workspace--lobby'}`}>
        <Sidebar hidden={Boolean(room) && !leftPanelOpen} />
        {room && <button className={`side-panel-toggle side-panel-toggle--left ${leftPanelOpen ? 'is-open' : 'is-closed'}`} type="button" title={leftPanelOpen ? '收起房间面板' : '展开房间面板'} aria-label={leftPanelOpen ? '收起房间面板' : '展开房间面板'} aria-controls="room-navigation-panel" aria-expanded={leftPanelOpen} onClick={() => setLeftPanelOpen((open) => !open)}>{leftPanelOpen ? <PanelLeftClose size={16} /> : <><PanelLeftOpen size={16} /><span>房间</span></>}</button>}
        <main className="main-stage">
          {room ? <NowPlaying /> : <Lobby />}
        </main>
        {room && <RoomPanel collapsed={!rightPanelOpen} onToggle={() => setRightPanelOpen((open) => !open)} />}
      </div>
      {room && <TransportBar rightPanelOpen={rightPanelOpen} onToggleRightPanel={() => setRightPanelOpen((open) => !open)} />}
      {room && <VoteBanner />}
      {searchOpen && <SearchOverlay />}
      {settingsOpen && <SettingsOverlay />}
      {updateDialogOpen && <UpdateOverlay onClose={() => setUpdateDialogOpen(false)} />}
      {room && connectionStatus !== 'connected' && <div className="reconnect-banner" role="status">{connectionStatus === 'reconnecting' ? '连接中断，正在恢复房间与播放状态…' : '服务器连接已断开，操作将在重连后恢复'}</div>}
      <UpdateBanner />
      {notice && <div className={`toast ${notice.error ? 'toast--error' : ''}`} role="status">{notice.text}</div>}
    </div>
  )
}

function UpdateBanner() {
  const updateStatus = useAppStore((state) => state.updateStatus)
  if (!['available', 'downloading', 'downloaded', 'error'].includes(updateStatus.state)) return null
  const run = (action: () => Promise<unknown>) => void action().catch(() => undefined)
  const action = updateStatus.state === 'available' ? { label: '下载更新', run: () => window.desktop?.downloadUpdate() ?? Promise.resolve() }
    : updateStatus.state === 'downloaded' ? { label: '重启安装', run: () => window.desktop?.installUpdate() ?? Promise.resolve() }
      : updateStatus.state === 'error' ? { label: '重新检查', run: () => window.desktop?.checkForUpdate() ?? Promise.resolve() } : null
  const message = updateStatus.state === 'downloading' ? `正在下载 Windows ${updateStatus.version ?? ''} ${updateStatus.percent ?? 0}%` : updateStatus.message
  return <div className={`update-banner update-banner--${updateStatus.state}`} role="status"><div><strong>{updateStatus.state === 'downloaded' ? '更新已就绪' : updateStatus.state === 'error' ? '更新失败' : '发现新版本'}</strong><span>{message}</span></div>{action && <button className="button button--primary" onClick={() => run(action.run)}>{action.label}</button>}</div>
}
