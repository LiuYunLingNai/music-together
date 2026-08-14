import { describe, expect, it } from 'vitest'
import { defineAbilityFor } from './abilities'

describe('defineAbilityFor', () => {
  it('grants owners full access', () => {
    const ability = defineAbilityFor('owner')
    expect(ability.can('manage', 'all')).toBe(true)
    expect(ability.can('set-role', 'Room')).toBe(true)
    expect(ability.can('remove', 'Queue')).toBe(true)
  })

  it('grants admins direct playback and queue controls without room management', () => {
    const ability = defineAbilityFor('admin')
    expect(ability.can('play', 'Player')).toBe(true)
    expect(ability.can('remove', 'Queue')).toBe(true)
    expect(ability.can('manage', 'Room')).toBe(false)
    expect(ability.can('vote', 'Player')).toBe(false)
  })

  it('limits members to adding tracks and requesting actions by vote', () => {
    const ability = defineAbilityFor('member')
    expect(ability.can('add', 'Queue')).toBe(true)
    expect(ability.can('vote', 'Player')).toBe(true)
    expect(ability.can('play', 'Player')).toBe(false)
    expect(ability.can('remove', 'Queue')).toBe(false)
  })
})
