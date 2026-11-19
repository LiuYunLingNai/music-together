// @vitest-environment jsdom
import { act, createElement, isValidElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { motionValue } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLIA_MODES } from '../../../registry'
import { FOLIA_MODE_RENDERERS } from '../../../renderers'
import WindowRenderer from './windowRenderer'
import { renderVisualizerMode, WINDOW_VISUALIZER_ENTRIES } from './windowRegistry'
import type { WindowRendererProps } from './windowRenderer'
import { DEFAULT_METAPHOR_TUNING } from './metaphor/types'

const { draw } = vi.hoisted(() => ({ draw: vi.fn<(props: Record<string, unknown>) => null>(() => null) }))
vi.mock('../../../FoliaRenderer', () => ({ FoliaRenderer: draw }))
vi.mock('./windowPanels', () => ({ MODE_SETTINGS_PANELS: {} }))

let root: Root
let container: HTMLDivElement
const band = motionValue(0)
const props: Omit<WindowRendererProps, 'mode'> = {
  currentTime: motionValue(12), currentLineIndex: -1, lines: [],
  theme: { name: 'test', backgroundColor: '#000', primaryColor: '#fff', accentColor: '#fff', secondaryColor: '#aaa', fontStyle: 'sans', animationIntensity: 'normal' },
  audioPower: band, audioBands: { bass: band, lowMid: band, mid: band, vocal: band, treble: band },
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

describe('lyric style preview routing', () => {
  it.each(FOLIA_MODES)('$label uses its own renderer in the sample and live previews and gallery', (entry) => {
    // Both preview sources enter through WindowRenderer; the gallery uses renderVisualizerMode.
    act(() => root.render(createElement(WindowRenderer, { ...props, mode: entry.upstreamId, paused: true })))
    expect(draw.mock.lastCall?.[0]).toMatchObject({ mode: entry.id, paused: true, renderStyleOnly: true })
    expect(draw.mock.lastCall?.[0].currentTime).toBe(props.currentTime)
    expect(draw.mock.lastCall?.[0].lines).toBe(props.lines)
    const picture = renderVisualizerMode(entry.upstreamId, props)
    expect(isValidElement(picture)).toBe(true)
    expect(picture.type).toBe(FOLIA_MODE_RENDERERS[entry.id])
    expect(WINDOW_VISUALIZER_ENTRIES.find(item => item.mode === entry.upstreamId)?.labelFallback).toBe(entry.label)
  })

  it('passes Metaphor settings and drag callbacks to the preview', () => {
    const change = vi.fn()
    const tuning = { ...DEFAULT_METAPHOR_TUNING, cameraMotion: 0.25 }
    act(() => root.render(createElement(WindowRenderer, {
      ...props, mode: 'metaphor', visualizerTunings: { metaphor: tuning }, onVisualizerTuningChange: change,
    })))
    expect(draw.mock.lastCall?.[0]).toMatchObject({ metaphorTuning: tuning, onMetaphorTuningChange: change })
  })
})
