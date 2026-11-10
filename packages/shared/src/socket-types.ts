import type { EVENTS } from './events.js'
import type { KeyRelation, TransitionStyle } from './automix/transitionChooser.js'
import type { TransitionMode } from './automix/transitionStrategy.js'
import type {
  AudioProxyPolicy,
  AudioQuality,
  AutomixTrackProfile,
  BilibiliMetadataSource,
  ChatMessage,
  MusicSource,
  MyPlatformAuth,
  PlayMode,
  Playlist,
  PlatformAuthStatus,
  PlaybackFailureEvent,
  RoomListItem,
  RoomState,
  ScheduledPlayState,
  Track,
  User,
  UserRole,
  VoteAction,
  VoteState,
  RoomAutoFallbackEvent,
  GlobalBackgroundSettings,
  LocalQqAccount,
  NeteaseRoamingMode,
  RoamingSource,
  SavedAccountSummary,
} from './types.js'

/** PLAYER_PLAY 携带的过渡执行参数；`inStartMs` 已由服务端写入 playState.currentTime。 */
export interface AutomixTransitionPayload {
  overlapMs: number
  fromTrackId: string
  style?: TransitionStyle
  startAtMs?: number
  stretch?: number
  tiltDb?: [number, number]
  echoThrow?: boolean
  /** 三频段交接的位置（0..1）与出歌速度，供客户端排布频段曲线与回声延时。 */
  crossover?: number
  bpm?: number | null
  shapeBands?: boolean
  sweepOut?: boolean
  together?: number
  trimDb?: number
  /** 两侧整曲参考电平（LUFS，ReplayGain 之前）；平衡修正以它为基准，缺一侧时客户端用实时读数兜底。 */
  outgoingReferenceDb?: number | null
  incomingReferenceDb?: number | null
  relation?: KeyRelation
  outgoingBarSec?: number | null
  incomingBarSec?: number | null
  outgoingDownbeatOffset?: number | null
  incomingSectionStart?: number | null
  incomingLeadInSec?: number | null
  /** performance 模式的 build-up 强度（0.25..1）；缺席表示不执行。 */
  expansion?: number | null
  outgoingBeatsPerBar?: number | null
}

/** 客户端上报的歌词时间线（秒）；服务端只用它判断人声窗口，不收完整歌词内容。 */
export interface AutomixLyricLinePayload {
  startTime: number
  endTime: number
  fullText: string
}

/** 服务端排定的过渡点广播，客户端据此提前准备（如单人房分轨分离）。 */
export interface AutomixPlanPayload {
  fromTrackId: string
  toTrackId: string
  overlapMs: number
  outStartMs: number
  inStartMs: number
  style: TransitionStyle
  stretch: number
  tiltDb: [number, number]
  echoThrow: boolean
  crossover: number
  bpm: number | null
  shapeBands: boolean
  sweepOut: boolean
  together: number
  trimDb: number
  relation: KeyRelation
  outgoingBarSec: number | null
  incomingBarSec: number | null
  outgoingDownbeatOffset: number | null
  incomingSectionStart: number | null
  incomingLeadInSec: number | null
  expansion: number | null
  outgoingBeatsPerBar: number | null
  reason: string
}

/** 服务端 → 客户端 事件接口 */
export interface ServerToClientEvents {
  [EVENTS.SERVER_AUDIO_PROXY_POLICY]: (policy: AudioProxyPolicy) => void
  [EVENTS.SERVER_GLOBAL_BACKGROUND]: (settings: GlobalBackgroundSettings) => void

  [EVENTS.ROOM_CREATED]: (data: { roomId: string; userId: string }) => void
  [EVENTS.ROOM_STATE]: (room: RoomState) => void
  [EVENTS.ROOM_REJOIN_TOKEN]: (data: { roomId: string; token: string; expiresAt: number }) => void
  [EVENTS.ROOM_ERROR]: (error: { code: string; message: string }) => void
  [EVENTS.ROOM_AUTO_FALLBACK]: (data: RoomAutoFallbackEvent) => void
  [EVENTS.ROOM_USER_JOINED]: (user: User & { isPersistentMember?: boolean }) => void
  [EVENTS.ROOM_USER_LEFT]: (user: User) => void
  [EVENTS.ROOM_SETTINGS]: (settings: {
    name: string
    hasPassword: boolean
    hidden: boolean
    permanent: boolean
    allowTemporaryAdminTrackRemoval: boolean
    allowTemporaryAdminQueueClear: boolean
    removePlayedTracks?: boolean
    roamingEnabled?: boolean
    automixEnabled?: boolean
    transitionMode?: TransitionMode
    crossfadeMaxSec?: number
    automixPerformance?: boolean
    roamingSource?: RoamingSource
    roamingMode?: NeteaseRoamingMode
    password?: string | null
    audioQuality: AudioQuality
  }) => void
  [EVENTS.ROOM_LIST_UPDATE]: (rooms: RoomListItem[]) => void
  [EVENTS.ROOM_ROLE_CHANGED]: (data: { userId: string; role: UserRole }) => void

