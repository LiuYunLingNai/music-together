import { app, BrowserWindow, ipcMain, nativeTheme, session, shell, type Session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const identityTokens = new Map<string, string>()

// Avoid startup crashes on Windows systems whose GPU driver cannot initialize Chromium's compositor.
app.disableHardwareAcceleration()

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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
