import { describe, expect, it } from 'vitest'
import { coverQuerySchema, playerPlaySchema, roomJoinSchema, voteStartSchema } from './schemas.js'

describe('shared input schemas', () => {
  it('preserves full native playback payloads and rejects incomplete external tracks', () => {
    const track = {
      id: 'qq-1',
      source: 'tencent',
      sourceId: '1',
      urlId: '1',
      title: '歌曲',
      artist: ['歌手'],
      album: '',
      duration: 180,
      cover: '',
      requestedBy: '用户',
    }
    expect(playerPlaySchema.parse({ track }).track).toEqual(track)
    expect(playerPlaySchema.safeParse({}).success).toBe(true)
    expect(playerPlaySchema.safeParse({ track: { id: 'qq-1' } }).success).toBe(false)
    expect(playerPlaySchema.safeParse({ track: { ...track, artist: '歌手' } }).success).toBe(false)
    expect(playerPlaySchema.safeParse({ track: { ...track, duration: Infinity } }).success).toBe(false)
  })
  it('rejects oversized room nicknames', () => {
    expect(roomJoinSchema.safeParse({ roomId: 'room', nickname: 'a'.repeat(101) }).success).toBe(false)
  })

  it('bounds requested cover sizes while allowing provider high-resolution artwork', () => {
    expect(coverQuerySchema.safeParse({ source: 'kugou', picId: 'hash', size: 5000 }).success).toBe(true)
    expect(coverQuerySchema.safeParse({ source: 'kugou', picId: 'hash', size: 5001 }).success).toBe(false)
  })

  it('validates vote payloads by action', () => {
    expect(voteStartSchema.safeParse({ action: 'next' }).success).toBe(true)
    expect(voteStartSchema.safeParse({ action: 'next', payload: { trackId: 'unexpected' } }).success).toBe(false)
    expect(voteStartSchema.safeParse({ action: 'play-track', payload: { trackId: 'track-1' } }).success).toBe(true)
    expect(voteStartSchema.safeParse({ action: 'play-track' }).success).toBe(false)
  })
})
