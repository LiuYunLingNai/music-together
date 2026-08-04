import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell, type Session } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const isPackagedDebugBuild = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(currentDirectory, '../package.json'), 'utf8')) as { debugBuild?: boolean }
    return packageJson.debugBuild === true
  } catch {
    return false
  }
})()
const isDebugBuild = isDevelopment || process.env.MT_DEBUG_BUILD === '1' || isPackagedDebugBuild
const identityTokens = new Map<string, string>()
const windowsReleaseApi = 'https://api.github.com/repos/LiuYunLingNai/music-together/releases?per_page=100'

type AppUpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unsupported'
type UpdateDownloadSource = 'github' | 'ghfast'
type AppUpdateStatus = { state: AppUpdateState; currentVersion: string; version?: string; percent?: number; message?: string; releaseNotes?: string }
type WindowsRelease = { version: string; installerUrl: string; checksumUrl: string; releaseNotes: string }
type GitHubAsset = { name: string; browser_download_url: string }
type GitHubRelease = { tag_name: string; draft: boolean; prerelease: boolean; body?: string; assets: GitHubAsset[] }

let appUpdateStatus: AppUpdateStatus = { state: 'idle', currentVersion: app.getVersion() }
let availableWindowsRelease: WindowsRelease | null = null
let downloadedInstaller = ''
let updateDownload: Promise<AppUpdateStatus> | null = null
const diagnosticLogs: string[] = []

function appendDiagnosticLog(level: string, message: string): void {
  diagnosticLogs.push(`${new Date().toISOString()} [${level.toUpperCase()}] ${message}`)
  if (diagnosticLogs.length > 2_000) diagnosticLogs.splice(0, diagnosticLogs.length - 2_000)
}

appendDiagnosticLog('info', `Music Together started; version=${app.getVersion()} platform=${process.platform} packaged=${app.isPackaged}`)

// Avoid startup crashes on Windows systems whose GPU driver cannot initialize Chromium's compositor.
app.disableHardwareAcceleration()

function updatesSupported(): boolean {
  return app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR
}

function publishUpdateStatus(next: Omit<AppUpdateStatus, 'currentVersion'> & Partial<Pick<AppUpdateStatus, 'currentVersion'>>): AppUpdateStatus {
  appUpdateStatus = { ...next, currentVersion: next.currentVersion ?? app.getVersion() }
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('app-update:status', appUpdateStatus)
  return appUpdateStatus
}

function versionParts(value: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  if (!leftParts || !rightParts) return 0
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

function updateDownloadUrl(url: string, source: UpdateDownloadSource): string {
  return source === 'ghfast' ? `https://ghfast.top/${url}` : url
}

async function latestWindowsRelease(): Promise<WindowsRelease | null> {
  const response = await fetch(windowsReleaseApi, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'music-together-desktop' } })
  if (!response.ok) throw new Error(`更新服务器请求失败 (${response.status})`)
  const releases = await response.json() as GitHubRelease[]
  return releases
    .filter((release) => !release.draft && !release.prerelease && release.tag_name.startsWith('windows-v'))
    .map((release) => {
      const version = release.tag_name.slice('windows-v'.length)
      const installer = release.assets.find((asset) => /^(?:Music Together Setup |Music\.Together\.Setup\.).+\.exe$/i.test(asset.name))
      const checksum = installer && release.assets.find((asset) => asset.name === `${installer.name}.sha256`)
      return installer && checksum && versionParts(version)
        ? { version, installerUrl: installer.browser_download_url, checksumUrl: checksum.browser_download_url, releaseNotes: release.body?.trim() ?? '' }
        : null
    })
    .filter((release): release is WindowsRelease => release !== null)
    .sort((left, right) => compareVersions(right.version, left.version))[0] ?? null
}

function updateErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function expectedUpdateChecksum(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'music-together-desktop' } })
  if (!response.ok) throw new Error(`更新校验文件请求失败 (${response.status})`)
  const checksum = (await response.text()).match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase()
  if (!checksum) throw new Error('更新校验文件格式无效')
  return checksum
}

async function checkForUpdate(): Promise<AppUpdateStatus> {
  if (!updatesSupported()) {
    return publishUpdateStatus({ state: 'unsupported', message: app.isPackaged ? '便携版暂不支持自动更新，请下载新版安装包。' : '开发环境不检查应用更新。' })
  }

  publishUpdateStatus({ state: 'checking', message: '正在检查更新…' })
  try {
    const release = await latestWindowsRelease()
    if (!release || !isNewerVersion(release.version, app.getVersion())) {
      availableWindowsRelease = null
      return publishUpdateStatus({ state: 'not-available', message: '当前已是最新版本。' })
    }
    availableWindowsRelease = release
    return publishUpdateStatus({ state: 'available', version: release.version, releaseNotes: release.releaseNotes, message: `发现 Windows ${release.version}。` })
  } catch (error) {
    return publishUpdateStatus({ state: 'error', message: updateErrorMessage(error, '检查更新失败。') })
  }
}

