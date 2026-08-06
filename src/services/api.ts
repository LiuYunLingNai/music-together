import type { AccountProfile, AdminRoom, AdminUser, AudioProxyPolicy, IdentityBootstrapResult, LyricLine, MusicSource, PlatformRecommendation, Playlist, Track } from '../domain/types'

export async function requestJson<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${serverUrl}${path}`, { ...init, headers, credentials: 'include' })
  const text = await response.text()
  if (!response.ok) {
    let message = ''
    try {
      message = text ? (JSON.parse(text) as { error?: string }).error ?? '' : ''
    } catch {
      if (text && !/^\s*</.test(text)) message = text.slice(0, 240)
    }
    throw new Error(message || `请求失败 (${response.status})`)
  }
  if (response.status === 204 || !text.trim()) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`服务器返回了无效的 JSON (${response.status})`)
  }
}

export async function bootstrapIdentity(serverUrl: string): Promise<IdentityBootstrapResult> {
  if (window.desktop) {
    return window.desktop.bootstrapIdentity(serverUrl)
  }
  const response = await fetch(`${serverUrl}/api/auth/identity/bootstrap`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) throw new Error(`身份初始化失败 (${response.status})`)
  const userId = response.headers.get('x-identity-userid') ?? response.headers.get('x-identity-user-id')
  if (!userId) throw new Error('服务器没有返回身份 ID')
  const expiresAt = Number(response.headers.get('x-identity-expires-at'))
  return { userId, expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined }
}

export async function searchTracks(
  serverUrl: string,
  roomId: string,
  source: MusicSource,
  keyword: string,
  page = 1,
  type: 'song' | 'album' | 'playlist' = 'song',
): Promise<{ items: Array<Track | Playlist>; hasMore: boolean }> {
  const params = new URLSearchParams({ source, keyword, limit: '30', page: String(page), type, roomId })
  const result = await requestJson<{ tracks: Array<Track | Playlist>; hasMore?: boolean }>(serverUrl, `/api/music/search?${params}`)
  return { items: result.tracks, hasMore: result.hasMore ?? result.tracks.length >= 30 }
}

export async function fetchRecommendations(serverUrl: string, roomId: string, limit = 50): Promise<PlatformRecommendation[]> {
  const params = new URLSearchParams({ roomId, limit: String(limit), refresh: String(Date.now()) })
  const result = await requestJson<{ recommendations?: PlatformRecommendation[] }>(serverUrl, `/api/music/recommendations?${params}`)
  return result.recommendations ?? []
}

export async function fetchBilibiliCollection(serverUrl: string, bvid: string): Promise<{ title?: string; tracks: Track[] }> {
  return requestJson(serverUrl, `/api/music/bilibili-collection?bvid=${encodeURIComponent(bvid)}`)
}

export interface ServerLyrics {
  lyric?: string
  tlyric?: string
  romalrc?: string
  yrc?: string
  wordByWord?: Array<{
    words: Array<{ word: string; startTime: number; endTime: number; romanWord?: string }>
    translatedLyric?: string
    romanLyric?: string
    startTime: number
    endTime: number
    isBG?: boolean
    isDuet?: boolean
  }>
}

export async function fetchServerLyrics(serverUrl: string, source: string, lyricId: string): Promise<ServerLyrics> {
  const params = new URLSearchParams({ source, lyricId })
  return requestJson(serverUrl, `/api/music/lyric?${params}`)
}

export async function fetchPlaylistTracks(serverUrl: string, roomId: string, source: MusicSource, id: string, offset = 0, total?: number, type: 'playlist' | 'album' = 'playlist'): Promise<{ tracks: Track[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ source, id, limit: '100', offset: String(offset), roomId, type })
  if (total) params.set('total', String(total))
  return requestJson(serverUrl, `/api/music/playlist?${params}`)
}

export function fetchCurrentProfile(serverUrl: string): Promise<AccountProfile | undefined> {
  return requestJson<AccountProfile | undefined>(serverUrl, '/api/auth/me')
}

export function updateCurrentProfile(serverUrl: string, nickname: string): Promise<AccountProfile> {
  return requestJson(serverUrl, '/api/auth/me', { method: 'PATCH', body: JSON.stringify({ nickname: nickname.trim() }) })
}

export function uploadCurrentAvatar(serverUrl: string, image: string): Promise<AccountProfile> {
  return requestJson(serverUrl, '/api/auth/me/avatar', { method: 'POST', body: JSON.stringify({ image }) })
}

export function setInitialPassword(serverUrl: string, password: string): Promise<{ accountId: string }> {
  return requestJson(serverUrl, '/api/auth/me/password', { method: 'POST', body: JSON.stringify({ password }) })
}

export function updateAccountId(serverUrl: string, accountId: string, currentPassword?: string): Promise<AccountProfile> {
  if (window.desktop) return window.desktop.updateAccountId(serverUrl, accountId.trim().toLowerCase(), currentPassword)
  return requestJson(serverUrl, '/api/auth/me/account-id', { method: 'PATCH', body: JSON.stringify({ accountId: accountId.trim().toLowerCase(), currentPassword }) })
}

export function recoverIdentity(serverUrl: string, accountId: string, password: string): Promise<{ userId: string; expiresAt: number }> {
  if (window.desktop) return window.desktop.recoverIdentity(serverUrl, accountId.trim(), password)
  return requestJson(serverUrl, '/api/auth/identity/recover', { method: 'POST', body: JSON.stringify({ accountId: accountId.trim(), password }) })
}

export function logoutIdentity(serverUrl: string): Promise<{ userId: string; expiresAt: number }> {
  if (window.desktop) return window.desktop.logoutIdentity(serverUrl)
  return requestJson(serverUrl, '/api/auth/identity/logout', { method: 'POST' })
}

export function fetchAdminUsers(serverUrl: string): Promise<{ users: AdminUser[] }> {
  return requestJson(serverUrl, '/api/admin/users')
}

export function fetchAdminRooms(serverUrl: string): Promise<{ rooms: AdminRoom[] }> {
  return requestJson(serverUrl, '/api/admin/rooms')
}

export function fetchAudioProxyPolicy(serverUrl: string): Promise<AudioProxyPolicy> {
  return requestJson(serverUrl, '/api/admin/audio-proxy-policy')
}

export function serverWordByWordToLines(input: NonNullable<ServerLyrics['wordByWord']>): LyricLine[] {
  return input.map((line) => ({
    words: line.words.map((word) => ({
      text: word.word,
      startTimeMs: word.startTime,
      endTimeMs: word.endTime,
      romanText: word.romanWord,
    })),
    translatedLyric: line.translatedLyric,
    romanLyric: line.romanLyric,
    startTimeMs: line.startTime,
    endTimeMs: line.endTime,
    isBackground: line.isBG,
    isDuet: line.isDuet,
  }))
}
