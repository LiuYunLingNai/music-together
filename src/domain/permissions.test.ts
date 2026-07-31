import { describe, expect, it } from 'vitest'
import { canDirectly, voteActionFor } from './permissions'

describe('room permissions', () => {
  it('gives owners and server admins full direct control', () => {
    expect(canDirectly('owner', 'room-settings')).toBe(true)
    expect(canDirectly('member', 'set-role', true)).toBe(true)
  })

  it('lets admins control playback and queues but not owner settings', () => {
    expect(canDirectly('admin', 'next')).toBe(true)
    expect(canDirectly('admin', 'reorder')).toBe(true)
    expect(canDirectly('admin', 'room-settings')).toBe(false)
    expect(canDirectly('admin', 'set-role')).toBe(false)
  })

  it('limits members to adding tracks and maps controls to votes', () => {
    expect(canDirectly('member', 'add')).toBe(true)
    expect(canDirectly('member', 'pause')).toBe(false)
    expect(voteActionFor('pause')).toBe('pause')
    expect(voteActionFor('remove')).toBe('remove-track')
  })
})
