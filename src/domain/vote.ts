import type { VoteAction, VoteState } from './types'

export type VoteEvent =
  | { type: 'started'; vote: VoteState }
  | { type: 'result'; passed: boolean; action: VoteAction; reason?: string }
  | { type: 'disconnected' }

export interface VoteModel {
  active: VoteState | null
  lastResult?: { passed: boolean; action: VoteAction; reason?: string }
}

export function reduceVote(model: VoteModel, event: VoteEvent): VoteModel {
  if (event.type === 'started') return { ...model, active: event.vote }
  if (event.type === 'disconnected') return { ...model, active: null }
  return { active: null, lastResult: { passed: event.passed, action: event.action, reason: event.reason } }
}
