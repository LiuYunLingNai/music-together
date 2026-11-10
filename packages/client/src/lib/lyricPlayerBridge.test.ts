// @vitest-environment jsdom
import { LayoutReason } from '@applemusic-like-lyrics/core'
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
    expect(player.calcLayout).toHaveBeenCalledWith(LayoutReason.Seek)
    detach()
    lyricPlayerBridge.setOffset(0)
  })

  it('keeps an optimistic lyric seek until the server confirmation arrives', () => {
    const player = {
      setCurrentTime: vi.fn(),
      resetScroll: vi.fn(),
      calcLayout: vi.fn(),
    }
    const detach = lyricPlayerBridge.attach(player as never)

    lyricPlayerBridge.seekOptimistic(20)
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(20_000, true)

    // 服务端 seek 还没回来时，逐帧旧时间不能把歌词拉回去。
    lyricPlayerBridge.setCurrentTime(3)
    expect(player.setCurrentTime).toHaveBeenCalledTimes(1)

    // 服务端确认后恢复逐帧驱动。
    lyricPlayerBridge.seek(20)
    lyricPlayerBridge.setCurrentTime(21)
    expect(player.setCurrentTime).toHaveBeenLastCalledWith(21_000, false)
    detach()
    lyricPlayerBridge.setOffset(0)
  })

  it('resets the interlude dots for user-initiated seeks too', () => {
    const player = {
      setCurrentTime: vi.fn(),
      resetScroll: vi.fn(),
      calcLayout: vi.fn(),
    }
    const detach = lyricPlayerBridge.attach(player as never)

    lyricPlayerBridge.seek(12.5)

    expect(player.resetScroll).toHaveBeenCalledOnce()
    expect(player.setCurrentTime).toHaveBeenCalledWith(12_500, true)
    // 上游 Seek 策略带 resetInterlude；PlaybackTick 不会卸载「…」。
    expect(player.calcLayout).toHaveBeenCalledWith(LayoutReason.Seek)
    detach()
    lyricPlayerBridge.setOffset(0)
  })
})
