import type { Track } from '@music-together/shared'
import { LIMITS } from '@music-together/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { roomRepo } from '../repositories/roomRepository.js'
import type { RoomData } from '../repositories/types.js'
import {
  addBatchTracks,
  getNextTrack,
  getPreviousTrack,
  getSuccessorAfterRemoval,
  insertAfterCurrent,
  reorderTracks,
} from './queueService.js'

function makeTrack(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: ['Artist'],
    album: 'Album',
    duration: 180,
    cover: '',
    source: 'netease',
    sourceId: id,
    urlId: id,
  }
}

function makeRoom(queue: Track[], currentTrack: Track | null = null): RoomData {
  return {
    id: 'ROOM01',
    name: 'Test Room',
    password: null,
    creatorId: 'owner',
    hostId: 'owner',
    conductorSocketId: 'socket-owner',
    adminUserIds: new Set(),
    temporaryAdminUserId: null,
    audioQuality: 320,
    users: [],
    queue,
    currentTrack,
    playState: { isPlaying: false, currentTime: 0, serverTimestamp: Date.now(), revision: 0 },
    playMode: 'sequential',
  }
}

afterEach(() => {
  roomRepo.delete('ROOM01')
  vi.restoreAllMocks()
})

describe('queueService', () => {
  it('inserts immediately after the current track', () => {
    const a = makeTrack('a')
    const b = makeTrack('b')
    const inserted = makeTrack('inserted')
    roomRepo.set('ROOM01', makeRoom([a, b], a))

    expect(insertAfterCurrent('ROOM01', inserted)).toBe(true)
    expect(roomRepo.get('ROOM01')?.queue.map((track) => track.id)).toEqual(['a', 'inserted', 'b'])
  })

  it('reorders known IDs without dropping unspecified tracks or duplicating IDs', () => {
    const a = makeTrack('a')
    const b = makeTrack('b')
    const c = makeTrack('c')
    roomRepo.set('ROOM01', makeRoom([a, b, c], a))

    reorderTracks('ROOM01', ['c', 'c', 'missing', 'a'])

    expect(roomRepo.get('ROOM01')?.queue.map((track) => track.id)).toEqual(['c', 'a', 'b'])
  })

  it('respects the queue capacity for batch additions', () => {
    const existing = Array.from({ length: LIMITS.QUEUE_MAX_SIZE - 1 }, (_, i) => makeTrack(`existing-${i}`))
    roomRepo.set('ROOM01', makeRoom(existing))

    expect(addBatchTracks('ROOM01', [makeTrack('new-1'), makeTrack('new-2')])).toBe(1)
    expect(roomRepo.get('ROOM01')?.queue).toHaveLength(LIMITS.QUEUE_MAX_SIZE)
  })

  it('implements sequential, loop and shuffle next-track behavior', () => {
    const a = makeTrack('a')
    const b = makeTrack('b')
    const c = makeTrack('c')
    roomRepo.set('ROOM01', makeRoom([a, b, c], c))

    expect(getNextTrack('ROOM01', 'sequential')).toBeNull()
    expect(getNextTrack('ROOM01', 'loop-all')?.id).toBe('a')
    expect(getNextTrack('ROOM01', 'loop-one')?.id).toBe('c')

    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(getNextTrack('ROOM01', 'shuffle')?.id).toBe('a')
  })

  it('selects the item after a removed current track without jumping backwards', () => {
    const a = makeTrack('a')
    const b = makeTrack('b')
    const c = makeTrack('c')
    roomRepo.set('ROOM01', makeRoom([a, b, c], b))

    expect(getSuccessorAfterRemoval('ROOM01', 'b', 'sequential')?.id).toBe('c')
    expect(getSuccessorAfterRemoval('ROOM01', 'c', 'sequential')).toBeNull()
    expect(getSuccessorAfterRemoval('ROOM01', 'c', 'loop-all')?.id).toBe('a')
  })

  it('wraps previous track only in loop-all mode', () => {
    const a = makeTrack('a')
    const b = makeTrack('b')
    const room = makeRoom([a, b], a)
    roomRepo.set('ROOM01', room)

    expect(getPreviousTrack('ROOM01')).toBeNull()
    room.playMode = 'loop-all'
    expect(getPreviousTrack('ROOM01')?.id).toBe('b')
  })
})
