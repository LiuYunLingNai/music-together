import { AudioLines, Download, FileDown, LoaderCircle, Maximize2, Minimize2, Minus, Moon, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { setThemePreference } from '../services/theme'

export function Titlebar({ onOpenUpdate, onExportLogs }: { onOpenUpdate: () => void; onExportLogs: () => void }) {
  const room = useAppStore((state) => state.room)
  const status = useAppStore((state) => state.connectionStatus)
  const centerView = useAppStore((state) => state.centerView)
  const resolvedTheme = useAppStore((state) => state.resolvedTheme)
  const updateStatus = useAppStore((state) => state.updateStatus)
  const set = useAppStore((state) => state.set)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.desktop?.isMaximized().then(setMaximized)
    return window.desktop?.onMaximizedChange(setMaximized)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <span className="brand-mark"><AudioLines size={16} strokeWidth={2.4} /></span>
        <span>Music Together</span>
      </div>
      <div className="titlebar__context">
        {room ? <><span className={`status-dot status-dot--${status}`} />{room.name}{status === 'reconnecting' ? ' · 重连中' : status === 'disconnected' ? ' · 已断线' : ''}</> : <><span className={`status-dot status-dot--${status}`} />桌面客户端</>}
      </div>
      {room && (
        <div className="view-switch" aria-label="主视图">
          <button className={centerView === 'lyrics' ? 'is-active' : ''} onClick={() => set({ centerView: 'lyrics' })}>歌词</button>
          <button className={centerView === 'artwork' ? 'is-active' : ''} onClick={() => set({ centerView: 'artwork' })}>封面</button>
        </div>
      )}
      {window.desktop?.isDebug && <button className="titlebar__logs icon-button" title="导出调试日志" aria-label="导出调试日志" onClick={onExportLogs}><FileDown size={16} /></button>}
      <button
        className={`titlebar__update icon-button${['available', 'downloaded', 'error'].includes(updateStatus.state) ? ' has-update' : ''}`}
        title="应用更新"
        aria-label="应用更新"
        onClick={onOpenUpdate}
      >
        {updateStatus.state === 'checking' || updateStatus.state === 'downloading' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
      </button>
      <button
        className="titlebar__theme icon-button"
        title={resolvedTheme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
        onClick={(event) => void setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark', event.clientX, event.clientY)}
      >
        {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <div className="window-controls">
        <button title="最小化" onClick={() => window.desktop?.minimize()}><Minus size={15} /></button>
        <button title={maximized ? '还原' : '最大化'} onClick={() => window.desktop?.toggleMaximize()}>
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="window-close" title="关闭" onClick={() => window.desktop?.close()}><X size={16} /></button>
      </div>
    </header>
  )
}
