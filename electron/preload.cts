import { contextBridge, ipcRenderer } from 'electron'

type AppUpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unsupported'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

function formatLogValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? String(value) : serialized
  } catch {
    return String(value)
  }
}

const originalConsole: Record<ConsoleLevel, (...data: unknown[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
}

for (const level of Object.keys(originalConsole) as ConsoleLevel[]) {
  console[level] = ((...data: unknown[]) => {
    originalConsole[level](...data)
    ipcRenderer.send('debug:log', { level, message: data.map(formatLogValue).join(' ') })
  }) as typeof console[ConsoleLevel]
}

window.addEventListener('error', (event) => {
  ipcRenderer.send('debug:log', { level: 'error', message: `window error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}` })
})
window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send('debug:log', { level: 'error', message: `unhandled rejection: ${formatLogValue(event.reason)}` })
})

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDebug: ipcRenderer.sendSync('debug:is-enabled') as boolean,
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
  onMaximizedChange: (listener: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  },
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url) as Promise<void>,
  setThemeSource: (source: 'system' | 'light' | 'dark') => ipcRenderer.invoke('system:set-theme-source', source) as Promise<void>,
  exportLogs: () => ipcRenderer.invoke('debug:export-logs') as Promise<{ canceled: boolean; path?: string }>,
  getUpdateStatus: () => ipcRenderer.invoke('app-update:get-status') as Promise<AppUpdateStatus>,
  checkForUpdate: () => ipcRenderer.invoke('app-update:check') as Promise<AppUpdateStatus>,
  downloadUpdate: () => ipcRenderer.invoke('app-update:download') as Promise<AppUpdateStatus>,
  installUpdate: () => ipcRenderer.invoke('app-update:install') as Promise<void>,
  onUpdateStatus: (listener: (status: AppUpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => listener(status)
    ipcRenderer.on('app-update:status', handler)
    return () => ipcRenderer.removeListener('app-update:status', handler)
  },
  bootstrapIdentity: (serverUrl: string) => ipcRenderer.invoke('server:bootstrap-identity', serverUrl) as Promise<{ userId: string; expiresAt?: number }>,
  syncIdentityCookie: (serverUrl: string) => ipcRenderer.invoke('server:sync-identity-cookie', serverUrl) as Promise<void>,
  recoverIdentity: (serverUrl: string, accountId: string, password: string) => ipcRenderer.invoke('server:recover-identity', serverUrl, accountId, password) as Promise<{ userId: string; expiresAt: number }>,
  logoutIdentity: (serverUrl: string) => ipcRenderer.invoke('server:logout-identity', serverUrl) as Promise<{ userId: string; expiresAt: number }>,
  updateAccountId: (serverUrl: string, accountId: string, currentPassword?: string) => ipcRenderer.invoke('server:update-account-id', serverUrl, accountId, currentPassword) as Promise<Record<string, unknown>>,
})
