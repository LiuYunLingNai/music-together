// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { motionValue } from 'motion/react'
import { AbilityContext } from '@/providers/ability-context'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useKineticTransport } from './useKineticTransport'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  usePlayerStore.getState().reset()
  useSettingsStore.setState({ lyricOffsets: {} })
})

describe('JIZURA host transport', () => {
  it('uses room permissions, ignores invalid seeks and removes listeners on unmount', () => {
    const time = motionValue(12)
    const play = vi.fn(), pause = vi.fn(), seek = vi.fn(), vote = vi.fn()
    let controls = false
    const ability = { can: (action: string) => action === 'vote' || controls }
    const host = document.createElement('div')
    const root = createRoot(host)
    function Test() { useKineticTransport(time, play, pause, seek, vote); return null }
    usePlayerStore.setState({ duration: 100, isPlaying: false, currentTrack: { id: 'test', title: 'test', artist: [], album: '', cover: '', duration: 100, source: 'netease', sourceId: '1', urlId: '1' } })
    act(() => root.render(createElement(AbilityContext.Provider, { value: ability as never }, createElement(Test))))
    act(() => window.dispatchEvent(new CustomEvent('kinetic:toggle-play', { detail: { playing: true } })))
    expect(vote).toHaveBeenCalledWith('resume')
    expect(play).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(new CustomEvent('kinetic:seek', { detail: { time: 20 } })))
    expect(seek).not.toHaveBeenCalled()
    controls = true
    act(() => window.dispatchEvent(new CustomEvent('kinetic:seek', { detail: { time: 200 } })))
    expect(seek).toHaveBeenCalledWith(100)
    act(() => window.dispatchEvent(new CustomEvent('kinetic:seek', { detail: { time: NaN } })))
    expect(seek).toHaveBeenCalledTimes(1)
    act(() => window.dispatchEvent(new CustomEvent('kinetic:toggle-play', { detail: { playing: true } })))
    expect(play).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    window.dispatchEvent(new CustomEvent('kinetic:toggle-play', { detail: { playing: true } }))
    expect(play).toHaveBeenCalledTimes(1)
    host.remove()
  })

  it('converts lyric time to media time using the saved offset and live calibration preview', () => {
    const time = motionValue(12)
    const seek = vi.fn()
    const host = document.createElement('div')
    const root = createRoot(host)
    const ability = { can: () => true }
    function Test() { useKineticTransport(time, vi.fn(), vi.fn(), seek, vi.fn()); return null }
    usePlayerStore.setState({ duration: 100, currentTrack: { id: 'queue-id', title: 'test', artist: [], album: '', cover: '', duration: 100, source: 'netease', sourceId: '1', urlId: '1', lyricId: '1' } })
    useSettingsStore.setState({ lyricOffsets: { 'netease:1': 1500 } })
    act(() => root.render(createElement(AbilityContext.Provider, { value: ability as never }, createElement(Test))))
    act(() => window.dispatchEvent(new CustomEvent('kinetic:seek', { detail: { time: 20 } })))
    expect(seek).toHaveBeenLastCalledWith(21.5)
    act(() => usePlayerStore.setState({ lyricOffsetPreview: { key: 'netease:1', offsetMs: -500 } }))
    act(() => window.dispatchEvent(new CustomEvent('kinetic:seek', { detail: { time: 20 } })))
    expect(seek).toHaveBeenLastCalledWith(19.5)
    act(() => root.unmount())
  })
})
