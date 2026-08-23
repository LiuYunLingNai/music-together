import { describe, expect, it, vi } from 'vitest'
import { lyricPlayerBridge } from './lyricPlayerBridge'

describe('lyricPlayerBridge', () => {
  it('applies per-track calibration and preserves immediate seeks by default', () => {
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
    expect(player.calcLayout).toHaveBeenCalledWith(true, true)
    detach()
    lyricPlayerBridge.setOffset(0)
  })

  it('uses the AMLL seeking spring for user-initiated seeks', () => {
    const player = {
      setCurrentTime: vi.fn(),
      resetScroll: vi.fn(),
      calcLayout: vi.fn(),
    }
    const detach = lyricPlayerBridge.attach(player as never)

    lyricPlayerBridge.seek(12.5, 'smooth')

    expect(player.resetScroll).toHaveBeenCalledOnce()
    expect(player.setCurrentTime).toHaveBeenCalledWith(12_500, true)
    expect(player.calcLayout).toHaveBeenCalledWith(false, false)
    detach()
    lyricPlayerBridge.setOffset(0)
  })
})
