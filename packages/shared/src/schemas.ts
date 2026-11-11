import * as z from 'zod/v4'
import { CROSSFADE_MAX_SEC, CROSSFADE_MIN_SEC } from './automix/crossfadePlanner.js'
import { LIMITS } from './constants.js'
import { NETEASE_ROAMING_MODES } from './types.js'

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export const roomCreateSchema = z.object({
  nickname: z.string().min(1, '昵称不能为空').max(LIMITS.NICKNAME_MAX_LENGTH, '昵称过长'),
  roomName: z.string().max(LIMITS.ROOM_NAME_MAX_LENGTH, '房间名过长').optional(),
  password: z.string().max(LIMITS.ROOM_PASSWORD_MAX_LENGTH, '密码过长').optional(),
})

export const roomJoinSchema = z.object({
  roomId: z.string().min(1, '房间号不能为空'),
  nickname: z.string().min(1, '昵称不能为空').max(LIMITS.NICKNAME_MAX_LENGTH, '昵称过长'),
  password: z.string().max(LIMITS.ROOM_PASSWORD_MAX_LENGTH).optional(),
  rejoinToken: z.string().min(1).max(500).optional(),
})

export const roomShareQrQuerySchema = z.object({
  link: z.string().min(1, '分享链接不能为空').max(500, '分享链接过长'),
})

export const audioQualitySchema = z.union([
  z.literal(128),
  z.literal(192),
  z.literal(320),
  z.literal(999),
  z.literal('highest'),
  z.literal('netease_dolby'),
  z.literal('netease_hires'),
  z.literal('netease_jyeffect'),
  z.literal('netease_master'),
  z.literal('netease_spatial'),
  z.literal('tencent_flac'),
  z.literal('tencent_master'),
  z.literal('kugou_hires'),
  z.literal('kugou_master'),
  z.literal('bilibili_64'),
  z.literal('bilibili_132'),
  z.literal('bilibili_192'),
  z.literal('bilibili_hires'),
])

export const roomSettingsSchema = z.object({
  name: z.string().min(1).max(LIMITS.ROOM_NAME_MAX_LENGTH).optional(),
  password: z.string().max(LIMITS.ROOM_PASSWORD_MAX_LENGTH).nullable().optional(),
  audioQuality: audioQualitySchema.optional(),
  hidden: z.boolean().optional(),
  permanent: z.boolean().optional(),
  allowTemporaryAdminTrackRemoval: z.boolean().optional(),
  allowTemporaryAdminQueueClear: z.boolean().optional(),
  removePlayedTracks: z.boolean().optional(),
  roamingEnabled: z.boolean().optional(),
  automixEnabled: z.boolean().optional(),
  transitionMode: z.enum(['crossfade', 'automix']).optional(),
  crossfadeMaxSec: z.number().min(CROSSFADE_MIN_SEC).max(CROSSFADE_MAX_SEC).optional(),
  automixPerformance: z.boolean().optional(),
  roamingSource: z.enum(['netease', 'tencent', 'kugou', 'kugou_concept']).optional(),
  roamingMode: z.enum(NETEASE_ROAMING_MODES).optional(),
})

export const setRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']),
})

export const kickMemberSchema = z.object({
  userId: z.string().min(1),
  /** 同时封禁，阻止其再次加入本房间。 */
  ban: z.boolean().optional(),
})

