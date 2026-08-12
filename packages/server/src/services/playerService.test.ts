import type { Track } from '@music-together/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { roomRepo } from '../repositories/roomRepository.js'
import { toPublicRoomState } from '../utils/roomUtils.js'
import type { RoomData } from '../repositories/types.js'
import {
  autoPlayIfEmpty,
  cleanupRoom,
  pauseTrack,
  playNextTrackInRoom,
  playPrevTrackInRoom,
  resumeTrack,
  seekTrack,
  setCurrentTrack,
  stopPlayback,
  syncPlaybackToSocket,
  validateConductorReport,
} from './playerService.js'

const track: Track = {
  id: 'track-1',
  title: 'Song',
  artist: ['Artist'],
  album: 'Album',
  duration: 180,
  cover: '',
  source: 'netease',
  sourceId: 'track-1',
  urlId: 'track-1',
  streamUrl: 'https://example.com/song.mp3',
}

function room(): RoomData {
  return {
    id: 'ROOM01',
    name: 'Room',
    password: null,
    creatorId: 'owner',
    hostId: 'owner',
    conductorSocketId: 'socket-owner',
    adminUserIds: new Set(),
    temporaryAdminUserId: null,
    audioQuality: 320,
    users: [{ id: 'owner', nickname: 'Owner', role: 'owner' }],
    queue: [track],
    currentTrack: track,
    playState: { isPlaying: true, currentTime: 10, serverTimestamp: Date.now(), revision: 0 },
    playMode: 'loop-all',
  }
}

function ioMock() {
  const emit = vi.fn()
  return {
    emit,
    io: { to: vi.fn(() => ({ emit })) },
  }
}

afterEach(() => {
  roomRepo.delete('ROOM01')
  cleanupRoom('ROOM01')
  vi.useRealTimers()
})

