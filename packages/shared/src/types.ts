/** Standardised error codes used across all server → client ROOM_ERROR emissions */
export const ERROR_CODE = {
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_DATA: 'INVALID_DATA',
  INTERNAL: 'INTERNAL',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  JOIN_FAILED: 'JOIN_FAILED',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_OWNER: 'NOT_OWNER',
  NO_PERMISSION: 'NO_PERMISSION',
  SET_ROLE_FAILED: 'SET_ROLE_FAILED',
  QUEUE_FULL: 'QUEUE_FULL',
  STREAM_FAILED: 'STREAM_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  NO_VOTE_NEEDED: 'NO_VOTE_NEEDED',
  VOTE_IN_PROGRESS: 'VOTE_IN_PROGRESS',
  ALREADY_VOTED: 'ALREADY_VOTED',
} as const

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]

export type MusicSource = 'netease' | 'tencent' | 'kugou' | 'kugou_concept' | 'bilibili'

/** Server-wide Kugou transport policy. Bilibili always uses the server proxy. */
export interface AudioProxyPolicy {
  kugouForceProxy: boolean
}

/** Server administrator-managed automatic backup schedule. */
export interface BackupSettings {
  enabled: boolean
  cleanupEnabled: boolean
  intervalHours: number
  retentionDays: number
}

export type ColorPreset = 'gold' | 'ocean' | 'rose' | 'violet' | 'sunset' | 'mint' | 'mono'

/** Administrator-managed background shared by the lobby and every room page. */
export interface GlobalBackgroundSettings {
  backgroundUrl: string | null
  glassOverlay: boolean
  colorPreset: ColorPreset
  backgroundBrightness: number
  autoTint: boolean
}

/** Music platforms that can supply lyrics and cover art for Bilibili videos. */
export type BilibiliMetadataSource = 'netease' | 'tencent' | 'kugou' | 'kugou_concept'

export type AutoFallbackStatus = 'trying' | 'success' | 'failed'

export type AutoFallbackReasonType = 'VIP_REQUIRED' | 'COPYRIGHT_RESTRICTED' | 'NO_RESOURCE' | 'TIMEOUT' | 'UNKNOWN'

export interface RoomAutoFallbackEvent {
  /** Correlates trying/success/failed toasts */
  attemptId: string
  status: AutoFallbackStatus
  fromSource: MusicSource
  toSource: MusicSource
  trackTitle: string
  reasonType?: AutoFallbackReasonType
  /** Safe, short detail suitable for UI (no URLs/cookies/stack traces). */
  reasonDetail?: string
}

export type UserRole = 'owner' | 'admin' | 'member'

export type PlayMode = 'sequential' | 'loop-all' | 'loop-one' | 'shuffle'

/** 音频质量档位 (kbps)：标准 / 较高 / HQ / 无损 */
export type AudioQuality =
  | 128
  | 192
  | 320
  | 999
  | 'highest'
  | 'netease_dolby'
  | 'netease_hires'
  | 'netease_jyeffect'
  | 'netease_master'
  | 'netease_spatial'
  | 'tencent_flac'
  | 'tencent_master'
  | 'kugou_hires'
  | 'kugou_master'
  | 'bilibili_64'
  | 'bilibili_132'
  | 'bilibili_192'
  | 'bilibili_hires'

export type BilibiliStreamFormat = 'm4a' | 'flac'

export interface Track {
  id: string
  title: string
  artist: string[]
  album: string
  duration: number
  cover: string
  /** Stable small artwork URL for search, queue and playlist rows. */
  thumbnailCover?: string
  /** Original Bilibili video cover, retained when third-party metadata is selected. */
  bilibiliCover?: string
  source: MusicSource
  sourceId: string
  urlId: string
  lyricId?: string
  picId?: string
  /**
   * Bilibili is the playback source; this records the user-selected music
   * platform used to match its lyrics and cover art.
   */
  metadataSource?: BilibiliMetadataSource
  streamUrl?: string
  /** The upstream bytes require server-side processing, such as QMC2 decryption. */
  requiresServerProxy?: boolean
  /** Codec family selected for Bilibili DASH playback. */
  streamFormat?: BilibiliStreamFormat
  /** 是否为 VIP / 付费歌曲（可能无法播放或仅试听） */
  vip?: boolean
  /** 点歌人昵称（服务端在加入队列时注入） */
  requestedBy?: string
}

/** One provider-backed format that the current room can download. */
export interface DownloadQualityOption {
  quality: AudioQuality
  actualBitrate: number | null
  format?: string
  fileSize?: number
}

