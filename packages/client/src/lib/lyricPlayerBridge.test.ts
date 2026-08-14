import { describe, expect, it, vi } from 'vitest'
import { lyricPlayerBridge } from './lyricPlayerBridge'

describe('lyricPlayerBridge', () => {
  it('applies per-track calibration to frame updates and seeks', () => {
    const player = {
      setCurrentTime: vi.fn(),
      resetScroll: vi.fn(),
      calcLayout: vi.fn(),
    }
    const detach = lyricPlayerBridge.attach(player as never)
    lyricPlayerBridge.setOffset(250)

    lyricPlayerBridge.setCurrentTime(2)
    lyricPlayerBridge.seek(3)

    expect(player.setCurrentTime).toHaveBeenNthCalledWith(1, 1750, false)
    expect(player.setCurrentTime).toHaveBeenNthCalledWith(2, 2750, true)
    expect(player.resetScroll).toHaveBeenCalledOnce()
    detach()
    lyricPlayerBridge.setOffset(0)
  })
})
