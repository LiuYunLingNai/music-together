import type { AudioQuality } from '@music-together/shared'
import type { RoomData } from '../repositories/types.js'
import { roomRepo } from '../repositories/roomRepository.js'
import * as authService from './authService.js'
import { musicProvider } from './musicProvider.js'
import { logger } from '../utils/logger.js'

/**
 * 网易云听歌打卡（服务端权威版）。
 *
 * 只有“提供本次音源、当前在线、且自己开启打卡”的网易云账号会收到记录；
 * 不足 30 秒、暂停期间、切歌/跳转跨过的部分都不算。写入真实账号，因此
 * 限流与去重比精确度更重要：
 *   · 两次上报至少间隔 5 秒；
 *   · 每个账号每小时最多 60 条；
 *   · 同一账号同时只允许一条在途请求；
 *   · 失败不重试。
 */

const MIN_LISTEN_SECONDS = 30
const MIN_REPORT_GAP_MS = 5_000
const MAX_REPORTS_PER_HOUR = 60
const HOUR_MS = 60 * 60 * 1000

interface ListeningSession {
  roomId: string
  trackId: string
  mediaId: string
  title: string
  artist: string
  totalSeconds: number
  quality: AudioQuality
  accountUserId: string
  cookie: string
  accumulatedMs: number
  /** 当前连续播放片段的起点；暂停/跳转后重置。 */
  segmentStartedAt: number | null
}

const sessions = new Map<string, ListeningSession>()
const lastSentAt = new Map<string, number>()
const sentTimes = new Map<string, number[]>()
const inFlight = new Set<string>()

const numericId = (value: string): string | null => (/^\d+$/.test(value) ? value : null)

const addSegment = (session: ListeningSession, now: number): void => {
  if (session.segmentStartedAt === null) return
  session.accumulatedMs += Math.max(0, now - session.segmentStartedAt)
  session.segmentStartedAt = now
}

/**
 * 曲目开始播放后调用。旧会话先结算，再决定是否为这次播放建立打卡会话。
 */
export function beginListeningReport(roomId: string, room: RoomData): void {
  finishListeningReport(roomId, 'track-change')
  const track = room.currentTrack
  if (!track || track.source !== 'netease') return
  const mediaId = numericId(track.urlId)
  if (!mediaId) return
  const totalSeconds = Number(track.duration)
  if (!Number.isFinite(totalSeconds) || totalSeconds < MIN_LISTEN_SECONDS) return

  const auth = authService.getBestAuth('netease', roomId)
  if (!auth) return
  // 账号主必须真的在房间里；离线账号不替房间背收听记录。
  if (!room.users.some((user) => user.id === auth.userId)) return
  if (!authService.isListeningReportEnabled(auth.userId, 'netease')) return

  sessions.set(roomId, {
    roomId,
    trackId: track.id,
    mediaId,
    title: track.title,
    artist: (Array.isArray(track.artist) ? track.artist : []).filter(Boolean).join(', '),
    totalSeconds,
    quality: room.audioQuality,
    accountUserId: auth.userId,
    cookie: auth.cookie,
    accumulatedMs: 0,
    // 暂停中跳到开头也会走 begin；此时不能把暂停的墙钟时间算进收听。
    segmentStartedAt: room.playState.isPlaying ? Date.now() : null,
  })
}

export function pauseListeningReport(roomId: string): void {
  const session = sessions.get(roomId)
  if (!session) return
  addSegment(session, Date.now())
  session.segmentStartedAt = null
}

export function resumeListeningReport(roomId: string): void {
  const session = sessions.get(roomId)
  if (!session || session.segmentStartedAt !== null) return
  session.segmentStartedAt = Date.now()
}

/** 跳转只结束当前片段，不把跳过的位置算进收听时长；回到开头视为重新播放。 */
export function seekListeningReport(roomId: string, positionSec: number): void {
  const session = sessions.get(roomId)
  if (!session) return
  addSegment(session, Date.now())
  if (positionSec <= 2 && session.accumulatedMs / 1000 >= MIN_LISTEN_SECONDS) {
    const room = roomRepo.get(roomId)
    if (!room) {
      sessions.delete(roomId)
      return
    }
    // 先结算这一次播放，再从当前位置开一份新会话（单曲循环/手动重播）。
    finishListeningReport(roomId, 'restart')
    beginListeningReport(roomId, room)
    return
  }
  const room = roomRepo.get(roomId)
  session.segmentStartedAt = room?.playState.isPlaying ? Date.now() : null
}

/** 切歌、停止或房间销毁时结算；不满足条件则静默丢弃。 */
export function finishListeningReport(roomId: string, reason: string): void {
  const session = sessions.get(roomId)
  if (!session) return
  sessions.delete(roomId)
  addSegment(session, Date.now())
  const playedSeconds = Math.min(session.totalSeconds, session.accumulatedMs / 1000)
  if (playedSeconds < MIN_LISTEN_SECONDS) return

  const room = roomRepo.get(roomId)
  if (!room || !room.users.some((user) => user.id === session.accountUserId)) return
  if (!authService.isListeningReportEnabled(session.accountUserId, 'netease')) return
  // 登出会删除持久化凭据；此时不应再用旧 cookie 写账号。
  const cookie = authService.getUserCookie(session.accountUserId, 'netease', roomId)
  if (!cookie) return

  void sendReport(session, cookie, playedSeconds, reason)
}

export function clearRoomListeningReport(roomId: string): void {
  sessions.delete(roomId)
}

async function sendReport(
  session: ListeningSession,
  cookie: string,
  playedSeconds: number,
  reason: string,
): Promise<void> {
  const account = session.accountUserId
  if (inFlight.has(account)) return

  const now = Date.now()
  const last = lastSentAt.get(account) ?? 0
  if (now - last < MIN_REPORT_GAP_MS) return

  const hourAgo = now - HOUR_MS
  const times = (sentTimes.get(account) ?? []).filter((at) => at > hourAgo)
  if (times.length >= MAX_REPORTS_PER_HOUR) {
    sentTimes.set(account, times)
    return
  }

  inFlight.add(account)
  try {
    const ok = await musicProvider.reportNeteasePlay(cookie, {
      id: session.mediaId,
      playedSeconds,
      totalSeconds: session.totalSeconds,
      name: session.title,
      artist: session.artist || undefined,
      quality: session.quality,
    })
    if (!ok) return
    const sentAt = Date.now()
    lastSentAt.set(account, sentAt)
    times.push(sentAt)
    sentTimes.set(account, times)
    logger.info('网易云听歌打卡已提交', {
      event: 'player.listening_report',
      roomId: session.roomId,
      trackId: session.trackId,
      playedSeconds: Math.round(playedSeconds),
      reason,
    })
  } finally {
    inFlight.delete(account)
  }
}
