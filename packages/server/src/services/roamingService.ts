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
export function createRoamingService(
  provider: RoamingTrackProvider = musicProvider,
  getCookie: typeof authService.getUserCookie = authService.getUserCookie,
) {
  const recentByRoom = new Map<string, string[]>()

  return {
    async getNextTrack(room: RoomData, limit = 50): Promise<Track | null> {
      if (!room.roamingEnabled) return null

      const cookie = getCookie(room.creatorId, room.roamingSource, room.id)
      if (!cookie) return null

      const mode = room.roamingSource === 'netease' ? normalizeNeteaseRoamingMode(room.roamingMode) : 'DEFAULT'
      const candidates = await provider.getRoamingTracks(room.roamingSource, cookie, mode, limit)
      const used = new Set<string>()
      if (room.currentTrack) used.add(`${room.currentTrack.source}:${room.currentTrack.sourceId}`)
      for (const track of room.queue) used.add(`${track.source}:${track.sourceId}`)

      const recent = recentByRoom.get(room.id) ?? []
      const recentlyPlayed = new Set(recent)
      const available = candidates.filter(
        (track) => track.sourceId && !used.has(`${track.source}:${track.sourceId}`),
      )
      const next = available.find((track) => !recentlyPlayed.has(`${track.source}:${track.sourceId}`)) ?? available[0]
      if (!next) return null

      const key = `${next.source}:${next.sourceId}`
      recentByRoom.set(room.id, [...recent.filter((item) => item !== key), key].slice(-20))
      return { ...next, requestedBy: ROAMING_REQUESTER_LABEL }
    },
  }
}

export const roamingService = createRoamingService()
