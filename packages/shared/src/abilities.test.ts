import { describe, expect, it } from 'vitest'
import { defineAbilityFor } from './abilities.js'

describe('defineAbilityFor', () => {
  it('grants owners full room, player, queue, and voting access', () => {
    const ability = defineAbilityFor('owner')

    expect(ability.can('manage', 'all')).toBe(true)
    expect(ability.can('set-role', 'Room')).toBe(true)
    expect(ability.can('play', 'Player')).toBe(true)
    expect(ability.can('pause', 'Player')).toBe(true)
    expect(ability.can('seek', 'Player')).toBe(true)
    expect(ability.can('next', 'Player')).toBe(true)
    expect(ability.can('prev', 'Player')).toBe(true)
    expect(ability.can('set-mode', 'Player')).toBe(true)
    expect(ability.can('add', 'Queue')).toBe(true)
    expect(ability.can('remove', 'Queue')).toBe(true)
    expect(ability.can('reorder', 'Queue')).toBe(true)
    expect(ability.can('vote', 'Player')).toBe(true)
  })

  it('grants admins direct player and queue controls without room management', () => {
    const ability = defineAbilityFor('admin')

    expect(ability.can('play', 'Player')).toBe(true)
    expect(ability.can('pause', 'Player')).toBe(true)
    expect(ability.can('seek', 'Player')).toBe(true)
    expect(ability.can('next', 'Player')).toBe(true)
    expect(ability.can('prev', 'Player')).toBe(true)
    expect(ability.can('set-mode', 'Player')).toBe(true)
    expect(ability.can('add', 'Queue')).toBe(true)
    expect(ability.can('remove', 'Queue')).toBe(true)
    expect(ability.can('reorder', 'Queue')).toBe(true)
    expect(ability.can('manage', 'Room')).toBe(false)
    expect(ability.can('set-role', 'Room')).toBe(false)
    expect(ability.can('vote', 'Player')).toBe(false)
  })

  it('limits members to adding tracks and requesting controls through votes', () => {
    const ability = defineAbilityFor('member')

    expect(ability.can('add', 'Queue')).toBe(true)
    expect(ability.can('vote', 'Player')).toBe(true)
    expect(ability.can('play', 'Player')).toBe(false)
    expect(ability.can('pause', 'Player')).toBe(false)
    expect(ability.can('seek', 'Player')).toBe(false)
    expect(ability.can('next', 'Player')).toBe(false)
    expect(ability.can('prev', 'Player')).toBe(false)
    expect(ability.can('set-mode', 'Player')).toBe(false)
    expect(ability.can('remove', 'Queue')).toBe(false)
    expect(ability.can('reorder', 'Queue')).toBe(false)
    expect(ability.can('set-role', 'Room')).toBe(false)
  })
})