describe('playerService state transitions', () => {
  it('pauses at the scheduled execution position without seeking clients backwards', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const data = room()
    data.playState.serverTimestamp = Date.now() - 5_000
    roomRepo.set('ROOM01', data)
    const { io, emit } = ioMock()

    pauseTrack(io as never, 'ROOM01')

    expect(data.playState.isPlaying).toBe(true)
    expect(data.pendingPlayback?.type).toBe('pause')
    expect(data.pendingPlayback?.playState.currentTime).toBeCloseTo(15.3, 5)
    expect(data.pendingPlayback?.playState.serverTimestamp).toBe(Date.now() + 300)
    const pausePayload = emit.mock.calls.find(([event]) => event === 'player:pause')?.[1]
    expect(pausePayload).toMatchObject({
      playState: {
        currentTime: expect.closeTo(15.3, 5),
        serverTimeToExecute: Date.now() + 300,
      },
    })
  })

  it('resumes and seeks using future synchronized timestamps', () => {
    const data = room()
    data.playState.isPlaying = false
    roomRepo.set('ROOM01', data)
    roomRepo.setSocketMapping('socket', 'ROOM01', 'owner')
    roomRepo.setSocketRTT('socket', 200)
    const { io } = ioMock()

    resumeTrack(io as never, 'ROOM01')
    expect(data.playState.isPlaying).toBe(false)
    expect(data.pendingPlayback?.type).toBe('resume')
    expect(data.pendingPlayback?.playState.serverTimestamp).toBeGreaterThan(Date.now())

    seekTrack(io as never, 'ROOM01', 60)
    expect(data.pendingPlayback?.type).toBe('seek')
    expect(data.pendingPlayback?.playState.currentTime).toBe(60)
    expect(data.pendingPlayback?.playState.serverTimestamp).toBeGreaterThan(Date.now())

    seekTrack(io as never, 'ROOM01', 999)
    expect(data.pendingPlayback?.playState.currentTime).toBe(track.duration)
  })

  it('schedules room-wide stop playback at one authoritative time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const data = room()
    roomRepo.set('ROOM01', data)
    const { io, emit } = ioMock()

    stopPlayback(io as never, 'ROOM01')

    expect(data.currentTrack).toBe(track)
    expect(data.playState.isPlaying).toBe(true)
    expect(data.pendingPlayback?.type).toBe('stop')
    expect(data.pendingPlayback?.playState.serverTimestamp).toBe(Date.now() + 300)
    const pausePayload = emit.mock.calls.find(([event]) => event === 'player:pause')?.[1]
    expect(pausePayload).toMatchObject({
      playState: { serverTimeToExecute: data.pendingPlayback?.playState.serverTimestamp },
    })
    expect(emit.mock.calls.some(([event]) => event === 'room:state')).toBe(false)

    vi.advanceTimersByTime(300)
    expect(data.currentTrack).toBeNull()
    expect(data.playState).toMatchObject({ isPlaying: false, currentTime: 0 })
    expect(emit.mock.calls.some(([event]) => event === 'room:state')).toBe(true)
  })

  it('does not advance before a future pending play has actually started', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const data = room()
    data.currentTrack = null
    data.playState = { isPlaying: false, currentTime: 0, serverTimestamp: Date.now(), revision: 0 }
    const pendingState = {
      isPlaying: true,
      currentTime: 0,
      serverTimestamp: Date.now() + 300,
      serverTimeToExecute: Date.now() + 300,
      revision: 1,
    }
    data.pendingPlayback = {
      type: 'play',
      track,
      playState: pendingState,
      timer: setTimeout(() => {}, 300),
    }
    roomRepo.set('ROOM01', data)
    const { io } = ioMock()

    pauseTrack(io as never, 'ROOM01')

    expect(data.pendingPlayback?.playState.currentTime).toBe(0)
  })

  it('includes pending execution time in public room state for route recovery', () => {
    const data = room()
    roomRepo.set('ROOM01', data)
    const { io } = ioMock()

    pauseTrack(io as never, 'ROOM01')

    expect(toPublicRoomState(data).serverTimeToExecute).toBe(data.pendingPlayback?.playState.serverTimeToExecute)
  })

  it('keeps committed state unchanged until pause execution and then commits it once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const data = room()
    roomRepo.set('ROOM01', data)
    const { io } = ioMock()

    pauseTrack(io as never, 'ROOM01')
    expect(data.playState.isPlaying).toBe(true)
    expect(data.pendingPlayback?.type).toBe('pause')

    vi.advanceTimersByTime(300)
    expect(data.pendingPlayback).toBeNull()
    expect(data.playState.isPlaying).toBe(false)
    expect(data.playState.revision).toBe(1)
  })

  it('treats a pending first track as occupied so a second auto-play cannot replace it', async () => {
    const data = room()
    data.currentTrack = null
    data.playState = { isPlaying: false, currentTime: 0, serverTimestamp: Date.now(), revision: 0 }
    roomRepo.set('ROOM01', data)
    const { io } = ioMock()
    const first = { ...track, id: 'first', sourceId: 'first', urlId: 'first' }
    const second = { ...track, id: 'second', sourceId: 'second', urlId: 'second' }
    data.queue = [first, second]

    expect(await autoPlayIfEmpty(io as never, 'ROOM01', first)).toBe(true)
    expect(await autoPlayIfEmpty(io as never, 'ROOM01', second)).toBe(false)
    expect(data.pendingPlayback?.track?.id).toBe('first')
  })

  it('allows an immediate previous action after next while debouncing duplicate directions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const first = { ...track, id: 'first', sourceId: 'first', urlId: 'first' }
    const second = { ...track, id: 'second', sourceId: 'second', urlId: 'second' }
    const data = room()
    data.queue = [first, second]
    data.currentTrack = first
    roomRepo.set('ROOM01', data)
    const { io, emit } = ioMock()

    await playNextTrackInRoom(io as never, 'ROOM01', 'loop-all')
    expect(data.pendingPlayback?.track?.id).toBe('second')

    vi.advanceTimersByTime(300)
    await playPrevTrackInRoom(io as never, 'ROOM01')
    expect(data.pendingPlayback?.track?.id).toBe('first')

    const playCalls = emit.mock.calls.filter(([event]) => event === 'player:play')
    expect(playCalls).toHaveLength(2)
  })

  it('assigns a unique revision to every replacement action', () => {
    const data = room()
    roomRepo.set('ROOM01', data)
    const { io } = ioMock()

    pauseTrack(io as never, 'ROOM01')
    const pauseRevision = data.pendingPlayback?.playState.revision
    seekTrack(io as never, 'ROOM01', 60)

    expect(data.pendingPlayback?.playState.revision).toBeGreaterThan(pauseRevision ?? -1)
  })

  it('replaces an earlier scheduled action instead of committing both', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const data = room()
    roomRepo.set('ROOM01', data)
    const { io } = ioMock()

    pauseTrack(io as never, 'ROOM01')
    seekTrack(io as never, 'ROOM01', 60)
    expect(data.pendingPlayback?.type).toBe('seek')

    vi.advanceTimersByTime(300)
    expect(data.playState.isPlaying).toBe(false)
    expect(data.playState.currentTime).toBe(60)
  })

  it('resets playback state when the current track is cleared', () => {
    roomRepo.set('ROOM01', room())

    setCurrentTrack('ROOM01', null)

    expect(roomRepo.get('ROOM01')).toMatchObject({
      currentTrack: null,
      playState: { isPlaying: false, currentTime: 0 },
    })
  })

  it('never accepts a conductor report that would roll playback back by seconds', () => {
    expect(validateConductorReport('ROOM01', 1, 10)).toBe(false)
    expect(validateConductorReport('ROOM01', 1, 10)).toBe(false)
    expect(validateConductorReport('ROOM01', 9, 10)).toBe(true)
  })

  it('clamps a joining client scheduled position to the track duration', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const data = room()
    data.currentTrack = { ...track, duration: 120 }
    data.playState = { isPlaying: true, currentTime: 120, serverTimestamp: Date.now(), revision: 3 }
    data.users.push({ id: 'member', nickname: 'Member', role: 'member' })
    roomRepo.set('ROOM01', data)
    const emit = vi.fn()
    const socket = { emit }
    const { io } = ioMock()

    await syncPlaybackToSocket(io as never, socket as never, 'ROOM01', data)

    expect(emit).toHaveBeenCalledWith(
      'player:play',
      expect.objectContaining({
        playState: expect.objectContaining({ currentTime: 120 }),
      }),
    )
  })
})
