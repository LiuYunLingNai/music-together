import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OFFLINE_GRACE_MS,
  armPlaybackReattach,
  consumePlaybackReattach,
  disarmPlaybackReattach,
} from './playbackContinuity'
import { clearOfflineBuffer, hasOfflineBuffer, holdOfflineBuffer, takeOfflineBufferCopy } from './offlineTrackBuffer'
import { OutgoingFade } from './playbackTransition'

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

it('淡化中暂停或连续切歌时，旧音轨立即且仅释放一次；过期定时器不释放新音轨', () => {
  vi.useFakeTimers()
  const fade = new OutgoingFade<string>()
  const release = vi.fn()
  fade.start('A', 4_000, release)
  vi.advanceTimersByTime(2_000)
  fade.start('B', 4_000, release)
  expect(release.mock.calls).toEqual([['A']])
  vi.advanceTimersByTime(2_000)
  expect(fade.deck).toBe('B')
  fade.finish()
  fade.finish()
  expect(fade.deck).toBeNull()
  vi.advanceTimersByTime(4_000)
  fade.start('C', 80, release)
  vi.advanceTimersByTime(80)
  expect(release.mock.calls).toEqual([['A'], ['B'], ['C']])
})