export interface DownloadOptionsResponse {
  trackId: string
  options: DownloadQualityOption[]
}

export type RecommendationUnavailableReason = 'empty' | 'upstream_unavailable'

export interface RecommendationPagination {
  tracks?: {
    hasMore: boolean
    nextPage: number
  }
  playlists?: {
    hasMore: boolean
    nextOffset: number
  }
}

/** A logged-in platform's native recommendation feed. */
export interface PlatformRecommendation {
  platform: MusicSource
  tracks: Track[]
  playlists?: Playlist[]
  pagination?: RecommendationPagination
  unavailableReason?: RecommendationUnavailableReason
}

/** 客户端可见的房间状态 */
export interface RoomState {
  id: string
  name: string
  creatorId: string
  hostId: string
  /** The currently elected temporary admin, if there is one. */
  temporaryAdminUserId: string | null
  hasPassword: boolean
  /** Hide the room from the public lobby while keeping direct joins available. */
  hidden: boolean
  /** Permanent rooms survive empty-room cleanup and server restarts. */
  permanent: boolean
  /** Whether a temporary admin may remove individual tracks. */
  allowTemporaryAdminTrackRemoval: boolean
  /** Whether a temporary admin may clear the entire queue. */
  allowTemporaryAdminQueueClear: boolean
  /** 密码明文（仅 owner 可见；普通成员和临时管理员只收到 hasPassword） */
  password?: string | null
  audioQuality: AudioQuality
  users: User[]
  /** Full room roster, including members who are currently offline. */
  members: RoomMember[]
  queue: Track[]
  currentTrack: Track | null
  playState: PlayState
  playMode: PlayMode
}

export interface PlayState {
  isPlaying: boolean
  currentTime: number
  serverTimestamp: number
  /**
   * Monotonic playback action generation. Optional for backward compatibility
   * with native clients and persisted rooms created before this field existed.
   */
  revision?: number
}

/**
 * Scheduled action payload — server tells clients to execute an action
 * at a specific future server-time, so all clients act in unison.
 */
export interface ScheduledPlayState extends PlayState {
  /** Server-clock timestamp at which clients should execute this action */
  serverTimeToExecute: number
}

export interface User {
  id: string
  nickname: string
  role: UserRole
  /** Account-level server administrator status, independent of the room role. */
  isServerAdmin: boolean
  avatarUrl?: string | null
}

/** A room roster entry. Unlike User, this stays available while offline. */
export interface RoomMember extends User {
  isOnline: boolean
  joinedAt: number
  lastSeenAt: number | null
}

export interface ChatMessage {
  id: string
  userId: string
  nickname: string
  content: string
  timestamp: number
  type: 'user' | 'system'
}

export type VoteAction = 'pause' | 'resume' | 'next' | 'prev' | 'set-mode' | 'play-track' | 'remove-track'

export interface VoteState {
  id: string
  action: VoteAction
  initiatorId: string
  initiatorNickname: string
  votes: Record<string, boolean>
  requiredVotes: number
  totalUsers: number
  expiresAt: number
  /** Optional payload for parameterized actions (e.g. target play mode) */
  payload?: Record<string, unknown>
}

/** 房间列表项 -- 用于首页房间大厅展示（轻量，不含完整 queue/users） */
export interface RoomListItem {
  id: string
  name: string
  hasPassword: boolean
  permanent: boolean
  userCount: number
  currentTrackTitle: string | null
  currentTrackArtist: string | null
}

/** 平台认证状态（前端展示用，不含 cookie 明文） */
export interface PlatformAuthStatus {
  platform: MusicSource
  /** 该平台已登录的用户数 */
  loggedInCount: number
  /** 是否有 VIP 用户 */
  hasVip: boolean
  /** 最高会员等级 (0=无, 1=VIP, 2=SVIP) */
  maxVipType: number
  /** 平台提供的最高会员展示名称，例如 VIP·伍。 */
  maxVipLabel?: string
  /** 平台提供的细分等级。 */
  maxVipLevel?: number
}

/** 当前用户自己在某平台的认证信息 */
export interface MyPlatformAuth {
  platform: MusicSource
  loggedIn: boolean
  nickname?: string
  vipType?: number
  vipLabel?: string
  vipLevel?: number
}

/** 歌单元数据（用于歌单列表展示） */
export interface Playlist {
  id: string
  name: string
  cover: string
  /** Stable small artwork URL for list rendering. */
  thumbnailCover?: string
  trackCount: number
  source: MusicSource
  creator?: string
  description?: string
}