async function downloadAvailableUpdate(source: UpdateDownloadSource = 'github'): Promise<AppUpdateStatus> {
  if (updateDownload) return updateDownload
  updateDownload = (async () => {
    if (!updatesSupported()) return publishUpdateStatus({ state: 'unsupported', message: '便携版暂不支持自动更新，请下载新版安装包。' })
    if (!availableWindowsRelease) await checkForUpdate()
    if (!availableWindowsRelease) return appUpdateStatus

    const release = availableWindowsRelease
    publishUpdateStatus({ state: 'downloading', version: release.version, percent: 0, releaseNotes: release.releaseNotes, message: '正在下载更新…' })
    try {
      const [checksum, response] = await Promise.all([
        expectedUpdateChecksum(updateDownloadUrl(release.checksumUrl, source)),
        fetch(updateDownloadUrl(release.installerUrl, source), { headers: { 'User-Agent': 'music-together-desktop' } }),
      ])
      if (!response.ok || !response.body) throw new Error(`更新下载安装包失败 (${response.status})`)
      const total = Number(response.headers.get('content-length'))
      const directory = path.join(app.getPath('temp'), 'music-together-updates')
      await mkdir(directory, { recursive: true })
      const destination = path.join(directory, `Music-Together-Setup-${release.version}.exe`)
      const file = await open(destination, 'w')
      const reader = response.body.getReader()
      const hash = createHash('sha256')
      let received = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          await file.write(chunk.value)
          hash.update(chunk.value)
          received += chunk.value.byteLength
          if (Number.isFinite(total) && total > 0) {
            publishUpdateStatus({ state: 'downloading', version: release.version, percent: Math.min(99, Math.round(received / total * 100)), releaseNotes: release.releaseNotes, message: '正在下载更新…' })
          }
        }
      } finally {
        await file.close()
      }
      if (hash.digest('hex') !== checksum) throw new Error('更新安装包校验失败')
      downloadedInstaller = destination
      return publishUpdateStatus({ state: 'downloaded', version: release.version, percent: 100, releaseNotes: release.releaseNotes, message: '更新已下载，重启后安装。' })
    } catch (error) {
      return publishUpdateStatus({ state: 'error', version: release.version, releaseNotes: release.releaseNotes, message: updateErrorMessage(error, '下载更新失败。') })
    }
  })().finally(() => { updateDownload = null })
  return updateDownload
}

async function installDownloadedUpdate(): Promise<void> {
  if (!downloadedInstaller) throw new Error('请先下载更新')
  const launchError = await shell.openPath(downloadedInstaller)
  if (launchError) throw new Error(launchError)
  app.quit()
}

function parseServerUrl(input: string): URL {
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('仅支持 HTTP 或 HTTPS 服务器')
  return url
}

function requestOrigin(input: string): string | null {
  try {
    const url = new URL(input)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    return url.origin
  } catch {
    return null
  }
}

function withIdentityCookie(existing: string | undefined, token: string): string {
  const cookies = (existing ?? '').split(';').map((value) => value.trim()).filter(Boolean)
    .filter((value) => !value.toLowerCase().startsWith('mt_identity='))
  cookies.push(`mt_identity=${encodeURIComponent(token)}`)
  return cookies.join('; ')
}

