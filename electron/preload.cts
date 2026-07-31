import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
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
  bootstrapIdentity: (serverUrl: string) => ipcRenderer.invoke('server:bootstrap-identity', serverUrl) as Promise<{ userId: string; expiresAt?: number }>,
  syncIdentityCookie: (serverUrl: string) => ipcRenderer.invoke('server:sync-identity-cookie', serverUrl) as Promise<void>,
  recoverIdentity: (serverUrl: string, accountId: string, password: string) => ipcRenderer.invoke('server:recover-identity', serverUrl, accountId, password) as Promise<{ userId: string; expiresAt: number }>,
  logoutIdentity: (serverUrl: string) => ipcRenderer.invoke('server:logout-identity', serverUrl) as Promise<{ userId: string; expiresAt: number }>,
  updateAccountId: (serverUrl: string, accountId: string, currentPassword?: string) => ipcRenderer.invoke('server:update-account-id', serverUrl, accountId, currentPassword) as Promise<Record<string, unknown>>,
})
