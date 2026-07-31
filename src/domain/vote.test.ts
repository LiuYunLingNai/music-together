import { describe, expect, it } from 'vitest'
import { reduceVote } from './vote'
import type { VoteState } from './types'

const vote: VoteState = { id: 'v1', action: 'next', initiatorId: 'u1', initiatorNickname: 'A', votes: { u1: true }, requiredVotes: 2, totalUsers: 3, expiresAt: 1000 }

describe('vote state updates', () => {
  it('replaces the active vote with authoritative server updates', () => {
    expect(reduceVote({ active: null }, { type: 'started', vote }).active).toEqual(vote)
  })

  it('clears active state and records a host veto result', () => {
    expect(reduceVote({ active: vote }, { type: 'result', passed: false, action: 'next', reason: 'host_veto' })).toEqual({
      active: null,
      lastResult: { passed: false, action: 'next', reason: 'host_veto' },
    })
  })
})
