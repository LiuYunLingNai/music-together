import { createHash } from 'node:crypto'
import {
  normalizeNeteaseRoamingMode,
  type NeteaseRoamingMode,
  type PlayMode,
  type RoamingSource,
  type Track,
} from '@music-together/shared'
import type { RoomData } from '../repositories/types.js'
import * as authService from './authService.js'
import { musicProvider } from './musicProvider.js'

export interface RoamingTrackProvider {
  getRoamingTracks(
    source: RoamingSource,
    cookie: string,
    mode?: NeteaseRoamingMode,
    limit?: number,
    page?: number,
  ): Promise<{ tracks: Track[]; nextPage?: number } | Track[]>
}

export const ROAMING_REQUESTER_LABEL = '私人漫游'

/** 漫游曲目用显式字段标记；旧房间只有 `requestedBy` 昵称，仍需兼容。 */
export const isRoamingTrack = (track: Track | null | undefined): boolean =>
  track?.roaming === true || track?.requestedBy === ROAMING_REQUESTER_LABEL

/**
 * Decide whether NEXT should ask roaming before applying the queue's normal
 * wrap behaviour. User songs ahead of the current queue item keep priority;
 * loop-one and shuffle retain their existing playback semantics.
 */
export function shouldPreferRoamingForNext(room: RoomData, playMode: PlayMode): boolean {
  if (!room.roamingEnabled) return false
  if (!room.currentTrack) return room.queue.length === 0
  if (playMode === 'loop-one' || playMode === 'shuffle') return false
  const currentIndex = room.queue.findIndex((track) => track.id === room.currentTrack?.id)
  if (isRoamingTrack(room.currentTrack)) {
    // Covers both newly queued roaming tracks and rooms restored from an older
    // version where the currently playing roaming track was not queued yet.
    return currentIndex < 0 ? room.queue.length === 0 : currentIndex === room.queue.length - 1
  }
  return currentIndex >= 0 && currentIndex === room.queue.length - 1
}

/** How many recommendation tracks one radio fetch appends to the queue. */
export const ROAMING_BATCH_SIZE = 5
/** 同一平台连续失败后先停一会儿，避免每个 NEXT 都重打上游。 */
const ROAMING_FAILURE_COOLDOWN_MS = 30_000
/** 405（操作频繁）不是普通失败，退避要更长。 */
const ROAMING_RATE_LIMIT_COOLDOWN_MS = 120_000
/** 同一账号两次推荐请求的最短间隔；快速切歌/多房间不会叠加成请求风暴。 */
const ROAMING_MIN_REQUEST_GAP_MS = 1_500

/** 账号键只用于内存节流，不写日志、不落盘。 */
const accountKeyOf = (source: RoamingSource, cookie: string): string =>
  `${source}:${createHash('sha256').update(cookie).digest('hex').slice(0, 16)}`