export const unbanMemberSchema = z.object({
  userId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Automix — client-computed track profile (wire validation)
// ---------------------------------------------------------------------------

const automixKeyEstimateSchema = z.object({
  key: z.number().int().min(0).max(11),
  major: z.boolean(),
  confidence: z.number().min(0).max(1),
})

export const automixTrackProfileSchema = z.object({
  version: z.number().int().min(0).max(1000),
  partial: z.boolean(),
  gridless: z.boolean().optional(),
  duration: z
    .number()
    .min(0)
    .max(24 * 60 * 60),
  leadIn: z.number().min(0).max(600),
  vocalStart: z
    .number()
    .min(0)
    .max(24 * 60 * 60)
    .nullable(),
  sectionStart: z
    .number()
    .min(0)
    .max(24 * 60 * 60)
    .nullable(),
  sections: z
    .array(
      z
        .number()
        .min(0)
        .max(24 * 60 * 60),
    )
    .max(256),
  leadOut: z.number().min(0).max(600).nullable(),
  bodyOut: z
    .number()
    .min(0)
    .max(24 * 60 * 60)
    .nullable(),
  startsHot: z.boolean(),
  endsHot: z.boolean().nullable(),
  introSlope: z.number().min(-240).max(240),
  outroSlope: z.number().min(-240).max(240).nullable(),
  loudness: z.number().min(-150).max(12),
  programLoudness: z.number().min(-150).max(12).nullable().optional(),
  peak: z.number().min(0).max(100).nullable().optional(),
  programFromHead: z.boolean().optional(),
  headDb: z.number().min(-150).max(12),
  tailDb: z.number().min(-150).max(12).nullable(),
  introTone: z.array(z.number().min(0).max(12)).max(8),
  outroTone: z.array(z.number().min(0).max(12)).max(8).nullable(),
  bpm: z.number().min(0).max(400).nullable(),
  outroBpm: z.number().min(0).max(400).nullable(),
  beatOffset: z
    .number()
    .min(0)
    .max(24 * 60 * 60),
  downbeatOffset: z
    .number()
    .min(0)
    .max(24 * 60 * 60)
    .nullable(),
  headDownbeatOffset: z
    .number()
    .min(0)
    .max(24 * 60 * 60)
    .nullable(),
  beatsPerBar: z.number().int().min(1).max(16),
  key: z.number().int().min(0).max(11),
  major: z.boolean(),
  keyConfidence: z.number().min(0).max(1),
  introKey: automixKeyEstimateSchema,
  outroKey: automixKeyEstimateSchema.nullable(),
})

export const playerTrackProfileSchema = z.object({
  trackId: z.string().min(1).max(200),
  profile: automixTrackProfileSchema,
})

export const automixLyricLineSchema = z.object({
  startTime: z
    .number()
    .min(0)
    .max(24 * 60 * 60),
  endTime: z
    .number()
    .min(0)
    .max(24 * 60 * 60),
  fullText: z.string().max(200),
})

export const playerTrackLinesSchema = z.object({
  trackId: z.string().min(1).max(200),
  lines: z.array(automixLyricLineSchema).max(1200),
})

// ---------------------------------------------------------------------------
// Room — auto fallback notifications
// ---------------------------------------------------------------------------

export const roomAutoFallbackSchema = z.object({
  attemptId: z.string().min(1).max(100),
  status: z.enum(['trying', 'success', 'failed']),
  fromSource: z.enum(['netease', 'tencent']),
  toSource: z.enum(['netease', 'tencent']),
  trackTitle: z.string().min(1).max(500),
  reasonType: z.enum(['VIP_REQUIRED', 'COPYRIGHT_RESTRICTED', 'NO_RESOURCE', 'TIMEOUT', 'UNKNOWN']).optional(),
  reasonDetail: z.string().max(200).optional(),
})

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const playerSeekSchema = z.object({
  currentTime: z.number().finite().nonnegative(),
  /** 发起 seek 时客户端看到的曲目；与房间当前曲目不一致说明切歌竞态，服务端丢弃。旧客户端可不传。 */
  trackId: z.string().max(200).optional(),
})

export const playerSyncSchema = z.object({
  currentTime: z.number().finite().nonnegative(),
  hostServerTime: z.number().finite().positive().optional(),
})

export const playerSetModeSchema = z.object({
  mode: z.enum(['sequential', 'loop-all', 'loop-one', 'shuffle']),
})

// 空载荷表示"切下一首"；带 trackId 时只在它仍在播放时才执行（旧客户端不带）。
export const playerNextSchema = z.object({
  trackId: z.string().max(200).optional(),
  /** Bypass queue order and start the next private-roaming batch immediately. */
  forceRoaming: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

const trackSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(500),
  artist: z.array(z.string().max(200)).max(20),
  artistIds: z.array(z.string().max(32)).max(20).optional(),
  album: z.string().max(500),
  duration: z.number().finite().nonnegative(),
  cover: z.string().max(2000),
  thumbnailCover: z.string().max(2000).optional(),
  bilibiliCover: z.string().max(2000).optional(),
  source: z.enum(['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili']),
  sourceId: z.string().max(200),
  urlId: z.string().max(200),
  lyricId: z.string().max(200).optional(),
  picId: z.string().max(200).optional(),
  metadataSource: z.enum(['netease', 'tencent', 'kugou', 'kugou_concept']).optional(),
  streamUrl: z.string().max(2000).optional(),
  requiresServerProxy: z.boolean().optional(),
  streamFormat: z.enum(['m4a', 'flac']).optional(),
  vip: z.boolean().optional(),
  lyricAliases: z
    .object({
      title: z.string().max(500).optional(),
      artist: z.string().max(500).optional(),
    })
    .optional(),
})

export const queueAddSchema = z.object({
  track: trackSchema,
})

// Empty payload resumes playback; native clients may omit it entirely.
export const playerPlaySchema = z.object({
  track: trackSchema.extend({ requestedBy: z.string().max(LIMITS.NICKNAME_MAX_LENGTH).optional() }).optional(),
})

export const playerSourceSwitchSchema = z.object({
  trackId: z.string().min(1).max(200),
  track: trackSchema,
})

export const queueInsertAfterCurrentSchema = queueAddSchema

export const queueAddBatchSchema = z.object({
  tracks: z.array(trackSchema).min(1).max(LIMITS.QUEUE_BATCH_MAX_SIZE),
  playlistName: z.string().max(200).optional(),
})

// ---------------------------------------------------------------------------
// Account local playlists
// ---------------------------------------------------------------------------

export const userPlaylistCreateSchema = z.object({
  name: z.string().trim().min(1, '歌单名称不能为空').max(LIMITS.USER_PLAYLIST_NAME_MAX, '歌单名称过长'),
})

export const userPlaylistRenameSchema = userPlaylistCreateSchema

export const userPlaylistAddTracksSchema = z.object({
  tracks: z.array(trackSchema).min(1).max(LIMITS.USER_PLAYLIST_TRACKS_MAX),
})

export const queueRemoveSchema = z.object({ trackId: z.string().max(200) })
export const queueReorderSchema = z.object({
  trackIds: z.array(z.string().max(200)).max(LIMITS.QUEUE_MAX_SIZE),
})
export const queueUpdateMetadataSchema = z.object({
  trackId: z.string().max(200),
  metadataSource: z.enum(['netease', 'tencent', 'kugou', 'kugou_concept']).optional(),
  lyricId: z.string().max(200).optional(),
  picId: z.string().max(200).optional(),
  cover: z.string().max(2000).optional(),
  clearMetadata: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const chatMessageSchema = z.object({
  content: z.string().min(1).max(LIMITS.CHAT_CONTENT_MAX_LENGTH),
})

// ---------------------------------------------------------------------------
// REST API – Music routes
// ---------------------------------------------------------------------------

export const musicSourceSchema = z.enum(['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili'])
export const hotSongsSourceSchema = z.enum(['netease', 'tencent', 'kugou'])

export const fallbackCandidatesQuerySchema = z.object({
  source: musicSourceSchema,
  title: z.string().min(1).max(300),
  artists: z.preprocess(
    (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]),
    z.array(z.string().min(1).max(200)).min(1).max(10),
  ),
  duration: z.coerce.number().finite().positive().max(86_400),
  album: z.string().max(300).optional(),
})

const searchQueryCommonShape = {
  limit: z.coerce.number().int().min(1).max(LIMITS.SEARCH_PAGE_SIZE_MAX).default(20),
  page: z.coerce.number().int().min(1).max(LIMITS.SEARCH_PAGE_MAX).default(1),
  type: z.enum(['song', 'album', 'playlist', 'artist']).optional().default('song'),
  roomId: z.string().min(1).max(10).optional(),
}

export const searchQuerySchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('bilibili'),
    keyword: z.string().min(1).max(LIMITS.BILIBILI_SEARCH_INPUT_MAX_LENGTH),
    ...searchQueryCommonShape,
  }),
  z.object({
    source: z.enum(['netease', 'tencent', 'kugou', 'kugou_concept']),
    keyword: z.string().min(1).max(LIMITS.SEARCH_KEYWORD_MAX_LENGTH),
    ...searchQueryCommonShape,
  }),
])

