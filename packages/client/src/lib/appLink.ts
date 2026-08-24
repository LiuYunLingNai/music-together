const ANDROID_PACKAGE = 'io.github.yueby.musictogether'
const APP_SCHEME = 'musictogether'
const APP_LINK_HOST = 'join'
const SHARE_PATH = '/join'
const ROOM_QUERY = 'ROMMid'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function isAndroidUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false
  return /android/i.test(userAgent)
}

export function buildRoomWebUrl(roomId: string, serverUrl: string): string {
  const url = new URL(`${trimTrailingSlash(serverUrl)}${SHARE_PATH}`)
  url.searchParams.set(ROOM_QUERY, roomId)
  return url.toString()
}

export function buildRoomBrowserUrl(roomId: string, serverUrl: string): string {
  return `${trimTrailingSlash(serverUrl)}/room/${encodeURIComponent(roomId)}`
}

export function buildRoomAppLink(roomId: string, serverUrl: string): string {
  const server = trimTrailingSlash(serverUrl)
  const query = new URLSearchParams({ [ROOM_QUERY]: roomId })
  if (server) query.set('server', server)
  return `${APP_SCHEME}://${APP_LINK_HOST}?${query.toString()}`
}

export function buildAndroidIntentUrl(roomId: string, serverUrl: string, fallbackUrl: string): string {
  const server = trimTrailingSlash(serverUrl)
  const query = new URLSearchParams({ [ROOM_QUERY]: roomId })
  if (server) query.set('server', server)
  const parts = [
    `intent://${APP_LINK_HOST}?${query.toString()}#Intent`,
    `scheme=${APP_SCHEME}`,
    `package=${ANDROID_PACKAGE}`,
    'action=android.intent.action.VIEW',
  ]
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`)
  parts.push('end')
  return parts.join(';')
}

export function resolveRoomOpenUrl(roomId: string, serverUrl: string, userAgent: string | undefined | null): string {
  const webUrl = buildRoomWebUrl(roomId, serverUrl)
  if (isAndroidUserAgent(userAgent)) return buildAndroidIntentUrl(roomId, serverUrl, webUrl)
  return buildRoomAppLink(roomId, serverUrl)
}

export const APP_LINK_CONSTANTS = {
  androidPackage: ANDROID_PACKAGE,
  scheme: APP_SCHEME,
  host: APP_LINK_HOST,
} as const
