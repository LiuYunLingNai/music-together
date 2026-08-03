import type { LyricPlayerBase } from '@applemusic-like-lyrics/core'
import { describe, expect, it, vi } from 'vitest'
import { lyricPlayerBridge } from './lyricPlayerBridge'

function playerMock() {
  return {
    setCurrentTime: vi.fn(),
    resetScroll: vi.fn(),
    calcLayout: vi.fn(() => Promise.resolve()),
  } as unknown as LyricPlayerBase
}

describe('lyricPlayerBridge', () => {
  it('updates the official AMLL player directly', () => {
    const player = playerMock()
    const detach = lyricPlayerBridge.attach(player)

    lyricPlayerBridge.setCurrentTime(12.345)

    expect(player.setCurrentTime).toHaveBeenCalledWith(12345, false)
    detach()
  })

  it('uses the official seek layout sequence', () => {
    const player = playerMock()
    const detach = lyricPlayerBridge.attach(player)

    lyricPlayerBridge.seek(42)

    expect(player.resetScroll).toHaveBeenCalledOnce()
    expect(player.setCurrentTime).toHaveBeenCalledWith(42000, true)
    expect(player.calcLayout).toHaveBeenCalledWith(true, true)
    detach()
  })
})