  [EVENTS.PLAYER_PLAY]: (data: {
    track: Track
    playState: ScheduledPlayState
    /** 自动混音过渡：旧曲在 `overlapMs` 内淡出，所有成员按同一时长执行。 */
    automix?: AutomixTransitionPayload
  }) => void
  [EVENTS.PLAYER_AUTOMIX_PLAN]: (data: AutomixPlanPayload) => void
  [EVENTS.PLAYER_PAUSE]: (data: { playState: ScheduledPlayState }) => void
  [EVENTS.PLAYER_RESUME]: (data: { playState: ScheduledPlayState }) => void
  [EVENTS.PLAYER_SEEK]: (data: { playState: ScheduledPlayState }) => void
  [EVENTS.PLAYER_TRACK_METADATA_UPDATED]: (data: { track: Track }) => void
  [EVENTS.PLAYER_STREAM_REFRESHED]: (data: { track: Track }) => void
  [EVENTS.PLAYER_SOURCE_SWITCHED]: (data: { track: Track; currentTime: number; isPlaying: boolean }) => void
  [EVENTS.PLAYER_PLAYBACK_FAILURE]: (data: PlaybackFailureEvent) => void
  [EVENTS.PLAYER_SYNC_RESPONSE]: (data: {
    currentTime: number
    isPlaying: boolean
    serverTimestamp: number
    /** Optional for compatibility with older Web and native clients. */
    trackId?: string | null
  }) => void

  // NTP clock sync
  [EVENTS.NTP_PONG]: (data: { clientPingId: number; serverTime: number }) => void

  [EVENTS.QUEUE_UPDATED]: (data: { queue: Track[] }) => void

  [EVENTS.CHAT_MESSAGE]: (message: ChatMessage) => void
  [EVENTS.CHAT_HISTORY]: (messages: ChatMessage[]) => void

  [EVENTS.VOTE_STARTED]: (vote: VoteState) => void
  [EVENTS.VOTE_RESULT]: (data: { passed: boolean; action: VoteAction; reason?: string }) => void

  // Auth
  [EVENTS.AUTH_QR_GENERATED]: (data: {
    key: string
    qrimg: string
    /**
     * 该平台已保存的账号（仅展示信息）。
     * 凭据本身绝不出现在事件载荷里 —— 只用于在弹窗中提供「继续使用」入口。
     */
    savedAccount?: SavedAccountSummary
  }) => void
  [EVENTS.AUTH_QR_STATUS]: (data: { status: number; message: string; key?: string }) => void
  [EVENTS.AUTH_SET_COOKIE_RESULT]: (data: {
    success: boolean
    message: string
    platform?: MusicSource
    cookie?: string
    nickname?: string
    avatarUrl?: string
    reason?: 'expired' | 'error' | 'reauth_required'
  }) => void
  [EVENTS.AUTH_STATUS_UPDATE]: (data: PlatformAuthStatus[]) => void
  [EVENTS.AUTH_MY_STATUS]: (data: MyPlatformAuth[]) => void
  [EVENTS.AUTH_SHARING_RESULT]: (data: { platform: MusicSource; shareWithRoom: boolean; ok: boolean }) => void
  [EVENTS.AUTH_REPORTING_RESULT]: (data: { platform: MusicSource; reportListening: boolean; ok: boolean }) => void
  [EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP_RESULT]: (data: { success: boolean; message: string }) => void
  [EVENTS.AUTH_QUICK_LOGIN_RESULT]: (data: {
    success: boolean
    message: string
    platform?: MusicSource
    nickname?: string
    avatarUrl?: string
    reason?: 'not_found' | 'reauth_required' | 'error'
  }) => void
  /** 服务端所在机器上已登录的 QQ 客户端账号（仅同机访问时才有内容）。 */
  [EVENTS.AUTH_LOCAL_QQ_ACCOUNTS]: (data: { available: boolean; accounts: LocalQqAccount[]; message?: string }) => void
  [EVENTS.AUTH_LOCAL_QQ_LOGIN_RESULT]: (data: {
    success: boolean
    message: string
    nickname?: string
    avatarUrl?: string
    reason?: 'not_found' | 'reauth_required' | 'error'
  }) => void

  // Playlist
  [EVENTS.PLAYLIST_MY_LIST]: (data: { platform: MusicSource; playlists: Playlist[] }) => void
}

/** 客户端 → 服务端 事件接口 */
export interface ClientToServerEvents {
  [EVENTS.ROOM_CREATE]: (data: { nickname: string; roomName?: string; password?: string }) => void
  [EVENTS.ROOM_JOIN]: (data: { roomId: string; nickname: string; password?: string; rejoinToken?: string }) => void
  [EVENTS.ROOM_LEAVE]: () => void
  [EVENTS.ROOM_LIST]: () => void
  [EVENTS.ROOM_SETTINGS]: (data: {
    name?: string
    password?: string | null
    audioQuality?: AudioQuality
    hidden?: boolean
    permanent?: boolean
    allowTemporaryAdminTrackRemoval?: boolean
    allowTemporaryAdminQueueClear?: boolean
    removePlayedTracks?: boolean
    roamingEnabled?: boolean
    automixEnabled?: boolean
    transitionMode?: TransitionMode
    crossfadeMaxSec?: number
    automixPerformance?: boolean
    roamingSource?: RoamingSource
    roamingMode?: NeteaseRoamingMode
  }) => void
  [EVENTS.ROOM_SET_ROLE]: (data: { userId: string; role: 'admin' | 'member' }) => void
  [EVENTS.ROOM_KICK]: (data: { userId: string; ban?: boolean }) => void
  [EVENTS.ROOM_UNBAN]: (data: { userId: string }) => void

