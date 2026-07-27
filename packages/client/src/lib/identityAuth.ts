import { SERVER_URL } from '@/lib/config'
import { fetchCurrentProfile } from '@/lib/profileApi'
import { storage } from '@/lib/storage'
import type { AccountProfile } from '@/stores/accountStore'
import type { TypedSocket } from '@/lib/socket'

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed: ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function reconnectSocket(socket: TypedSocket): Promise<void> {
  return new Promise((resolve) => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      socket.off('connect', finish)
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, 3_000)
    socket.on('connect', finish)
    if (socket.connected) socket.disconnect()
    socket.connect()
  })
}

function clearIdentityBoundBrowserState(): void {
  storage.setAuthCookies([])
  storage.clearRejoinToken()
}

export async function setInitialPassword(password: string): Promise<AccountProfile> {
  await requestJson<{ accountId: string }>('/api/auth/me/password', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  const profile = await fetchCurrentProfile()
  if (!profile) throw new Error('请先设置昵称')
  return profile
}

export async function updateAccountId(
  socket: TypedSocket,
  accountId: string,
  currentPassword?: string,
): Promise<AccountProfile> {
  const result = await requestJson<AccountProfile>('/api/auth/me/account-id', {
    method: 'PATCH',
    body: JSON.stringify({ accountId: accountId.trim().toLowerCase(), currentPassword }),
  })
  storage.setUserId(result.id)
  storage.clearRejoinToken()
  const profile = await fetchCurrentProfile()
  if (!profile) throw new Error('账号资料恢复失败')
  await reconnectSocket(socket)
  return profile
}

export async function loginIdentity(socket: TypedSocket, accountId: string, password: string): Promise<AccountProfile> {
  const result = await requestJson<{ userId: string; expiresAt: number }>('/api/auth/identity/recover', {
    method: 'POST',
    body: JSON.stringify({ accountId: accountId.trim(), password }),
  })
  clearIdentityBoundBrowserState()
  storage.setUserId(result.userId)
  const profile = await fetchCurrentProfile()
  if (!profile) throw new Error('账号资料恢复失败')
  await reconnectSocket(socket)
  return profile
}

export async function logoutIdentity(socket: TypedSocket): Promise<AccountProfile | null> {
  await requestJson<{ userId: string; expiresAt: number }>('/api/auth/identity/logout', {
    method: 'POST',
  })
  clearIdentityBoundBrowserState()
  storage.clearNickname()
  const profile = await fetchCurrentProfile()
  await reconnectSocket(socket)
  return profile
}
