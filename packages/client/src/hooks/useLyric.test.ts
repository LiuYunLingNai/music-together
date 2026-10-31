// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricLine } from '@applemusic-like-lyrics/core'
import type { Track } from '@music-together/shared'
import { parseTTML } from '@applemusic-like-lyrics/lyric'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLyric } from './useLyric'

vi.mock('@applemusic-like-lyrics/lyric', async (importOriginal) => {
  const original = await importOriginal<typeof import('@applemusic-like-lyrics/lyric')>()
  return { ...original, parseTTML: vi.fn() }
})

const lines = (text: string): LyricLine[] => [{
  startTime: 1000, endTime: 2000, translatedLyric: '', romanLyric: '', isBG: false, isDuet: false,
  words: [
    { word: text.slice(0, 2), startTime: 1000, endTime: 1400, romanWord: '', obscene: false },
    { word: text.slice(2), startTime: 1400, endTime: 1900, romanWord: '', obscene: false },
  ],
}]
const native = (text: string) => ({
  lyric: `[00:01.00]${text}`, tlyric: '[00:01.00]translated', romalrc: '[00:01.00]romanized',
  yrc: '', wordByWord: lines(text),
})
const track = (id: string): Track => ({
  id, sourceId: id, lyricId: id, urlId: id, title: id, source: 'netease',
  artist: ['test artist'], album: '', cover: '', duration: 180,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let root: Root
let container: HTMLDivElement
let controls: ReturnType<typeof useLyric>
function Harness() {
  const value = useLyric()
  useEffect(() => { controls = value }, [value])
  return null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  usePlayerStore.getState().reset()
  useSettingsStore.getState().setTtmlEnabled(true)
  useSettingsStore.getState().setTtmlDbUrl('https://example.test/ncm-lyrics/%s.ttml')
  container = document.createElement('div')
  root = createRoot(container)
  act(() => root.render(createElement(Harness)))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.mocked(parseTTML).mockReset()
})

async function completeFetch(id: string) {
  await act(async () => {
    const request = controls.fetchLyric(track(id))
    await vi.advanceTimersByTimeAsync(250)
    await request
  })
}

describe('lyric request publication and cancellation', () => {
  it('publishes complete base lyrics and reuses the final cache without more requests', async () => {
    const fetchMock = vi.fn(async (input: string) => input.includes('.ttml')
      ? new Response('', { status: 404 })
      : Response.json(native('缓存歌词')))
    vi.stubGlobal('fetch', fetchMock)
    await completeFetch('cache-song')
    expect(usePlayerStore.getState().ttmlLines?.[0].words.map((word) => word.word).join('')).toBe('缓存歌词')
    expect(usePlayerStore.getState().lyricLoading).toBe(false)
    const calls = fetchMock.mock.calls.length
    await completeFetch('cache-song')
    expect(fetchMock).toHaveBeenCalledTimes(calls)
  })

  it('publishes native lyrics before slow TTML, then preserves arriving duet structure', async () => {
    const pending = deferred<Response>()
    vi.mocked(parseTTML).mockReturnValue({ lines: lines('对唱歌词').map((line) => ({ ...line, isDuet: true })) } as ReturnType<typeof parseTTML>)
    vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes('.ttml')
      ? pending.promise
      : Response.json(native('对唱歌词'))))
    let request!: Promise<void>
    await act(async () => {
      request = controls.fetchLyric(track('slow-ttml'))
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(usePlayerStore.getState().lyricLoading).toBe(false)
    expect(usePlayerStore.getState().ttmlLines?.[0].isDuet).toBe(false)
    await act(async () => {
      pending.resolve(new Response('<?xml version="1.0"?><tt/>'))
      await request
    })
    expect(usePlayerStore.getState().ttmlLines?.[0].isDuet).toBe(true)
  })

  it('shares one supplement request and publishes word-by-word lyrics over LRC fallback', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes('.ttml')) return new Response('', { status: 404 })
      if (input.includes('lyric-supplement')) return Response.json({ ...native('补充歌词'), source: 'kugou' })
      return Response.json({ lyric: '[00:01.00]补充歌词', tlyric: '', romalrc: '', yrc: '' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await completeFetch('supplement-song')
    expect(fetchMock.mock.calls.filter(([input]) => input.includes('lyric-supplement'))).toHaveLength(1)
    expect(usePlayerStore.getState().ttmlLines?.[0].words).toHaveLength(2)
  })

  it('does not let an earlier pending request overwrite the next song', async () => {
    const pending = deferred<Response>()
    let oldSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('.ttml')) return new Response('', { status: 404 })
      if (input.includes('old-song')) {
        oldSignal = init?.signal ?? undefined
        return pending.promise
      }
      return Response.json(native('最新歌词'))
    }))
    let oldRequest!: Promise<void>
    await act(async () => {
      oldRequest = controls.fetchLyric(track('old-song'))
      await vi.advanceTimersByTimeAsync(0)
    })
    await completeFetch('new-song')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => {
      pending.resolve(Response.json(native('过期歌词')))
      await oldRequest
    })
    expect(usePlayerStore.getState().lyric).toBe('[00:01.00]最新歌词')
  })
})
