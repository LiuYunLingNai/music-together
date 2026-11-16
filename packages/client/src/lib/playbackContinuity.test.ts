import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OFFLINE_GRACE_MS,
  armPlaybackReattach,
  consumePlaybackReattach,
  disarmPlaybackReattach,
} from './playbackContinuity'
import { clearOfflineBuffer, hasOfflineBuffer, holdOfflineBuffer, takeOfflineBufferCopy } from './offlineTrackBuffer'

afterEach(() => {
  vi.useRealTimers()
  disarmPlaybackReattach()
  clearOfflineBuffer()
})

describe('断线后的播放接回标记', () => {
  it('只在断线后的第一次回放上有效', () => {
    armPlaybackReattach()
    expect(consumePlaybackReattach()).toBe(true)
    expect(consumePlaybackReattach()).toBe(false)
  })

  it('没有断线标记时不生效', () => {
    expect(consumePlaybackReattach()).toBe(false)
  })

  it('超过宽限期加握手窗口后失效', () => {
    vi.useFakeTimers()
    armPlaybackReattach()
    vi.advanceTimersByTime(OFFLINE_GRACE_MS + 31_000)
    expect(consumePlaybackReattach()).toBe(false)
  })

  it('主动撤销后不生效', () => {
    armPlaybackReattach()
    disarmPlaybackReattach()
    expect(consumePlaybackReattach()).toBe(false)
  })
})

describe('断网保护的整曲缓冲', () => {
  it('只认当前曲目，并且返回副本', () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    holdOfflineBuffer('a', bytes)
    expect(hasOfflineBuffer('a')).toBe(true)
    expect(hasOfflineBuffer('b')).toBe(false)
    expect(takeOfflineBufferCopy('b')).toBeNull()
    const copy = takeOfflineBufferCopy('a')
    expect(copy).not.toBe(bytes)
    expect(new Uint8Array(copy!)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('换歌时被替换，清空后不再命中', () => {
    holdOfflineBuffer('a', new ArrayBuffer(4))
    holdOfflineBuffer('b', new ArrayBuffer(4))
    expect(hasOfflineBuffer('a')).toBe(false)
    clearOfflineBuffer()
    expect(hasOfflineBuffer('b')).toBe(false)
  })
})
