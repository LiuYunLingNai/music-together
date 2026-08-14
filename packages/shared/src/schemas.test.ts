import { describe, expect, it } from 'vitest'
import { coverQuerySchema, roomJoinSchema, voteStartSchema } from './schemas.js'

describe('shared input schemas', () => {
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
