import type { UserRole, VoteAction } from './types'

export type DirectAction = 'play' | 'pause' | 'seek' | 'next' | 'prev' | 'set-mode' | 'add' | 'remove' | 'reorder' | 'room-settings' | 'set-role'

export function canDirectly(role: UserRole | undefined, action: DirectAction, isServerAdmin = false): boolean {
  if (isServerAdmin || role === 'owner') return true
  if (role === 'admin') return action !== 'room-settings' && action !== 'set-role'
  return action === 'add'
}

export function voteActionFor(action: DirectAction, isPlaying = false): VoteAction | null {
  switch (action) {
    case 'play': return isPlaying ? null : 'resume'
    case 'pause': return 'pause'
    case 'next': return 'next'
    case 'prev': return 'prev'
    case 'set-mode': return 'set-mode'
    case 'remove': return 'remove-track'
    default: return null
  }
}