export const unifiedSearchQuerySchema = z.object({
  keyword: z.string().min(1).max(LIMITS.SEARCH_KEYWORD_MAX_LENGTH),
  /** Per-source result count before grouping. */
  limit: z.coerce.number().int().min(1).max(20).default(10),
  roomId: z.string().min(1).max(10).optional(),
})

export const recommendationsQuerySchema = z.object({
  roomId: z.string().min(1).max(10),
  platform: musicSourceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  radarPage: z.coerce.number().int().min(1).max(10_000).default(1),
  playlistOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  neteasePlaylistOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

/** AUTH_REQUEST_QR / AUTH_QUICK_LOGIN / AUTH_LOGOUT / PLAYLIST_GET_MY：只带平台。 */
export const platformEventSchema = z.object({ platform: musicSourceSchema })

export const authCheckQrSchema = z.object({
  key: z.string().min(1).max(500),
  platform: musicSourceSchema,
})

export const authSetCookieSchema = z.object({
  platform: musicSourceSchema,
  cookie: z.string().min(1).max(8000),
})

export const authSetSharingSchema = z.object({
  platform: musicSourceSchema,
  shareWithRoom: z.boolean(),
})

export const artistQuerySchema = z.object({
  source: musicSourceSchema,
  id: z.string().regex(/^\d{1,20}$/),
})

export const artistPageQuerySchema = artistQuerySchema.extend({
  offset: z.coerce.number().int().min(0).max(5000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const discoverQuerySchema = z.object({
  source: musicSourceSchema,
})

export const hotSongsQuerySchema = z.object({
  roomId: z.string().min(1).max(10),
  source: hotSongsSourceSchema.default('netease'),
  limit: z.coerce.number().int().min(1).max(30).default(30),
  offset: z.coerce.number().int().min(0).max(500).default(0),
  refresh: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
})

export const likedQuerySchema = z.object({
  source: musicSourceSchema,
  id: z.string().min(1).max(100),
  roomId: z.string().min(1).max(100),
})

export const likedSetSchema = likedQuerySchema.extend({
  liked: z.boolean(),
})

export const urlQuerySchema = z.object({  source: musicSourceSchema,
  urlId: z.string().min(1).max(2000),
  /** Optional room context: resolve with the room's best credential so preloads match playback. */
  roomId: z.string().min(1).max(100).optional(),
  bitrate: z
    .preprocess((value) => {
      if (typeof value !== 'string' || value.trim() === '') return value
      const numeric = Number(value)
      return Number.isNaN(numeric) ? value : numeric
    }, audioQualitySchema)
    .default(320),
  /** 预取请求可被平台级冷却单独挡住，不影响用户主动点歌。 */
  purpose: z.enum(['play', 'prefetch']).optional(),
})

export const downloadOptionsQuerySchema = z.object({
  roomId: z.string().min(1).max(10),
  trackId: z.string().min(1).max(200),
})

export const downloadQuerySchema = downloadOptionsQuerySchema.extend({
  quality: z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') return value
    const numeric = Number(value)
    return Number.isNaN(numeric) ? value : numeric
  }, audioQualitySchema),
})

export const lyricQuerySchema = z.object({
  source: musicSourceSchema,
  lyricId: z.string().min(1).max(2000),
})

export const ttmlQuerySchema = z.object({
  url: z.string().trim().min(1).max(2048),
})

export const amllTtmlQuerySchema = z.object({
  platform: z.enum(['ncm', 'qq']),
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300).optional(),
  artists: z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(z.string().trim().min(1).max(200)).min(1).max(10).optional(),
  ),
  album: z.string().trim().max(300).optional(),
  duration: z.coerce.number().finite().positive().max(86_400).optional(),
})

export const lyricSupplementQuerySchema = lyricQuerySchema.extend({
  title: z.string().min(1).max(300),
  artists: z.preprocess(
    (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]),
    z.array(z.string().min(1).max(200)).min(1).max(10),
  ),
  duration: z.coerce.number().finite().positive().max(86_400),
  /** 平台给的另一种歌名/歌手写法；按显示歌名搜不到逐字歌词时再搜一次。 */
  originalTitle: z.string().min(1).max(500).optional(),
  alternateArtist: z.string().min(1).max(500).optional(),
})

