import { afterEach, describe, expect, it, vi } from 'vitest'
import { playbackSyncAdjustment } from './playback-sync'
import { DesktopAudioPlayer } from '../services/audio-player'

describe('playback sync correction', () => {
  it('keeps tempo changes inside the one-percent correction window', () => {
    expect(playbackSyncAdjustment(0.2, true, false)).toEqual({ playbackRate: 0.99, shouldSeek: false })
    expect(playbackSyncAdjustment(-0.2, true, false)).toEqual({ playbackRate: 1.01, shouldSeek: false })
  })

  it('respects the independent hard seek switch even when tempo correction is enabled', () => {
    expect(playbackSyncAdjustment(1, true, false)).toEqual({ playbackRate: 1, shouldSeek: false })
    expect(playbackSyncAdjustment(-1, true, false)).toEqual({ playbackRate: 1, shouldSeek: false })
    expect(playbackSyncAdjustment(-1, true, true)).toEqual({ playbackRate: 1, shouldSeek: true })
    expect(playbackSyncAdjustment(1, false, true)).toEqual({ playbackRate: 1, shouldSeek: true })
    expect(playbackSyncAdjustment(1, false, false)).toEqual({ playbackRate: 1, shouldSeek: false })
  })

  it('returns native speed inside the dead zone', () => {
    expect(playbackSyncAdjustment(0.02, true, true)).toEqual({ playbackRate: 1, shouldSeek: false })
  })
})

describe('scheduled audio execution', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  function setup() {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    class AudioMock extends EventTarget {
      currentTime = 0
      duration = 100
      readyState = 1
      buffered = { length: 0 }
      play = vi.fn(async () => {})
      pause = vi.fn()
      load = vi.fn()
    }
    const media = new AudioMock()
    vi.stubGlobal('Audio', class { constructor() { return media } })
    const player = new DesktopAudioPlayer({ onTime: vi.fn(), onPlaying: vi.fn(), onError: vi.fn(), onEnded: vi.fn() })
    const track = { streamUrl: 'https://example.test/music.mp3', source: 'netease' } as Parameters<DesktopAudioPlayer['load']>[0]
    player.load(track, '', '', 0, true, 1_500, () => Math.max(0, (Date.now() - 1_500) / 1_000))
    return { media, player }
  }

  it('waits for the execution time even when metadata arrives early', async () => {
    const { media } = setup()
    media.dispatchEvent(new Event('loadedmetadata'))
    await vi.advanceTimersByTimeAsync(499)
    expect(media.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(media.play).toHaveBeenCalledTimes(1)
  })

  it('recalculates the position when media loads late', async () => {
    const { media } = setup()
    await vi.advanceTimersByTimeAsync(1_500)
    media.dispatchEvent(new Event('loadedmetadata'))
    await vi.advanceTimersByTimeAsync(0)
    expect(media.currentTime).toBe(1)
    expect(media.play).toHaveBeenCalledTimes(1)
  })

  it('does not resume after a pending start is cancelled', async () => {
    const { media, player } = setup()
    media.dispatchEvent(new Event('loadedmetadata'))
    player.pause()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(media.play).not.toHaveBeenCalled()
  })
})
