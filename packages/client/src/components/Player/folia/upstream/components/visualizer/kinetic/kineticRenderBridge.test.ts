import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const html = fs.readFileSync(new URL('../../../../../../../../public/jizura/render.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]

function createRendererHost() {
  const listeners = new Map<string, Array<(event: { source?: unknown; data?: unknown }) => void>>()
  const frames = new Map<number, () => void>()
  const parent = { postMessage: vi.fn() }
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ({}) }
  const host = { getBoundingClientRect: () => ({ width: 960, height: 540 }), appendChild: vi.fn() }
  let frameId = 0
  const window = {
    parent, innerWidth: 960, innerHeight: 540,
    addEventListener: (type: string, listener: (event: { source?: unknown; data?: unknown }) => void) => {
      listeners.set(type, [...listeners.get(type) ?? [], listener])
    },
    requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  }
  const plan = vi.fn((project: { lyrics: string }) => ({
    W: 960, H: 540, fps: 24, duration: 100, cuts: [], lines: [{ text: project.lyrics }],
  }))
  const frame = vi.fn()
  const document = {
    hidden: false,
    getElementById: () => host,
    createElement: () => canvas,
    addEventListener: window.addEventListener,
  }
  vm.runInNewContext(script, {
    window, document, console: { log: vi.fn(), warn: vi.fn() }, performance: { now: () => 1000 },
    J: {
      Renderer: class { frame = frame },
      defaultProject: () => ({ lyrics: '', fx: {}, timing: {} }), plan,
      LAYOUT_ORDER: ['center', 'stack', 'extra-layout'], LAYOUTS: { center: {}, stack: {}, 'extra-layout': {} },
      parseLyrics: (lyrics: string) => ({ lines: [{ text: lyrics }] }),
    },
  })
  const send = (data: Record<string, unknown>, source: unknown = parent) => {
    listeners.get('message')?.forEach(listener => listener({ source, data: { target: 'jizura-render', ...data } }))
  }
  return { send, frames, parent, plan, frame }
}

describe('shipped JIZURA renderer bridge', () => {
  it('replaces a saved editor plan when native controls change and constrains every layout', () => {
    const host = createRendererHost()
    host.send({ type: 'project', songKey: 'song', project: { lyrics: 'Alpha', sourceLyrics: 'Alpha' } })
    host.send({ type: 'plan', songKey: 'song', sourceLyrics: 'Alpha', plan: { W: 960, H: 540, cuts: [], lines: [{ text: 'Alpha' }] } })
    const before = host.plan.mock.calls.length
    host.send({ type: 'project', songKey: 'song', project: { lyrics: 'Alpha', sourceLyrics: 'Alpha', hostLayout: 'stack' }, resetPlan: true })
    expect(host.plan).toHaveBeenCalledTimes(before + 1)
    expect(host.plan.mock.lastCall?.[0]).toMatchObject({ enabled: { layout: { center: false, stack: true, 'extra-layout': false } } })
  })
  it('stops scheduling frames on pause and resumes only when the host plays', () => {
    const host = createRendererHost()
    host.send({ type: 'project', songKey: 'song-a', project: { lyrics: 'Alpha' }, time: 12, playing: false })
    expect(host.frames.size).toBe(0)
    expect(host.frame).toHaveBeenCalled()
    host.send({ type: 'seek', time: 15, playing: true })
    expect(host.frames.size).toBe(1)
    host.send({ type: 'seek', time: 20, playing: false })
    expect(host.frames.size).toBe(0)
    host.send({ type: 'pause', paused: true })
    host.send({ type: 'seek', time: 25, playing: true })
    expect(host.frames.size).toBe(0)
    host.send({ type: 'pause', paused: false })
    expect(host.frames.size).toBe(1)
  })

  it('accepts only parent messages and drops stale song and source plans', () => {
    const host = createRendererHost()
    host.send({ type: 'project', project: { lyrics: 'untrusted' } }, {})
    expect(host.plan).not.toHaveBeenCalled()
    host.send({ type: 'project', songKey: 'song-b', project: { lyrics: 'Bravo', sourceLyrics: 'Bravo' } })
    const draws = host.frame.mock.calls.length
    const plan = { W: 960, H: 540, cuts: [], lines: [{ text: 'Bravo' }] }
    host.send({ type: 'plan', songKey: 'song-a', sourceLyrics: 'Bravo', plan })
    host.send({ type: 'plan', songKey: 'song-b', sourceLyrics: 'Alpha', plan })
    expect(host.frame).toHaveBeenCalledTimes(draws)
    host.send({ type: 'plan', songKey: 'song-b', sourceLyrics: 'Bravo', plan })
    expect(host.frame).toHaveBeenCalledTimes(draws + 1)
  })
})
