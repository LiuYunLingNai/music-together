import * as z from 'zod/v4'
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
  roamingSource: z.enum(['netease', 'tencent', 'kugou', 'kugou_concept']).optional(),
  roamingMode: z.enum(NETEASE_ROAMING_MODES).optional(),
})

export const setRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member']),
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
})

export const playerSyncSchema = z.object({
  currentTime: z.number().finite().nonnegative(),
  hostServerTime: z.number().finite().positive().optional(),
})

export const playerSetModeSchema = z.object({
  mode: z.enum(['sequential', 'loop-all', 'loop-one', 'shuffle']),
})

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

const trackSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(500),
  artist: z.array(z.string().max(200)).max(20),
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
})

export const queueAddSchema = z.object({
  track: trackSchema,
})

export const queueInsertAfterCurrentSchema = queueAddSchema

export const queueAddBatchSchema = z.object({
  tracks: z.array(trackSchema).min(1).max(LIMITS.QUEUE_BATCH_MAX_SIZE),
  playlistName: z.string().max(200).optional(),
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

const searchQueryCommonShape = {
  limit: z.coerce.number().int().min(1).max(LIMITS.SEARCH_PAGE_SIZE_MAX).default(20),
  page: z.coerce.number().int().min(1).max(LIMITS.SEARCH_PAGE_MAX).default(1),
  type: z.enum(['song', 'album', 'playlist']).optional().default('song'),
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

export const recommendationsQuerySchema = z.object({
  roomId: z.string().min(1).max(10),
  platform: musicSourceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  radarPage: z.coerce.number().int().min(1).max(10_000).default(1),
  playlistOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  neteasePlaylistOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

export const hotSongsQuerySchema = z.object({
  roomId: z.string().min(1).max(10),
  source: hotSongsSourceSchema.default('netease'),
  limit: z.coerce.number().int().min(1).max(30).default(30),
  offset: z.coerce.number().int().min(0).max(500).default(0),
  refresh: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
})

export const urlQuerySchema = z.object({
  source: musicSourceSchema,
  urlId: z.string().min(1).max(2000),
  bitrate: z
    .preprocess((value) => {
      if (typeof value !== 'string' || value.trim() === '') return value
      const numeric = Number(value)
      return Number.isNaN(numeric) ? value : numeric
    }, audioQualitySchema)
    .default(320),
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

export const lyricSupplementQuerySchema = lyricQuerySchema.extend({
  title: z.string().min(1).max(300),
  artists: z.preprocess(
    (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]),
    z.array(z.string().min(1).max(200)).min(1).max(10),
  ),
  duration: z.coerce.number().finite().positive().max(86_400),
})

export const coverQuerySchema = z.object({
  source: musicSourceSchema,
  picId: z.string().min(1).max(2000),
  size: z.coerce.number().int().min(16).max(5000).optional(),
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
