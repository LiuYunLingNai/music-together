import type { Track } from '@music-together/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { roomRepo } from '../repositories/roomRepository.js'
import type { RoomData } from '../repositories/types.js'
import { estimateCurrentTime } from './syncService.js'

const track: Track = {
  id: 'track-1',
  title: 'Track',
  artist: ['Artist'],
  album: 'Album',
  duration: 120,
  cover: '',
  source: 'netease',
  sourceId: 'track-1',
  urlId: 'track-1',
}

function makeRoom(playState: RoomData['playState'], currentTrack: Track | null = track): RoomData {
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
    queue: currentTrack ? [currentTrack] : [],
    currentTrack,
    playState,
    playMode: 'sequential',
  }
}

afterEach(() => {
  roomRepo.delete('ROOM01')
  vi.useRealTimers()
})

describe('estimateCurrentTime', () => {
  it('returns zero for missing rooms', () => {
    expect(estimateCurrentTime('missing')).toBe(0)
  })

  it('returns the stored position while paused', () => {
    roomRepo.set('ROOM01', makeRoom({ isPlaying: false, currentTime: 42, serverTimestamp: 1, revision: 0 }))

    expect(estimateCurrentTime('ROOM01')).toBe(42)
  })

  it('adds elapsed playback time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
    roomRepo.set(
      'ROOM01',
      makeRoom({
        isPlaying: true,
        currentTime: 20,
        serverTimestamp: Date.now() - 5_000,
        revision: 0,
      }),
    )

    expect(estimateCurrentTime('ROOM01')).toBe(25)
  })

  it('does not subtract time for future scheduled timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
    roomRepo.set(
      'ROOM01',
      makeRoom({
        isPlaying: true,
        currentTime: 20,
        serverTimestamp: Date.now() + 2_000,
        revision: 0,
      }),
    )

    expect(estimateCurrentTime('ROOM01')).toBe(20)
  })

  it('clamps the estimate to the current track duration', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
    roomRepo.set(
      'ROOM01',
      makeRoom({
        isPlaying: true,
        currentTime: 119,
        serverTimestamp: Date.now() - 5_000,
        revision: 0,
      }),
    )

    expect(estimateCurrentTime('ROOM01')).toBe(120)
  })
})
