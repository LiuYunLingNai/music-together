import { afterEach, describe, expect, it, vi } from 'vitest'
import { canReuseCalibration, getClockOffset, processPong, recordPing, resetClockSync, suspendClockSync } from './clockSync'

function exchange(rttMs: number, serverOffsetMs: number, asymmetryMs = 0) {
  const id = recordPing()
  vi.advanceTimersByTime(rttMs)
  processPong(id, Date.now() + serverOffsetMs - rttMs / 2 + asymmetryMs)
}

afterEach(() => {
  vi.useRealTimers()
  resetClockSync()
})

describe('clockSync', () => {
  it('弱网恢复后的高延迟样本不会拉偏已校准的偏移', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 20; i++) exchange(40, 1_000)
    expect(Math.abs(getClockOffset() - 1_000)).toBeLessThan(5)

    suspendClockSync()
    for (let i = 0; i < 6; i++) exchange(900, 1_000, 400)
    expect(Math.abs(getClockOffset() - 1_000)).toBeLessThan(5)
  })

  it('断线只清未完成的探测，已校准状态保留以供重连沿用', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 20; i++) exchange(40, 500)
    suspendClockSync()
    expect(canReuseCalibration()).toBe(true)
    vi.advanceTimersByTime(4 * 60_000)
    expect(canReuseCalibration()).toBe(false)
  })
})
