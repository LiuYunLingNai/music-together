// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { motionValue } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VisualizerKinetic from './VisualizerKinetic'
import type { VisualizerSharedProps } from '../definition'
import { DEFAULT_KINETIC_TUNING } from './kineticSettings'
import { readKineticProject } from './kineticProjectMemory'

vi.mock('../VisualizerShell', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../VisualizerSubtitleOverlay', () => ({ default: () => null }))
vi.mock('../runtime', () => ({ useVisualizerRuntime: () => ({ activeLine: null, recentCompletedLine: null, nextLines: [] }) }))
vi.mock('../../../adapters/kineticPlayback', () => ({
  usePlaybackStore: () => null,
  getPlaybackSongKey: () => null,
}))
vi.mock('../../../adapters/hostStores', () => ({ useVisualizerSettingsStore: () => 30 }))
vi.mock('./kineticProjectMemory', () => ({ readKineticProject: vi.fn(() => null) }))
vi.mock('./kineticFontBridge', () => ({ pickConcreteFontFamily: () => '', resolveKineticFontPayload: async () => null }))

let root: Root
let container: HTMLDivElement
function createProps(currentTime = motionValue(12)): VisualizerSharedProps {
  const band = motionValue(0)
  return {
    currentTime, currentLineIndex: -1, lines: [], paused: true,
    theme: { name: 'test', backgroundColor: '#000', primaryColor: '#fff', accentColor: '#fff', secondaryColor: '#aaa', fontStyle: 'sans', animationIntensity: 'normal' },
    audioPower: band, audioBands: { bass: band, lowMid: band, mid: band, vocal: band, treble: band },
  }
}
beforeEach(() => {
  vi.mocked(readKineticProject).mockReturnValue(null)
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('kinetic renderer handshake', () => {
  it('uses global settings regardless of song projects, restores song mode and displays unsaved song drafts', () => {
    const plan = { W: 1024, H: 768, cuts: [], lines: [] }
    vi.mocked(readKineticProject).mockReturnValue({ style: 'paper', sourceLyrics: '', lyrics: '', plan })
    const props = { ...createProps(), kineticTuning: { ...DEFAULT_KINETIC_TUNING, style: 'mint' } }
    act(() => root.render(createElement(VisualizerKinetic, props)))
    const frame = container.querySelector('iframe')!
    const target = frame.contentWindow!
    const post = vi.spyOn(target, 'postMessage')
    act(() => frame.dispatchEvent(new Event('load')))
    act(() => window.dispatchEvent(new MessageEvent('message', { source: target, data: { source: 'jizura-render', type: 'ready' } })))
    const project = () => post.mock.calls.filter(call => call[0].type === 'project').at(-1)?.[0]
    expect(project()).toMatchObject({ project: { style: 'mint' }, resetPlan: true })
    act(() => root.render(createElement(VisualizerKinetic, { ...props, kineticTuning: { ...props.kineticTuning, scope: 'song' } })))
    expect(project()).toMatchObject({ project: { style: 'paper' }, resetPlan: false })
    const draft = { ...props.kineticTuning, scope: 'song' as const, previewDraft: true, style: 'gold' }
    act(() => root.render(createElement(VisualizerKinetic, { ...props, kineticTuning: draft, isPreviewMode: true })))
    expect(project()).toMatchObject({ project: { style: 'gold' }, resetPlan: true })
    act(() => root.render(createElement(VisualizerKinetic, { ...props, kineticTuning: { ...props.kineticTuning, scope: 'song' } })))
    expect(project()).toMatchObject({ project: { style: 'paper' }, resetPlan: false })
    expect(post.mock.calls.filter(call => call[0].type === 'plan')).toHaveLength(2)
  })
  it('pushes native control changes and ignores a real song project in a sample preview', () => {
    vi.mocked(readKineticProject).mockReturnValue({ style: 'paper', sourceLyrics: '[00:01.00]Real song', lyrics: '[00:01.00]Edited real song' })
    const props = { ...createProps(), isPreviewMode: true, kineticTuning: DEFAULT_KINETIC_TUNING }
    act(() => root.render(createElement(VisualizerKinetic, props)))
    const frame = container.querySelector('iframe')!
    const target = frame.contentWindow!
    const post = vi.spyOn(target, 'postMessage')
    act(() => frame.dispatchEvent(new Event('load')))
    act(() => window.dispatchEvent(new MessageEvent('message', { source: target, data: { source: 'jizura-render', type: 'ready' } })))
    expect(post.mock.calls.find(call => call[0].type === 'project')?.[0]).toMatchObject({ resetPlan: true, project: { style: 'noir', lyrics: '' } })
    post.mockClear()
    act(() => root.render(createElement(VisualizerKinetic, { ...props, kineticTuning: { ...DEFAULT_KINETIC_TUNING, style: 'mint', motion: 0.2, scope: 'global' } })))
    expect(post.mock.calls.find(call => call[0].type === 'project')?.[0]).toMatchObject({ resetPlan: true, project: { style: 'mint', fx: { motion: 0.2 } } })
    vi.mocked(readKineticProject).mockReturnValue(null)
  })
  it('retries until ready, avoids a ready/replan loop, and releases retries on unmount', () => {
    const props = createProps()
    act(() => root.render(createElement(VisualizerKinetic, props)))
    const frame = container.querySelector('iframe')!
    const target = frame.contentWindow!
    const post = vi.spyOn(target, 'postMessage')
    act(() => frame.dispatchEvent(new Event('load')))
    const projects = () => post.mock.calls.filter(call => call[0].type === 'project')
    expect(projects()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(650))
    expect(projects()).toHaveLength(3)
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: target, data: { source: 'jizura-render', type: 'ready' },
    })))
    expect(projects()).toHaveLength(3)
    act(() => vi.advanceTimersByTime(600))
    expect(projects()).toHaveLength(3)
    act(() => frame.dispatchEvent(new Event('load')))
    act(() => root.unmount())
    const sent = post.mock.calls.length
    act(() => vi.advanceTimersByTime(9000))
    expect(post).toHaveBeenCalledTimes(sent)
    root = createRoot(container)
  })

  it('keeps static mode from rendering every tick while allowing explicit seek jumps', () => {
    const time = motionValue(12)
    const props = { ...createProps(time), paused: false, staticMode: true }
    act(() => root.render(createElement(VisualizerKinetic, props)))
    const target = container.querySelector('iframe')!.contentWindow!
    const post = vi.spyOn(target, 'postMessage')
    act(() => time.set(12.05))
    act(() => time.set(12.1))
    expect(post).not.toHaveBeenCalled()
    act(() => time.set(20))
    expect(post).toHaveBeenCalledWith({ target: 'jizura-render', type: 'seek', time: 20, playing: false }, '*')
    post.mockClear()
    act(() => window.dispatchEvent(new Event('kinetic:editor-closed')))
    expect(post).toHaveBeenCalledWith({ target: 'jizura-render', type: 'seek', time: 20, playing: false }, '*')
  })
})
