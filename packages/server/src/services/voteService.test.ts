import type { User } from '@music-together/shared'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelVote,
  castVote,
  claimVote,
  createVote,
  getActiveVote,
  reconcileVote,
} from './voteService.js'

const initiator: User = { id: 'member-1', nickname: 'Member 1', role: 'member' }

afterEach(() => {
  cancelVote('ROOM01')
})

describe('voteService', () => {
  it('calculates a strict majority and auto-approves the initiator', () => {
    const vote = createVote('ROOM01', 'host', initiator, 'next', 4)

    expect(vote?.requiredVotes).toBe(3)
    expect(vote?.votes).toEqual({ 'member-1': true })
    expect(createVote('ROOM01', 'host', initiator, 'pause', 4)).toBeNull()
  })

  it('passes once the approval threshold is reached and rejects duplicate votes', () => {
    createVote('ROOM01', 'host', initiator, 'next', 3)

    expect(castVote('ROOM01', 'member-2', true)).toMatchObject({ decided: true, passed: true })
    expect(castVote('ROOM01', 'member-2', true)).toBeNull()
  })

  it('allows the conductor to veto immediately', () => {
    createVote('ROOM01', 'host', initiator, 'next', 5)

    expect(castVote('ROOM01', 'host', false)).toMatchObject({
      decided: true,
      passed: false,
      reason: 'host_veto',
    })
  })

  it('fails when remaining users cannot mathematically reach a majority', () => {
    createVote('ROOM01', 'host', initiator, 'next', 4)

    expect(castVote('ROOM01', 'member-2', false)).toMatchObject({ decided: false })
    expect(castVote('ROOM01', 'member-3', false)).toMatchObject({
      decided: true,
      passed: false,
      reason: 'rejected',
    })
  })

  it('reconciles thresholds, departed votes, and the current host', () => {
    createVote('ROOM01', 'old-host', initiator, 'next', 5)
    castVote('ROOM01', 'member-2', true)

    expect(reconcileVote('ROOM01', ['member-1', 'member-3', 'new-host'], 'new-host')).toMatchObject({
      decided: false,
      passed: false,
    })
    expect(getActiveVote('ROOM01')).toMatchObject({
      requiredVotes: 2,
      totalUsers: 3,
      hostId: 'new-host',
      votes: { 'member-1': true },
    })
  })

  it('decides immediately when a departure lowers the threshold below existing approvals', () => {
    createVote('ROOM01', 'host', initiator, 'next', 4)
    castVote('ROOM01', 'member-2', true)

    expect(reconcileVote('ROOM01', ['member-1', 'member-2', 'host'], 'host')).toMatchObject({
      decided: true,
      passed: true,
    })
  })

  it('raises the threshold when a user joins and lets the new host veto', () => {
    createVote('ROOM01', 'old-host', initiator, 'next', 3)

    expect(reconcileVote('ROOM01', ['member-1', 'member-2', 'member-3', 'new-host'], 'new-host')).toMatchObject({
      vote: { requiredVotes: 3, totalUsers: 4, hostId: 'new-host' },
      decided: false,
    })
    expect(castVote('ROOM01', 'new-host', false)).toMatchObject({
      decided: true,
      passed: false,
      reason: 'host_veto',
    })
  })

  it('applies an existing reject vote as a veto when that user becomes host', () => {
    createVote('ROOM01', 'old-host', initiator, 'next', 5)
    castVote('ROOM01', 'new-host', false)

    expect(reconcileVote('ROOM01', ['member-1', 'new-host', 'member-3'], 'new-host')).toMatchObject({
      decided: true,
      passed: false,
      reason: 'host_veto',
    })
  })

  it('allows a decided vote to be claimed only once and does not cancel a newer vote by old id', () => {
    const oldVote = createVote('ROOM01', 'host', initiator, 'next', 1)!

    expect(claimVote('ROOM01', oldVote.id)?.id).toBe(oldVote.id)
    expect(claimVote('ROOM01', oldVote.id)).toBeNull()

    const newVote = createVote('ROOM01', 'host', initiator, 'pause', 3)!
    cancelVote('ROOM01', oldVote.id)
    expect(getActiveVote('ROOM01')?.id).toBe(newVote.id)
  })
})
