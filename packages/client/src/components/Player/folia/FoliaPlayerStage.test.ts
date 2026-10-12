// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { motionValue } from 'motion/react'
import { usePlayerStore } from '@/stores/playerStore'
import { FoliaPlayerStage } from './FoliaPlayerStage'

vi.mock('./stage/foliaAudio', () => ({ useFoliaAudio: () => ({}) }))
vi.mock('./stage/foliaRenderState', () => ({ useFoliaRenderState: () => ({ paused: false, staticMode: false }) }))
vi.mock('./stage/foliaClock', () => ({ useFoliaClock: () => ({ currentTime: motionValue(0) }) }))
vi.mock('./stage/lyricAdapter', async (importOriginal) => {
  const original = await importOriginal<typeof import('./stage/lyricAdapter')>()
  return {
    ...original,
    useFoliaTheme: () => ({
      name: 'test',
      primaryColor: '#fff',
      accentColor: '#fff',
      secondaryColor: '#fff',
      backgroundColor: '#000',
      fontStyle: 'sans',
      animationIntensity: 'normal',
    }),
  }
})
vi.mock('./renderers', async () => ({
  FOLIA_MODE_RENDERERS: {
    still: (await import('./modes/still/VisualizerStill')).VisualizerStill,
    luminous: ({
      showText,
      showWaitingPlaceholder,
      currentLineIndex,
      lines,
    }: {
      showText: boolean
      showWaitingPlaceholder: boolean
      currentLineIndex: number
      lines: { fullText: string }[]
    }) =>
      createElement(
        'div',
        {
          'data-testid': 'lyric-mode',
          'data-text-enabled': String(showText),
          'data-line-index': currentLineIndex,
        },
        createElement('span', { 'data-testid': 'scene-effect' }),
        showText && lines[currentLineIndex] ? '歌词画面' : showWaitingPlaceholder ? '等待音乐' : '',
      ),
  },
}))
vi.mock('./backgrounds/FoliaBackground', () => ({
  FoliaBackground: () => createElement('div', { 'data-testid': 'background' }),
}))
vi.mock('./FoliaControlBar', () => ({ FoliaControlBar: () => createElement('div', { 'data-testid': 'controls' }) }))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  usePlayerStore.getState().reset()
  usePlayerStore.getState().setCurrentTrack({
    id: 'track',
    title: '歌曲标题',
    artist: ['歌手'],
    album: '专辑',
    cover: 'https://example.com/cover.jpg',
    duration: 30,
    source: 'netease',
    sourceId: '1',
    urlId: '1',
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function mount(mode: 'luminous' | 'still' = 'luminous') {
  const callback = vi.fn()
  act(() =>
    root.render(
      createElement(FoliaPlayerStage, {
        mode,
        onPlay: callback,
        onPause: callback,
        onSeek: callback,
        onLyricSeek: callback,
        onNext: callback,
        onPrev: callback,
        onOpenChat: callback,
        onOpenQueue: callback,
        chatUnreadCount: 0,
        activeVote: null,
        onCastVote: callback,
        onStartVote: callback,
      }),
    ),
  )
}
describe('Folia 无歌词画面', () => {
  it('没有歌词或歌词加载中只保留背景和播放控制，不展示替代文案或封面', () => {
    usePlayerStore.getState().setLyricLoading(true)
    mount()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-testid="background"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="controls"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="lyric-mode"]')?.textContent).toBe('')
    expect(container.querySelector('[data-testid="scene-effect"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="lyric-mode"]')?.getAttribute('data-text-enabled')).toBe('true')
  })
  it('歌词到达后保留退场时窗、间奏与结束后的模式特效，不改播放状态', () => {
    mount()
    const lyricLine = (word: string, startTime: number, endTime: number) => ({
      words: [{ word, startTime, endTime, romanWord: '', obscene: false }],
      startTime,
      endTime,
      translatedLyric: '',
      romanLyric: '',
      isBG: false,
      isDuet: false,
    })
    act(() => {
      usePlayerStore.getState().setTtmlLines([lyricLine('第一句', 1000, 3000), lyricLine('第二句', 5000, 7000)])
      usePlayerStore.getState().setCurrentTime(2)
      usePlayerStore.getState().setIsPlaying(true)
    })
    expect(container.textContent).toContain('歌词画面')
    const effect = container.querySelector('[data-testid="scene-effect"]')
    act(() => usePlayerStore.getState().setCurrentTime(3.05))
    expect(container.querySelector('[data-testid="lyric-mode"]')?.getAttribute('data-line-index')).toBe('0')
    act(() => usePlayerStore.getState().setCurrentTime(4))
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-testid="scene-effect"]')).toBe(effect)
    expect(container.querySelector('[data-testid="lyric-mode"]')?.getAttribute('data-text-enabled')).toBe('true')
    act(() => usePlayerStore.getState().setCurrentTime(6))
    expect(container.textContent).toContain('歌词画面')
    act(() => usePlayerStore.getState().setCurrentTime(11))
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-testid="scene-effect"]')).toBe(effect)
    expect(usePlayerStore.getState().currentTime).toBe(11)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })
  it('只有间奏标记的歌词不展示等待提示或封面', () => {
    usePlayerStore.getState().setLyric('[00:00.00]......\n[00:10.00]●●●')
    usePlayerStore.getState().setCurrentTime(2)
    mount()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-testid="scene-effect"]')).not.toBeNull()
  })
  it('静止模式在两句之间保留上一句，而不是被宿主关闭', () => {
    usePlayerStore.getState().setTtmlLines([
      {
        words: [{ word: '第一句', startTime: 1000, endTime: 3000, romanWord: '', obscene: false }],
        startTime: 1000,
        endTime: 3000,
        translatedLyric: 'first',
        romanLyric: '',
        isBG: false,
        isDuet: false,
      },
      {
        words: [{ word: '第二句', startTime: 5000, endTime: 7000, romanWord: '', obscene: false }],
        startTime: 5000,
        endTime: 7000,
        translatedLyric: 'second',
        romanLyric: '',
        isBG: false,
        isDuet: false,
      },
    ])
    usePlayerStore.getState().setCurrentTime(2)
    mount('still')
    const stage = container.querySelector('.folia-still')
    expect(stage?.textContent).toContain('第一句')
    act(() => usePlayerStore.getState().setCurrentTime(4))
    expect(container.querySelector('.folia-still')).toBe(stage)
    expect(stage?.textContent).toContain('第一句')
    expect(stage?.textContent).toContain('first')
    expect(stage?.textContent).not.toContain('等待')
    act(() => usePlayerStore.getState().setCurrentTime(6))
    expect(stage?.textContent).toContain('第二句')
  })
})
