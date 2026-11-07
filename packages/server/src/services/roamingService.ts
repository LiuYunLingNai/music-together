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
  getRoamingTracks(source: RoamingSource, cookie: string, mode?: NeteaseRoamingMode, limit?: number): Promise<Track[]>
}

export const ROAMING_REQUESTER_LABEL = '私人漫游'

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
  if (room.currentTrack.requestedBy === ROAMING_REQUESTER_LABEL) {
    // Covers both newly queued roaming tracks and rooms restored from an older
    // version where the currently playing roaming track was not queued yet.
    return currentIndex < 0 ? room.queue.length === 0 : currentIndex === room.queue.length - 1
  }
  return currentIndex >= 0 && currentIndex === room.queue.length - 1
}

/**
 * Select one personalized track for a room. Roaming always uses the room
 * creator's credential; another member's login must never silently become the
 * source of the room's personalized recommendations.
 */
/** How many recommendation tracks one radio fetch appends to the queue. */
export const ROAMING_BATCH_SIZE = 5

/**
 * 私人漫游按“电台”工作：一次请求取回一小批歌全部入队，而不是每切一首
 * 就再打一次上游。连续跳歌/网络抖动时不会因为上游慢而卡在切歌上，
 * 也更接近上游 Personal FM 的连续流体验。
 */
export function createRoamingService(
  provider: RoamingTrackProvider = musicProvider,
  getCookie: typeof authService.getUserCookie = authService.getUserCookie,
) {
  const recentByRoom = new Map<string, string[]>()

  const getBatch = async (room: RoomData, count = ROAMING_BATCH_SIZE, limit = 50): Promise<Track[]> => {
    if (!room.roamingEnabled || count <= 0) return []

    const cookie = getCookie(room.creatorId, room.roamingSource, room.id)
    if (!cookie) return []

    const mode = room.roamingSource === 'netease' ? normalizeNeteaseRoamingMode(room.roamingMode) : 'DEFAULT'
    const candidates = await provider.getRoamingTracks(room.roamingSource, cookie, mode, limit)
    const used = new Set<string>()
    if (room.currentTrack) used.add(`${room.currentTrack.source}:${room.currentTrack.sourceId}`)
    for (const track of room.queue) used.add(`${track.source}:${track.sourceId}`)

    const recent = recentByRoom.get(room.id) ?? []
    const recentlyPlayed = new Set(recent)
    const available = candidates.filter((track) => track.sourceId && !used.has(`${track.source}:${track.sourceId}`))
    const fresh = available.filter((track) => !recentlyPlayed.has(`${track.source}:${track.sourceId}`))
    // 新鲜度优先；不够一批时用没进过队列的旧候选补齐，避免切歌中途断粮。
    const picked = [...fresh, ...available.filter((track) => !fresh.includes(track))].slice(0, count)
    if (picked.length === 0) return []

    const pickedKeys = picked.map((track) => `${track.source}:${track.sourceId}`)
    recentByRoom.set(room.id, [...recent, ...pickedKeys].slice(-20))
    return picked.map((track) => ({ ...track, requestedBy: ROAMING_REQUESTER_LABEL }))
  }

  return {
    getBatch,
    async getNextTrack(room: RoomData, limit = 50): Promise<Track | null> {
      const [track] = await getBatch(room, 1, limit)
      return track ?? null
    },
  }
}

export const roamingService = createRoamingService()
