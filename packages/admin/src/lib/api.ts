import type { AudioProxyPolicy, BackupSettings, GlobalBackgroundSettings, MusicSource } from '@music-together/shared'
import type {
  AdminBackup,
  AdminOverview,
  AdminPlatformAuth,
  AdminRoom,
  AdminRoomDetail,
  AdminUser,
  HealthInfo,
  MeProfile,
  SetupStatus,
  VersionInfo,
} from './types'

/** HTTP 请求失败；message 已提取服务端 { error } 字段 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 会话失效回调（由 AuthProvider 注册），登录/找回接口自身的 401 不触发 */
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options
  let response: Response
  try {
    response = await fetch(path, {
      method,
      // 服务端身份为 httpOnly Cookie，跨端口开发时也由 Vite 代理保持同源
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('无法连接服务器，请检查网络', 0)
  }

  if (response.status === 401 && !path.startsWith('/api/auth/identity/')) {
    unauthorizedHandler?.()
  }

  if (response.status === 204) {
    return undefined as T
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `请求失败（${response.status}）`
    throw new ApiError(message, response.status)
  }

  return payload as T
}

// ---------------------------------------------------------------------------
// 认证与会话（/api/auth）
// ---------------------------------------------------------------------------

export const authApi = {
  /** 恢复会话：无资料返回 204 -> null */
  async fetchMe(): Promise<MeProfile | null> {
    try {
      return await request<MeProfile>('/api/auth/me')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  },

  /** 账号 ID + 密码登录（找回身份） */
  recover(accountId: string, password: string): Promise<{ userId: string; expiresAt: number }> {
    return request('/api/auth/identity/recover', { method: 'POST', body: { accountId, password } })
  },

  logout(): Promise<{ userId: string; expiresAt: number }> {
    return request('/api/auth/identity/logout', { method: 'POST' })
  },
}

// ---------------------------------------------------------------------------
// 公共接口
// ---------------------------------------------------------------------------

export const publicApi = {
  version: () => request<VersionInfo>('/api/version'),
  health: () => request<HealthInfo>('/api/health'),
}

// ---------------------------------------------------------------------------
// 首次初始化（/api/admin，公开端点，仅在服务器尚无管理员时可用）
// ---------------------------------------------------------------------------

export const setupApi = {
  getStatus: () => request<SetupStatus>('/api/admin/setup-status'),
  /** 创建首个管理员；成功后服务端直接签发身份 Cookie */
  setup: (input: { accountId: string; nickname: string; password: string; avatarUrl?: string }) =>
    request<MeProfile & { expiresAt: number }>('/api/admin/setup', { method: 'POST', body: input }),
}

// ---------------------------------------------------------------------------
// 后台管理（/api/admin，服务端要求服务器管理员角色）
// ---------------------------------------------------------------------------

export const adminApi = {
  // 系统概览（单次请求聚合版本、用户与房间）
  getOverview: () => request<AdminOverview>('/api/admin/overview'),

  // 用户管理
  getUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
  deleteUser: (userId: string) => request<void>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  resetPassword: (userId: string, password: string) =>
    request<{ accountId: string }>(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      body: { password },
    }),

  // 用户平台授权（已脱敏，不含 cookie）
  getPlatformAuths: (userId: string) =>
    request<{ auths: AdminPlatformAuth[] }>(`/api/admin/users/${encodeURIComponent(userId)}/platform-auths`),
  revokePlatformAuth: (userId: string, platform: MusicSource) =>
    request<void>(`/api/admin/users/${encodeURIComponent(userId)}/platform-auths/${platform}`, { method: 'DELETE' }),

  // 房间管理
  getRooms: () => request<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
  dissolveRoom: (roomId: string) =>
    request<void>(`/api/admin/rooms/${encodeURIComponent(roomId)}/dissolve`, { method: 'POST' }),
  getRoomDetail: (roomId: string) => request<AdminRoomDetail>(`/api/admin/rooms/${encodeURIComponent(roomId)}`),
  kickUser: (roomId: string, userId: string) =>
    request<void>(`/api/admin/rooms/${encodeURIComponent(roomId)}/kick/${encodeURIComponent(userId)}`, { method: 'POST' }),

  // 音频代理策略
  getAudioProxyPolicy: () => request<AudioProxyPolicy>('/api/admin/audio-proxy-policy'),
  patchAudioProxyPolicy: (patch: Partial<AudioProxyPolicy>) =>
    request<AudioProxyPolicy>('/api/admin/audio-proxy-policy', { method: 'PATCH', body: patch }),

  // 备份设置
  getBackupSettings: () => request<BackupSettings>('/api/admin/backup-settings'),
  patchBackupSettings: (patch: Partial<BackupSettings>) =>
    request<BackupSettings>('/api/admin/backup-settings', { method: 'PATCH', body: patch }),

  // 备份文件管理
  listBackups: () => request<{ backups: AdminBackup[]; running: boolean }>('/api/admin/backups'),
  runBackup: () => request<{ name: string }>('/api/admin/backups/run', { method: 'POST' }),
  deleteBackup: (name: string) => request<void>(`/api/admin/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // 全局背景
  getBackground: () => request<GlobalBackgroundSettings>('/api/admin/background'),
  setBackgroundImage: (source: { image: string } | { imageUrl: string }) =>
    request<GlobalBackgroundSettings>('/api/admin/background', { method: 'POST', body: source }),
  patchBackground: (patch: Partial<Omit<GlobalBackgroundSettings, 'backgroundUrl'>>) =>
    request<GlobalBackgroundSettings>('/api/admin/background', { method: 'PATCH', body: patch }),
  removeBackground: () => request<GlobalBackgroundSettings>('/api/admin/background', { method: 'DELETE' }),
}

/** 毫秒时间戳 -> 本地时间文本；0/空值显示「从未」 */
export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '从未'
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
