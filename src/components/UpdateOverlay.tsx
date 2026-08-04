import { Download, LoaderCircle, RefreshCw, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppUpdateState } from '../domain/types'
import { useAppStore } from '../store/app-store'

const STATUS_LABELS: Record<AppUpdateState, string> = {
  idle: '尚未检查',
  checking: '正在检查更新',
  available: '发现新版本',
  downloading: '正在下载更新',
  downloaded: '更新已准备好',
  'not-available': '当前已是最新版本',
  error: '更新操作失败',
  unsupported: '当前环境不支持自动更新',
}

export function UpdateOverlay({ onClose }: { onClose: () => void }) {
  const updateStatus = useAppStore((state) => state.updateStatus)
  const desktop = window.desktop
  const [downloadSource, setDownloadSource] = useState<'github' | 'ghfast'>('github')

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const action = updateStatus.state === 'available'
    ? { label: '下载更新', icon: <Download size={16} />, run: () => desktop?.downloadUpdate(downloadSource) ?? Promise.resolve() }
    : updateStatus.state === 'downloaded'
      ? { label: '重启并安装', icon: <RotateCw size={16} />, run: () => desktop?.installUpdate() ?? Promise.resolve() }
      : { label: updateStatus.state === 'error' ? '重新检查' : '检查更新', icon: <RefreshCw size={16} />, run: () => desktop?.checkForUpdate() ?? Promise.resolve() }
  const busy = updateStatus.state === 'checking' || updateStatus.state === 'downloading'
  const disabled = !desktop || busy || updateStatus.state === 'unsupported'
  const detail = updateStatus.state === 'downloading'
    ? `正在下载 Windows ${updateStatus.version ?? ''}，${updateStatus.percent ?? 0}%`
    : updateStatus.message

  return (
    <div className="modal-backdrop modal-backdrop--compact update-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="update-dialog" role="dialog" aria-modal="true" aria-label="应用更新">
        <header className="dialog-header">
          <div><span>应用更新</span><h2>Windows 客户端</h2></div>
          <button className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="update-dialog__body">
          <div className="update-dialog__summary"><span className={`update-dialog__status update-state--${updateStatus.state}`}>{STATUS_LABELS[updateStatus.state]}</span><code>当前版本 v{updateStatus.currentVersion}</code></div>
          {updateStatus.version && <div className="update-dialog__version"><span>可用版本</span><strong>v{updateStatus.version}</strong></div>}
          {updateStatus.state === 'available' && <div className="update-dialog__source"><span>下载源</span><div className="update-source-picker" role="group" aria-label="更新下载源"><button type="button" className={downloadSource === 'github' ? 'is-selected' : ''} aria-pressed={downloadSource === 'github'} onClick={() => setDownloadSource('github')}>GitHub 直连</button><button type="button" className={downloadSource === 'ghfast' ? 'is-selected' : ''} aria-pressed={downloadSource === 'ghfast'} onClick={() => setDownloadSource('ghfast')}>ghfast.top 代理</button></div></div>}
          {updateStatus.state === 'downloading' && <div className="update-progress" aria-label={`下载进度 ${updateStatus.percent ?? 0}%`}><span style={{ width: `${updateStatus.percent ?? 0}%` }} /></div>}
          <p className="update-dialog__detail">{detail || '检查并安装最新的 Windows 客户端版本。'}</p>
          {updateStatus.releaseNotes && <section className="update-dialog__notes" aria-label="更新日志"><h3>更新日志</h3><p>{updateStatus.releaseNotes}</p></section>}
          {updateStatus.state === 'unsupported' && <p className="update-dialog__hint">仅安装版 Windows 客户端支持自动下载和安装。便携版请从 Windows Release 手动下载新版。</p>}
        </div>
        <footer className="update-dialog__actions">
          <button className="button" onClick={onClose}>关闭</button>
          <button className="button button--primary" disabled={disabled} onClick={() => void action.run().catch(() => undefined)}>{busy ? <LoaderCircle className="spin" size={16} /> : action.icon}{busy ? STATUS_LABELS[updateStatus.state] : action.label}</button>
        </footer>
      </section>
    </div>
  )
}
