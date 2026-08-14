import type { User } from '@music-together/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { cancelVote, castVote, claimVote, createVote, getActiveVote, reconcileVote } from './voteService'

const initiator: User = {
  id: 'member-1',
  nickname: 'Member 1',
  role: 'member',
  isServerAdmin: false,
}

afterEach(() => cancelVote('ROOM01'))

describe('voteService', () => {
  it('reconciles membership, threshold and current veto holder', () => {
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

  it('allows a decided vote to be claimed only once', () => {
    const vote = createVote('ROOM01', 'host', initiator, 'next', 1)!
    expect(claimVote('ROOM01', vote.id)?.id).toBe(vote.id)
    expect(claimVote('ROOM01', vote.id)).toBeNull()
  })

  it('does not let an old timeout cancel a newer vote', () => {
    const oldVote = createVote('ROOM01', 'host', initiator, 'next', 1)!
    claimVote('ROOM01', oldVote.id)
    const newVote = createVote('ROOM01', 'host', initiator, 'pause', 3)!

    cancelVote('ROOM01', oldVote.id)

    expect(getActiveVote('ROOM01')?.id).toBe(newVote.id)
  })
})