function identityTokenFromResponse(response: Response): string | undefined {
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = /(?:^|[,;]\s*)mt_identity=([^;]+)/i.exec(setCookie)
  if (!match?.[1]) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

async function persistIdentity(clientSession: Session, serverUrl: URL, token: string, expiresAt?: number): Promise<void> {
  identityTokens.set(serverUrl.origin, token)
  await clientSession.cookies.set({
    url: `${serverUrl.origin}/`,
    name: 'mt_identity',
    value: token,
    path: '/',
    httpOnly: true,
    secure: serverUrl.protocol === 'https:',
    sameSite: serverUrl.protocol === 'https:' ? 'no_restriction' : 'unspecified',
    expirationDate: Number.isFinite(expiresAt) ? expiresAt! / 1000 : undefined,
  })
}

async function identityTransition(
  clientSession: Session,
  input: string,
  pathName: '/api/auth/identity/recover' | '/api/auth/identity/logout',
  body?: Record<string, string>,
): Promise<{ userId: string; expiresAt: number }> {
  const serverUrl = parseServerUrl(input)
  const cookies = await clientSession.cookies.get({ url: `${serverUrl.origin}/`, name: 'mt_identity' })
  const currentToken = identityTokens.get(serverUrl.origin) ?? cookies[0]?.value
  const response = await fetch(`${serverUrl.origin}${pathName}`, {
    method: 'POST',
    headers: {
      ...(currentToken ? { Cookie: `mt_identity=${encodeURIComponent(currentToken)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data: { userId?: string; expiresAt?: number; error?: string } = {}
  try {
    data = text ? JSON.parse(text) as typeof data : {}
  } catch {
    if (!response.ok && text && !/^\s*</.test(text)) data.error = text.slice(0, 240)
  }
  if (!response.ok) throw new Error(data.error || `身份请求失败 (${response.status})`)

  const token = identityTokenFromResponse(response)
  if (!token || !data.userId || !Number.isFinite(data.expiresAt)) {
    throw new Error('服务器没有返回完整的身份凭据')
  }
  await persistIdentity(clientSession, serverUrl, token, data.expiresAt)
  return { userId: data.userId, expiresAt: data.expiresAt! }
}

async function accountIdTransition(
  clientSession: Session,
  input: string,
  accountId: string,
  currentPassword?: string,
): Promise<Record<string, unknown>> {
  const serverUrl = parseServerUrl(input)
  const cookies = await clientSession.cookies.get({ url: `${serverUrl.origin}/`, name: 'mt_identity' })
  const currentToken = identityTokens.get(serverUrl.origin) ?? cookies[0]?.value
  if (!currentToken) throw new Error('当前服务器没有可用的身份凭据')
  const response = await fetch(`${serverUrl.origin}/api/auth/me/account-id`, {
    method: 'PATCH',
    headers: {
      Cookie: `mt_identity=${encodeURIComponent(currentToken)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accountId: accountId.trim().toLowerCase(), currentPassword }),
  })
  const text = await response.text()
  let data: Record<string, unknown> & { error?: string; id?: string; expiresAt?: number } = {}
  try {
    data = text ? JSON.parse(text) as typeof data : {}
  } catch {
    if (!response.ok && text && !/^\s*</.test(text)) data.error = text.slice(0, 240)
  }
  if (!response.ok) throw new Error(data.error || `账号 ID 修改失败 (${response.status})`)

  const token = identityTokenFromResponse(response)
  if (!token || !data.id || !Number.isFinite(data.expiresAt)) {
    throw new Error('服务器没有返回完整的账号身份凭据')
  }
  await persistIdentity(clientSession, serverUrl, token, data.expiresAt)
  return data
}

function registerIdentityRequestHeaders(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const origin = requestOrigin(details.url)
    const token = origin ? identityTokens.get(origin) : undefined
    if (!token) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }

    const url = new URL(details.url)
    if (url.pathname !== '/ws' && !url.pathname.startsWith('/api/')) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }

    const cookieHeader = Object.keys(details.requestHeaders).find((name) => name.toLowerCase() === 'cookie')
    const existing = cookieHeader ? details.requestHeaders[cookieHeader] : undefined
    if (cookieHeader) delete details.requestHeaders[cookieHeader]
    details.requestHeaders.Cookie = withIdentityCookie(Array.isArray(existing) ? existing.join('; ') : existing, token)
    callback({ requestHeaders: details.requestHeaders })
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#101114',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    appendDiagnosticLog('error', `render process exited; reason=${details.reason} exitCode=${details.exitCode}`)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendDiagnosticLog('error', `page load failed; code=${errorCode} description=${errorDescription} url=${validatedURL}`)
  })

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!)
  } else {
    void window.loadFile(path.join(currentDirectory, '../dist/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system'
  registerIdentityRequestHeaders()
  createWindow()
  if (!updatesSupported()) publishUpdateStatus({ state: 'unsupported', message: app.isPackaged ? '便携版暂不支持自动更新，请下载新版安装包。' : '开发环境不检查应用更新。' })
  else setTimeout(() => void checkForUpdate(), 8_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtExceptionMonitor', (error, origin) => {
  appendDiagnosticLog('error', `uncaught exception (${origin}): ${error.stack ?? error.message}`)
})

ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.on('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
})
ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
ipcMain.handle('system:open-external', (_event, url: string) => {
  if (url.startsWith('https://') || url.startsWith('http://')) return shell.openExternal(url)
})
ipcMain.handle('system:set-theme-source', (_event, source: string) => {
  if (source !== 'system' && source !== 'light' && source !== 'dark') throw new Error('Invalid theme source')
  nativeTheme.themeSource = source
})
ipcMain.on('debug:log', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return
  const value = payload as { level?: unknown; message?: unknown }
  if (typeof value.message !== 'string') return
  appendDiagnosticLog(typeof value.level === 'string' ? value.level : 'info', value.message.slice(0, 4_000))
})
ipcMain.on('debug:is-enabled', (event) => {
  event.returnValue = isDebugBuild
})
ipcMain.handle('debug:export-logs', async (event) => {
  if (!isDebugBuild) throw new Error('正式版不支持导出调试日志')
  const owner = BrowserWindow.fromWebContents(event.sender)
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-')
  const saveOptions = {
    title: '导出 Music Together 调试日志',
    defaultPath: path.join(app.getPath('downloads'), `music-together-debug-${timestamp}.log`),
    filters: [{ name: '日志文件', extensions: ['log', 'txt'] }],
  }
  const result = owner ? await dialog.showSaveDialog(owner, saveOptions) : await dialog.showSaveDialog(saveOptions)
  if (result.canceled || !result.filePath) return { canceled: true }
  const report = [
    'Music Together debug log',
    `version: ${app.getVersion()}`,
    `platform: ${process.platform} ${process.arch}`,
    `packaged: ${app.isPackaged}`,
    `electron: ${process.versions.electron}`,
    `chromium: ${process.versions.chrome}`,
    `node: ${process.versions.node}`,
    '',
    ...diagnosticLogs,
    '',
  ].join('\n')
  await writeFile(result.filePath, report, 'utf8')
  appendDiagnosticLog('info', `diagnostic log exported to ${result.filePath}`)
  return { canceled: false, path: result.filePath }
})
ipcMain.handle('app-update:get-status', () => appUpdateStatus)
ipcMain.handle('app-update:check', () => checkForUpdate())
ipcMain.handle('app-update:download', (_event, source?: UpdateDownloadSource) => downloadAvailableUpdate(source === 'ghfast' ? 'ghfast' : 'github'))
ipcMain.handle('app-update:install', async () => {
  try {
    await installDownloadedUpdate()
  } catch (error) {
    publishUpdateStatus({ state: 'error', version: appUpdateStatus.version, message: updateErrorMessage(error, '启动安装程序失败。') })
    throw error
  }
})
ipcMain.handle('server:bootstrap-identity', async (event, input: string) => {
  const serverUrl = parseServerUrl(input)
  const cookieUrl = `${serverUrl.origin}/`
  const storedCookies = await event.sender.session.cookies.get({ url: cookieUrl, name: 'mt_identity' })
  const storedToken = storedCookies[0]?.value
  const response = await fetch(`${serverUrl.origin}/api/auth/identity/bootstrap`, {
    method: 'POST',
    headers: storedToken ? { Cookie: `mt_identity=${encodeURIComponent(storedToken)}` } : undefined,
  })
  if (!response.ok) throw new Error(`身份初始化失败 (${response.status})`)

  const token = identityTokenFromResponse(response) ?? storedToken
  if (!token) throw new Error('服务器没有返回身份凭据')

  const expiresAt = Number(response.headers.get('x-identity-expires-at'))
  await persistIdentity(event.sender.session, serverUrl, token, Number.isFinite(expiresAt) ? expiresAt : undefined)
  const userId = response.headers.get('x-identity-userid') ?? response.headers.get('x-identity-user-id')
  if (!userId) throw new Error('服务器没有返回身份 ID')
  return { userId, expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined }
})
ipcMain.handle('server:sync-identity-cookie', async (event, input: string) => {
  const serverUrl = parseServerUrl(input)
  const cookies = await event.sender.session.cookies.get({ url: `${serverUrl.origin}/`, name: 'mt_identity' })
  const token = cookies[0]?.value
  if (!token) throw new Error('当前服务器没有可用的身份凭据')
  identityTokens.set(serverUrl.origin, token)
})
ipcMain.handle('server:recover-identity', (event, input: string, accountId: string, password: string) => {
  if (!accountId?.trim() || !password) throw new Error('账号 ID 和密码不能为空')
  return identityTransition(event.sender.session, input, '/api/auth/identity/recover', { accountId: accountId.trim(), password })
})
ipcMain.handle('server:logout-identity', (event, input: string) =>
  identityTransition(event.sender.session, input, '/api/auth/identity/logout'))
ipcMain.handle('server:update-account-id', (event, input: string, accountId: string, currentPassword?: string) => {
  if (!/^[a-z0-9_-]{3,32}$/.test(accountId?.trim().toLowerCase())) throw new Error('账号 ID 格式不正确')
  return accountIdTransition(event.sender.session, input, accountId, currentPassword)
})