  [EVENTS.PLAYER_PLAY]: (data?: { track?: Track }) => void
  [EVENTS.PLAYER_PAUSE]: () => void
  [EVENTS.PLAYER_SEEK]: (data: { currentTime: number }) => void
  /**
   * `trackId` 可选：带上时服务端只在它仍是当前曲目时才切歌，避免歌曲已经
   * 自然播完后，排队中的请求把新歌也跳掉。旧客户端不带这个字段，退回原有防抖。
   */
  [EVENTS.PLAYER_NEXT]: (data?: { trackId?: string; forceRoaming?: boolean }) => void
  [EVENTS.PLAYER_PREV]: () => void
  [EVENTS.PLAYER_SYNC]: (data: { currentTime: number; hostServerTime?: number }) => void
  [EVENTS.PLAYER_SYNC_REQUEST]: () => void
  [EVENTS.PLAYER_SET_MODE]: (data: { mode: PlayMode }) => void
  [EVENTS.PLAYER_REFRESH_STREAM]: (data?: { trackId?: string; degrade?: boolean }) => void
  [EVENTS.PLAYER_SOURCE_SWITCH]: (data: { trackId: string; track: Track }) => void
  [EVENTS.PLAYER_REQUEST_SOURCE_FALLBACK]: (data?: { trackId?: string }) => void
  [EVENTS.PLAYER_RETRY_TRACK]: (data?: { trackId?: string; degrade?: boolean }) => void
  [EVENTS.PLAYER_TRACK_PROFILE]: (data: { trackId: string; profile: AutomixTrackProfile }) => void
  [EVENTS.PLAYER_TRACK_LINES]: (data: {
    trackId: string
    lines: AutomixLyricLinePayload[]
  }) => void

  [EVENTS.QUEUE_ADD]: (data: { track: Track }) => void
  [EVENTS.QUEUE_INSERT_AFTER_CURRENT]: (data: { track: Track }) => void
  [EVENTS.QUEUE_REMOVE]: (data: { trackId: string }) => void
  [EVENTS.QUEUE_REORDER]: (data: { trackIds: string[] }) => void
  [EVENTS.QUEUE_UPDATE_METADATA]: (data: {
    trackId: string
    metadataSource?: BilibiliMetadataSource
    lyricId?: string
    picId?: string
    cover?: string
    clearMetadata?: boolean
  }) => void
  [EVENTS.QUEUE_CLEAR]: () => void
  [EVENTS.QUEUE_REMOVE_PLAYED]: () => void

  // Queue batch
  [EVENTS.QUEUE_ADD_BATCH]: (data: { tracks: Track[]; playlistName?: string }) => void

  [EVENTS.CHAT_MESSAGE]: (data: { content: string }) => void

  [EVENTS.VOTE_START]: (data: { action: VoteAction; payload?: Record<string, unknown> }) => void
  [EVENTS.VOTE_CAST]: (data: { approve: boolean }) => void

  // Auth
  [EVENTS.AUTH_REQUEST_QR]: (data: { platform: MusicSource }) => void
  [EVENTS.AUTH_CHECK_QR]: (data: { key: string; platform: MusicSource }) => void
  [EVENTS.AUTH_SET_COOKIE]: (data: { platform: MusicSource; cookie: string; persist?: boolean }) => void
  [EVENTS.AUTH_LOGOUT]: (data: { platform: MusicSource }) => void
  [EVENTS.AUTH_GET_STATUS]: () => void
  [EVENTS.AUTH_SET_SHARING]: (data: { platform: MusicSource; shareWithRoom: boolean }) => void
  [EVENTS.AUTH_SET_REPORTING]: (data: { platform: MusicSource; reportListening: boolean }) => void
  [EVENTS.AUTH_CLAIM_KUGOU_CONCEPT_VIP]: () => void
  /** 使用服务端已保存的账号直接登录。 */
  [EVENTS.AUTH_QUICK_LOGIN]: (data: { platform: MusicSource }) => void
  /** 探测服务端所在机器上已登录的 QQ 客户端账号。 */
  [EVENTS.AUTH_LOCAL_QQ_PROBE]: () => void
  /** 使用本机 QQ 客户端的某个账号完成一键登录。 */
  [EVENTS.AUTH_LOCAL_QQ_LOGIN]: (data: { uin: string }) => void

  // Playlist
  [EVENTS.PLAYLIST_GET_MY]: (data: { platform: MusicSource }) => void

  // NTP clock sync
  [EVENTS.NTP_PING]: (data: { clientPingId: number; lastRttMs?: number }) => void
}
