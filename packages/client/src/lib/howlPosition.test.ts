import { describe, expect, it, vi } from 'vitest'
import { setHowlPosition } from './howlPosition'

describe('setHowlPosition', () => {
  it('updates a playing HTML5 media element without invoking Howler seek', () => {
    const seek = vi.fn()
    const sound = { _id: 7, _node: { currentTime: 10 }, _seek: 10, _rateSeek: 10 }
    const howl = {
      _sounds: [sound],
      playing: vi.fn(() => true),
      seek,
    }

    setHowlPosition(howl as never, 12.5, 7)

    expect(sound._node.currentTime).toBe(12.5)
    expect(sound._seek).toBe(12.5)
    expect(sound._rateSeek).toBe(12.5)
    expect(seek).not.toHaveBeenCalled()
  })

  it('falls back to the public Howler seek API when playback is paused', () => {
    const seek = vi.fn()
    const howl = { _sounds: [], playing: vi.fn(() => false), seek }

    setHowlPosition(howl as never, 8, 3)

    expect(seek).toHaveBeenCalledWith(8, 3)
  })
})
