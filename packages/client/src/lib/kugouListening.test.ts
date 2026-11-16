import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Howl } from 'howler'
import type { KugouListeningReport } from '@music-together/shared'
import { createKugouListeningTracker, ListeningClock } from './kugouListening'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Kugou real listening clock', () => {
  it('counts continuous progress and caps it at wall time', () => {
    const clock = new ListeningClock()
    clock.sample(10, true, 0)
    clock.sample(11, true, 1000)
    clock.sample(12.01, true, 2000)
    expect(clock.totalMs).toBe(2000)
  })

  it('excludes pauses, buffering and forward/backward seeks', () => {
    const clock = new ListeningClock()
    clock.sample(0, true, 0)
    clock.sample(1, true, 1000)
    clock.sample(1, true, 2000) // buffering
    clock.sample(1, false, 3000)
    clock.sample(1, true, 4000)
    clock.sample(90, true, 5000)
    clock.sample(10, true, 6000)
    expect(clock.totalMs).toBe(1000)
    clock.reset() // native seeking/seeked events also exclude small seeks
    clock.sample(11, true, 7000)
    expect(clock.totalMs).toBe(1000)
  })

  it('does not backfill suspended pages or non-finite positions', () => {
    const clock = new ListeningClock()
    clock.sample(0, true, 0)
    clock.sample(60, true, 60_000)
    clock.sample(NaN, true, 61_000)
    clock.sample(62, true, 62_000)
    expect(clock.totalMs).toBe(0)
    clock.sample(63, true, 63_000)
    expect(clock.totalMs).toBe(1000)
  })
})

describe('Kugou tracker lifecycle', () => {
  function setup(status = 'accepted') {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const page = new EventTarget()
    vi.stubGlobal('window', page)
    const media = Object.assign(new EventTarget(), { readyState: 3, seeking: false })
    let position = 0
    let playing = true
    const howl = { playing: () => playing, seek: () => position, _sounds: [{ _node: media }] } as unknown as Howl
    const reports: KugouListeningReport[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        reports.push(JSON.parse(String(init.body)))
        return Response.json({ status })
      }),
    )
    const tracker = createKugouListeningTracker('room', 'track', () => howl)
    const tick = async (advance = true) => {
      if (advance) position++
      await vi.advanceTimersByTimeAsync(1000)
    }
    return {
      tracker,
      reports,
      page,
      media,
      tick,
      pause: () => {
        playing = false
      },
      resume: () => {
        playing = true
      },
    }
  }

  it('orders start/sample/pause/end, excludes paused time and closes exactly once on pagehide', async () => {
    const h = setup()
    h.tracker.play()
    for (let i = 0; i < 15; i++) await h.tick()
    expect(h.reports.map((report) => report.listenedMs)).toEqual([0, 15_000])
    h.pause()
    h.tracker.pause()
    await h.tick(false)
    expect(h.reports.at(-1)?.flush).toBe(true)
    for (let i = 0; i < 3; i++) await h.tick(false)
    h.resume()
    h.tracker.play()
    await h.tick()
    h.page.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.reports.at(-1)).toMatchObject({ ended: true, listenedMs: 16_000 })
    const count = h.reports.length
    h.tracker.dispose()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.reports).toHaveLength(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resets on native seeking and stops reporting without a personal login', async () => {
    const h = setup('not_logged_in')
    h.tracker.play()
    await h.tick()
    h.media.dispatchEvent(new Event('seeking'))
    await h.tick()
    h.tracker.dispose()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.reports).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('supports HTTP LAN contexts and excludes native seek transitions', async () => {
    const h = setup()
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) })
    const tracker = createKugouListeningTracker(
      'room',
      'track',
      () =>
        ({
          playing: () => true,
          seek: () => performance.now() / 1000,
          _sounds: [{ _node: h.media }],
        }) as unknown as Howl,
    )
    tracker.play()
    await h.tick()
    h.media.dispatchEvent(new Event('seeking'))
    await h.tick()
    h.media.dispatchEvent(new Event('seeked'))
    await h.tick()
    await h.tick()
    tracker.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.reports[0].sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(h.reports.at(-1)?.listenedMs).toBe(2000)
  })
})
