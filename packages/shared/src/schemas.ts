import * as z from 'zod/v4'
import { LIMITS } from './constants.js'

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
  nickname: z.string().min(1, '昵称不能为空'),
  password: z.string().max(LIMITS.ROOM_PASSWORD_MAX_LENGTH).optional(),
  rejoinToken: z.string().min(1).max(500).optional(),
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

const musicSourceSchema = z.enum(['netease', 'tencent', 'kugou', 'kugou_concept', 'bilibili'])

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
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const urlQuerySchema = z.object({
  source: musicSourceSchema,
  urlId: z.string().min(1),
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
  lyricId: z.string().min(1),
})

export const coverQuerySchema = z.object({
  source: musicSourceSchema,
  picId: z.string().min(1),
  size: z.coerce.number().int().positive().default(300),
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

export const voteStartSchema = z.object({
  action: z.enum(['pause', 'resume', 'next', 'prev', 'set-mode', 'play-track', 'remove-track']),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export const voteCastSchema = z.object({
  approve: z.boolean(),
})
