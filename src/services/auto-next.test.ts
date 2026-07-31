import { describe, expect, it } from 'vitest'
import { shouldSendAutoNext } from './auto-next'

describe('shouldSendAutoNext', () => {
  it('allows the host to advance a naturally-ended playback exactly once', () => {
    const base = { currentUserId: 'owner-1', hostId: 'owner-1', playbackKey: 'song-1:100' }
    expect(shouldSendAutoNext({ ...base, sentPlaybackKey: '' })).toBe(true)
    expect(shouldSendAutoNext({ ...base, sentPlaybackKey: base.playbackKey })).toBe(false)
  })

  it('does not let a non-host advance the queue', () => {
    expect(shouldSendAutoNext({
      currentUserId: 'member-1',
      hostId: 'owner-1',
      playbackKey: 'song-1:100',
      sentPlaybackKey: '',
    })).toBe(false)
  })

  it('treats replaying the same track as a new playback', () => {
    expect(shouldSendAutoNext({
      currentUserId: 'owner-1',
      hostId: 'owner-1',
      playbackKey: 'song-1:200',
      sentPlaybackKey: 'song-1:100',
    })).toBe(true)
  })

  it('requires a reliable initialized identity and playback key', () => {
    expect(shouldSendAutoNext({ currentUserId: '', hostId: 'owner-1', playbackKey: 'song-1:100', sentPlaybackKey: '' })).toBe(false)
    expect(shouldSendAutoNext({ currentUserId: 'owner-1', hostId: 'owner-1', playbackKey: '', sentPlaybackKey: '' })).toBe(false)
  })
})
