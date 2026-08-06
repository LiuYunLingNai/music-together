import { describe, expect, it } from 'vitest'
import { canDirectly, canManageQueueAction, voteActionFor } from './permissions'

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

  it('splits temporary admin queue permissions by room setting', () => {
    const base = { userId: 'temp', temporaryAdminUserId: 'temp', isServerAdmin: false }
    expect(canManageQueueAction('admin', 'remove-track', base)).toBe(false)
    expect(canManageQueueAction('admin', 'clear-queue', base)).toBe(false)
    expect(canManageQueueAction('admin', 'remove-track', { ...base, allowTemporaryAdminTrackRemoval: true })).toBe(true)
    expect(canManageQueueAction('admin', 'clear-queue', { ...base, allowTemporaryAdminQueueClear: true })).toBe(true)
    expect(canManageQueueAction('admin', 'clear-queue', { ...base, isServerAdmin: true })).toBe(true)
  })
})
