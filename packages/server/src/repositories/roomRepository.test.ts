import type { Track } from '@music-together/shared'
import { describe, expect, it } from 'vitest'
import { InMemoryRoomRepository } from './roomRepository.js'
import type { RoomData } from './types.js'

function makeRoom(): RoomData {
  const currentTrack: Track = {
    id: 'track',
    title: 'Song',
    artist: ['Artist'],
    album: 'Album',
    duration: 100,
    cover: '',
    source: 'netease',
    sourceId: 'track',
    urlId: 'track',
  }
  return {
    id: 'ROOM01',
    name: 'Room',
    password: 'secret',
    creatorId: 'owner',
    hostId: 'owner',
    conductorSocketId: 'socket-owner',
    adminUserIds: new Set(),
    temporaryAdminUserId: null,
    audioQuality: 320,
    users: [{ id: 'owner', nickname: 'Owner', role: 'owner' }],
    queue: [currentTrack],
    currentTrack,
    playState: { isPlaying: false, currentTime: 0, serverTimestamp: 0, revision: 0 },
    playMode: 'loop-all',
  }
}

describe('InMemoryRoomRepository', () => {
  it('maintains socket mappings and detects another socket for the same user', () => {
    const repo = new InMemoryRoomRepository()
    repo.setSocketMapping('socket-1', 'ROOM01', 'user-1')
    repo.setSocketMapping('socket-2', 'ROOM01', 'user-1')

    expect(repo.hasOtherSocketForUser('ROOM01', 'user-1', 'socket-1')).toBe(true)
    expect(repo.getSocketIdForUser('ROOM01', 'user-1')).toMatch(/^socket-/)
    repo.deleteSocketMapping('socket-2')
    expect(repo.hasOtherSocketForUser('ROOM01', 'user-1', 'socket-1')).toBe(false)
  })

  it('smooths RTT samples and uses max for small rooms', () => {
    const repo = new InMemoryRoomRepository()
    repo.setSocketMapping('socket-1', 'ROOM01', 'user-1')
    repo.setSocketMapping('socket-2', 'ROOM01', 'user-2')
    repo.setSocketRTT('socket-1', 100)
    repo.setSocketRTT('socket-1', 200)
    repo.setSocketRTT('socket-2', 150)

    expect(repo.getSocketRTT('socket-1')).toBe(120)
    expect(repo.getP90RTT('ROOM01')).toBe(150)
  })

  it('returns a public room list without exposing passwords', () => {
    const repo = new InMemoryRoomRepository()
    repo.set('ROOM01', makeRoom())

    expect(repo.getAllAsList()).toEqual([
      {
        id: 'ROOM01',
        name: 'Room',
        hasPassword: true,
        userCount: 1,
        currentTrackTitle: 'Song',
        currentTrackArtist: 'Artist',
      },
    ])
  })
})