/** Manual lyric matching may search AMLL by metadata alone, without a platform lyric id. */
export const lyricCandidatesQuerySchema = lyricSupplementQuerySchema.extend({
  source: musicSourceSchema.optional(),
  lyricId: z.string().min(1).max(2000).optional(),
})

export const coverQuerySchema = z.object({
  source: musicSourceSchema,
  picId: z.string().min(1).max(2000),
  size: z.coerce.number().int().min(16).max(5000).optional(),
})

/** 动态封面（视频封面）：按平台歌曲 id 解析，缺失时返回空；元数据用于跨平台匹配。 */
export const dynamicCoverQuerySchema = z.object({
  source: musicSourceSchema,
  id: z.string().min(1).max(200),
  /** 只用于读取房间共享的网易云登录态；缺省时跳过需要登录的网易云动态封面。 */
  roomId: z.string().min(1).max(10).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  artists: z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(z.string().trim().min(1).max(200)).min(1).max(10).optional(),
  ),
  duration: z.coerce.number().finite().nonnegative().max(86_400).optional(),
  album: z.string().trim().max(300).optional(),
})

export const playlistQuerySchema = z.object({
  source: musicSourceSchema,
  id: z.string().min(1).max(LIMITS.PLAYLIST_ID_MAX_LENGTH),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  total: z.coerce.number().int().min(0).optional(),
  roomId: z.string().min(1).max(10).optional(),
  type: z.enum(['playlist', 'album']).optional().default('playlist'),
})

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

const voteWithoutPayloadSchema = z.object({
  action: z.enum(['pause', 'resume', 'next', 'prev']),
  payload: z.undefined().optional(),
})

export const voteStartSchema = z.discriminatedUnion('action', [
  voteWithoutPayloadSchema,
  z.object({ action: z.literal('set-mode'), payload: playerSetModeSchema }),
  z.object({ action: z.literal('play-track'), payload: z.object({ trackId: z.string().min(1).max(200) }) }),
  z.object({ action: z.literal('remove-track'), payload: z.object({ trackId: z.string().min(1).max(200) }) }),
])

export const voteCastSchema = z.object({
  approve: z.boolean(),
})
