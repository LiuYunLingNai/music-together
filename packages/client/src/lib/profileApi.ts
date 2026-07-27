import { useAccountStore, type AccountProfile } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { SERVER_URL } from './config'
import { storage } from './storage'

function storeProfile(profile: AccountProfile): AccountProfile {
  useAccountStore.getState().setProfile(profile)
  storage.setUserId(profile.id)
  if (profile.nickname) storage.setNickname(profile.nickname)
  useRoomStore.getState().updateUserProfile(profile.id, profile)
  return profile
}

async function requestProfile(path: string, init?: RequestInit): Promise<AccountProfile | null> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed: ${response.status}`)
  }
  if (response.status === 204) {
    useAccountStore.getState().setProfile(null)
    storage.clearUserId()
    return null
  }
  return storeProfile((await response.json()) as AccountProfile)
}

export function fetchCurrentProfile(): Promise<AccountProfile | null> {
  return requestProfile('/api/auth/me')
}

export async function updateCurrentNickname(nickname: string): Promise<AccountProfile> {
  const profile = await requestProfile('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ nickname: nickname.trim() }),
  })
  if (!profile) throw new Error('账号创建失败')
  return profile
}

export async function uploadCurrentAvatar(image: string): Promise<AccountProfile> {
  const profile = await requestProfile('/api/auth/me/avatar', {
    method: 'POST',
    body: JSON.stringify({ image }),
  })
  if (!profile) throw new Error('头像保存失败')
  return profile
}

export function resolveAvatarUrl(avatarUrl?: string | null): string | undefined {
  if (!avatarUrl) return undefined
  return avatarUrl.startsWith('/uploads/') ? `${SERVER_URL}${avatarUrl}` : avatarUrl
}
