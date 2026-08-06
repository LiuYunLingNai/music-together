import { describe, expect, it } from 'vitest'
import { roomIdFromLink } from '../../electron/room-link'

describe('room deep links', () => {
  it('extracts room ids from web and custom-protocol links', () => {
    expect(roomIdFromLink('https://music.example/room/room_123?invite=1')).toBe('room_123')
    expect(roomIdFromLink('musictogether://room/private-room')).toBe('private-room')
    expect(roomIdFromLink('musictogether:///room/another-room')).toBe('another-room')
  })

  it('rejects unsupported protocols and unsafe room ids', () => {
    expect(roomIdFromLink('ftp://music.example/room/room-1')).toBeNull()
    expect(roomIdFromLink('https://music.example/room/not%20safe')).toBeNull()
    expect(roomIdFromLink('https://music.example/profile/room-1')).toBeNull()
  })
})
