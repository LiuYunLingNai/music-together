/** 管理平台专用响应类型（对应 /api/auth 与 /api/admin 的服务端返回结构） */

import type { MusicSource } from '@music-together/shared'

/** GET /api/auth/me 的返回结构 */
export interface MeProfile {
  id: string
  nickname: string
  avatarUrl: string | null
  hasPassword: boolean
  /** 服务端账号角色；仅 'admin' 可访问 /api/admin */
  role: 'user' | 'admin'
}

/** GET /api/admin/users 列表项 */
export interface AdminUser {
  id: string
  nickname: string
  avatarUrl: string | null
  role: 'user' | 'admin'
  hasPassword: boolean
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

/** GET /api/admin/rooms 列表项 */
export interface AdminRoom {
  id: string
  name: string
  creatorId: string
  userCount: number
  hasPassword: boolean
  hidden: boolean
  permanent: boolean
  currentTrackTitle: string | null
}

/** GET /api/version */
export interface VersionInfo {
  version: string
}

/** GET /api/health */
export interface HealthInfo {
  status: string
  timestamp: number
}

/** GET /api/admin/setup-status */
export interface SetupStatus {
  needed: boolean
}

/** GET /api/admin/overview */
export interface AdminOverview {
  version: string
  healthy: boolean
  users: AdminUser[]
  rooms: AdminRoom[]
}

/** GET /api/admin/rooms/:roomId 中的曲目摘要 */
export interface AdminRoomTrack {
  id: string
  title: string
  artist: string
  source: MusicSource
}

/** GET /api/admin/rooms/:roomId 中的成员条目 */
export interface AdminRoomMember {
  id: string
  nickname: string
  avatarUrl: string | null
  role: string
  isOnline: boolean
  lastSeenAt: number | null
}

/** GET /api/admin/rooms/:roomId */
export interface AdminRoomDetail {
  id: string
  name: string
  creatorId: string
  hostId: string
  hasPassword: boolean
  hidden: boolean
  permanent: boolean
  audioQuality: number
  playMode: string
  isPlaying: boolean
  currentTime: number
  currentTrack: AdminRoomTrack | null
  queue: AdminRoomTrack[]
  members: AdminRoomMember[]
}

/** GET /api/admin/backups 列表项 */
export interface AdminBackup {
  name: string
  createdAt: string
  includesEnvFile: boolean
}

/** GET /api/admin/users/:userId/platform-auths 列表项（已脱敏，不含 cookie） */
export interface AdminPlatformAuth {
  platform: MusicSource
  nickname: string
  vipType: number
  vipLabel: string | null
  vipLevel: number | null
  avatarUrl: string | null
  credentialRefreshAttemptedAt: number | null
}

/** 平台标识的中文显示名 */
export const PLATFORM_LABELS: Record<MusicSource, string> = {
  netease: '网易云音乐',
  tencent: 'QQ 音乐',
  kugou: '酷狗音乐',
  kugou_concept: '酷狗概念版',
  bilibili: '哔哩哔哩',
}
