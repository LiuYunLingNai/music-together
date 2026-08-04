export type MusicSource = 'netease' | 'tencent' | 'kugou' | 'kugou_concept' | 'bilibili'
export type UserRole = 'owner' | 'admin' | 'member'
export type PlayMode = 'sequential' | 'loop-all' | 'loop-one' | 'shuffle'
export type VoteAction = 'pause' | 'resume' | 'next' | 'prev' | 'set-mode' | 'play-track' | 'remove-track'
export type AudioQuality = 128 | 192 | 320 | 999 | 'highest' | 'netease_dolby' | 'netease_hires' | 'netease_jyeffect' | 'netease_master' | 'netease_spatial' | 'tencent_flac' | 'tencent_master' | 'kugou_hires' | 'kugou_master' | 'bilibili_64' | 'bilibili_132' | 'bilibili_192' | 'bilibili_hires'
export type AppUpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unsupported'

export interface AppUpdateStatus {
  state: AppUpdateState
  currentVersion: string
  version?: string
  percent?: number
  message?: string
  releaseNotes?: string
}

export interface IdentityBootstrapResult {
  userId: string
  expiresAt?: number
}

export interface Track {
  id: string
  title: string
  artist: string[]
  album: string
  duration: number
  cover: string
  bilibiliCover?: string
  source: MusicSource
  sourceId: string
  urlId: string
  lyricId?: string
  picId?: string
  metadataSource?: 'netease' | 'tencent'
  streamUrl?: string
  requiresServerProxy?: boolean
  streamFormat?: 'm4a' | 'flac'
  vip?: boolean
  requestedBy?: string
}

export interface User {
  id: string
  nickname: string
  role: UserRole
  isServerAdmin: boolean
  avatarUrl?: string | null
}

export interface PlayState {
  isPlaying: boolean
  currentTime: number
  serverTimestamp: number
  serverTimeToExecute?: number
}

export interface RoomState {
  id: string
  name: string
  creatorId: string
  hostId: string
  hasPassword: boolean
  hidden: boolean
  permanent: boolean
  password?: string | null
  audioQuality: AudioQuality
  users: User[]
  queue: Track[]
  currentTrack: Track | null
  playState: PlayState
  playMode: PlayMode
}

export interface RoomListItem {
  id: string
  name: string
  hasPassword: boolean
  permanent: boolean
  userCount: number
  currentTrackTitle: string | null
  currentTrackArtist: string | null
}

export interface ChatMessage {
  id: string
  userId: string
  nickname: string
  content: string
  timestamp: number
  type: 'user' | 'system'
}

export interface VoteState {
  id: string
  action: VoteAction
  initiatorId: string
  initiatorNickname: string
  votes: Record<string, boolean>
  requiredVotes: number
  totalUsers: number
  expiresAt: number
  payload?: Record<string, unknown>
}

export interface AudioProxyPolicy {
  kugouForceProxy: boolean
}

export interface RoomAutoFallbackEvent {
  attemptId: string
  status: 'trying' | 'success' | 'failed'
  fromSource: MusicSource
  toSource: MusicSource
  trackTitle: string
  reasonType?: 'VIP_REQUIRED' | 'COPYRIGHT_RESTRICTED' | 'NO_RESOURCE' | 'TIMEOUT' | 'UNKNOWN'
  reasonDetail?: string
}

export interface PlatformAuthStatus {
  platform: MusicSource
  loggedInCount: number
  hasVip: boolean
  maxVipType: number
  maxVipLabel?: string
  maxVipLevel?: number
}

export interface MyPlatformAuth {
  platform: MusicSource
  loggedIn: boolean
  nickname?: string
  vipType?: number
  vipLabel?: string
  vipLevel?: number
}

export interface Playlist {
  id: string
  name: string
  cover: string
  trackCount: number
  source: MusicSource
  creator?: string
  description?: string
}

export interface AccountProfile {
  id: string
  nickname: string
  avatarUrl: string | null
  hasPassword: boolean
  role: 'user' | 'admin'
}

export interface AdminUser extends AccountProfile {
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

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

export interface LyricSettings {
  ttmlEnabled: boolean
  ttmlDbUrl: string
  alignAnchor: 'top' | 'center' | 'bottom'
  alignPosition: number
  animation: boolean
  blur: boolean
  scale: boolean
  fontSize: number
  fontWeight: number
  translationFontSize: number
  romanFontSize: number
}

export interface LyricRuby {
  text: string
  startTimeMs: number
  endTimeMs: number
}

export interface LyricWord {
  text: string
  startTimeMs: number
  endTimeMs: number
  romanText?: string
  ruby?: LyricRuby[]
}

export interface LyricLine {
  words: LyricWord[]
  translatedLyric?: string
  romanLyric?: string
  startTimeMs: number
  endTimeMs: number
  isBackground?: boolean
  isDuet?: boolean
}

export interface LyricGroup {
  main: LyricLine
  background?: LyricLine
  startTimeMs: number
  endTimeMs: number
}

export interface LyricInterlude {
  startTimeMs: number
  endTimeMs: number
  anchorGroupIndex: number
  isNextDuet: boolean
}
