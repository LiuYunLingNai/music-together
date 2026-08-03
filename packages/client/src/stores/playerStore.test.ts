import { beforeEach, describe, expect, it } from 'vitest'
import { usePlayerStore } from './playerStore'

describe('playerStore playback time', () => {
  beforeEach(() => usePlayerStore.getState().reset())

  it('stores the lower-frequency UI playback position', () => {
    usePlayerStore.getState().setCurrentTime(42)

    expect(usePlayerStore.getState().currentTime).toBe(42)
  })
})
