import type { Track, UserPlaylist, UserPlaylistDetail } from '@music-together/shared'
import { SERVER_URL } from './config'
import { useAccountPlaylistStore } from '@/stores/accountPlaylistStore'

export class PlaylistIdentityChangedError extends Error {
  constructor() {
    super('账号已切换，请重新操作')
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const generation = useAccountPlaylistStore.getState().generation
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => null)
  if (generation !== useAccountPlaylistStore.getState().generation) throw new PlaylistIdentityChangedError()
  if (!response.ok) {
    throw new Error(body?.error ?? `请求失败：${response.status}`)
  }
  return body as T
}

export function fetchUserPlaylists(): Promise<UserPlaylist[]> {
  return request<{ playlists: UserPlaylist[] }>('/api/playlists').then((data) => data.playlists)
}

export function fetchUserPlaylistDetail(id: string): Promise<UserPlaylistDetail> {
  return request<{ playlist: UserPlaylistDetail }>(`/api/playlists/${encodeURIComponent(id)}`).then(
    (data) => data.playlist,
  )
}

export function createUserPlaylist(name: string): Promise<UserPlaylist> {
  return request<{ playlist: UserPlaylist }>('/api/playlists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }).then((data) => data.playlist)
}

export function renameUserPlaylist(id: string, name: string): Promise<UserPlaylist> {
  return request<{ playlist: UserPlaylist }>(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  }).then((data) => data.playlist)
}

export function deleteUserPlaylist(id: string): Promise<void> {
  return request<{ success: true }>(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then(() => undefined)
}

export function addTracksToUserPlaylist(id: string, tracks: Track[]): Promise<{ added: number; trackCount: number }> {
  return request<{ added: number; trackCount: number }>(`/api/playlists/${encodeURIComponent(id)}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ tracks }),
  })
}

export function removeTrackFromUserPlaylist(id: string, trackId: string): Promise<void> {
  return request<{ success: true }>(`/api/playlists/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`, {
    method: 'DELETE',
  }).then(() => undefined)
}