interface RoomRoamingState {
  /** 最近已投放的曲目键（source:sourceId）。 */
  recentKeys: string[]
  /** 最近已投放的规范化指纹（歌名+歌手+时长），用于跨平台去重。 */
  recentFingerprints: string[]
  /** 最近投放的歌手，用于同歌手节流。 */
  recentArtists: string[]
  /** QQ 雷达的分页游标。 */
  pages: Partial<Record<RoamingSource, number>>
}

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(/[’'"“”()（）[\]【】\-—_·•:：,，.。/\\|]/g, '')
    .trim()

const fingerprintOf = (track: Track): string =>
  `${normalizeText(track.title)}|${normalizeText(track.artist?.[0] ?? '')}|${Math.round((track.duration ?? 0) / 5)}`

/**
 * 私人漫游按“电台”工作：一次请求取回一小批歌全部入队，而不是每切一首
 * 就再打一次上游。连续跳歌/网络抖动时不会因为上游慢而卡在切歌上，
 * 也更接近上游 Personal FM 的连续流体验。
 */
export function createRoamingService(
  provider: RoamingTrackProvider = musicProvider,
  getCookie: typeof authService.getUserCookie = authService.getUserCookie,
) {
  const stateByRoom = new Map<string, RoomRoamingState>()
  /** 按“账号 + 平台”冷却：一个房间/账号被限流不应误伤其他账号。 */
  const failureUntil = new Map<string, number>()
  const lastRequestAt = new Map<string, number>()
  const inFlight = new Set<string>()

  const stateOf = (roomId: string): RoomRoamingState => {
    const existing = stateByRoom.get(roomId)
    if (existing) return existing
    const created: RoomRoamingState = { recentKeys: [], recentFingerprints: [], recentArtists: [], pages: {} }
    stateByRoom.set(roomId, created)
    return created
  }

  const getBatch = async (room: RoomData, count = ROAMING_BATCH_SIZE, limit = 50): Promise<Track[]> => {
    if (!room.roamingEnabled || count <= 0) return []

    const cookie = getCookie(room.creatorId, room.roamingSource, room.id)
    if (!cookie) return []

    const accountKey = accountKeyOf(room.roamingSource, cookie)
    const now = Date.now()
    if ((failureUntil.get(accountKey) ?? 0) > now) return []
    // 同账号已有请求在飞、或刚打过一次：这一轮跳过，下一次切歌/补货再试。
    if (inFlight.has(accountKey)) return []
    if (now - (lastRequestAt.get(accountKey) ?? 0) < ROAMING_MIN_REQUEST_GAP_MS) return []

    const state = stateOf(room.id)
    const mode = room.roamingSource === 'netease' ? normalizeNeteaseRoamingMode(room.roamingMode) : 'DEFAULT'
    const page = state.pages[room.roamingSource] ?? 1
    let outcome: { tracks: Track[]; nextPage?: number }
    inFlight.add(accountKey)
    lastRequestAt.set(accountKey, now)
    try {
      const raw = await provider.getRoamingTracks(room.roamingSource, cookie, mode, limit, page)
      // 旧 provider/用例直接返回数组；新实现带分页游标。
      outcome = Array.isArray(raw) ? { tracks: raw } : raw
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      const rateLimited = /405|频繁|too many|rate.?limit/i.test(message)
      failureUntil.set(
        accountKey,
        Date.now() + (rateLimited ? ROAMING_RATE_LIMIT_COOLDOWN_MS : ROAMING_FAILURE_COOLDOWN_MS),
      )
      throw error
    } finally {
      inFlight.delete(accountKey)
    }
    if (outcome.nextPage !== undefined) state.pages[room.roamingSource] = outcome.nextPage
    else delete state.pages[room.roamingSource]

    const usedKeys = new Set<string>()
    const usedFingerprints = new Set<string>()
    if (room.currentTrack) {
      usedKeys.add(`${room.currentTrack.source}:${room.currentTrack.sourceId}`)
      usedFingerprints.add(fingerprintOf(room.currentTrack))
    }
    for (const track of room.queue) {
      usedKeys.add(`${track.source}:${track.sourceId}`)
      usedFingerprints.add(fingerprintOf(track))
    }

    const recentKeys = new Set(state.recentKeys)
    const recentFingerprints = new Set(state.recentFingerprints)
    const recentArtists = new Set(state.recentArtists)
    const candidates = outcome.tracks.filter(
      (track) =>
        track.sourceId &&
        !usedKeys.has(`${track.source}:${track.sourceId}`) &&
        !usedFingerprints.has(fingerprintOf(track)),
    )
    const notRecent = (track: Track): boolean =>
      !recentKeys.has(`${track.source}:${track.sourceId}`) && !recentFingerprints.has(fingerprintOf(track))

    // 三层放宽：先避开最近曲目和歌手，再只避开最近曲目，最后才允许复用候选。
    const fresh = candidates.filter((track) => notRecent(track) && !recentArtists.has(track.artist?.[0] ?? ''))
    const varied = fresh.length >= count ? fresh : candidates.filter(notRecent)
    const picked = [...(varied.length >= count ? varied : candidates)].slice(0, count)
    if (picked.length === 0) return []

    const pickedKeys = picked.map((track) => `${track.source}:${track.sourceId}`)
    const pickedFingerprints = picked.map(fingerprintOf)
    const pickedArtists = picked.map((track) => track.artist?.[0] ?? '').filter(Boolean)
    state.recentKeys = [...state.recentKeys, ...pickedKeys].slice(-40)
    state.recentFingerprints = [...state.recentFingerprints, ...pickedFingerprints].slice(-40)
    state.recentArtists = [...state.recentArtists, ...pickedArtists].slice(-8)
    return picked.map((track) => ({ ...track, requestedBy: ROAMING_REQUESTER_LABEL, roaming: true }))
  }

  return {
    getBatch,
    /** 兼容旧调用/用例：取一首推荐。 */
    async getNextTrack(room: RoomData, limit = 50): Promise<Track | null> {
      const [track] = await getBatch(room, 1, limit)
      return track ?? null
    },
    clearRoom: (roomId: string): void => {
      stateByRoom.delete(roomId)
    },
  }
}

export const roamingService = createRoamingService()
