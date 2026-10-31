// @vitest-environment jsdom
import { act, createElement, useEffect, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { motionValue } from 'motion/react'
import { usePlayerStore } from '@/stores/playerStore'
import { FoliaPlayerStage } from './FoliaPlayerStage'
import { useSettingsStore } from '@/stores/settingsStore'
import type { FoliaSharedProps } from './definition'
import { useVisualizerRuntime } from './upstream/components/visualizer/runtime'
import { getLineRenderEndTime } from './upstream/utils/lyrics/renderHints'

const modeRendered = vi.hoisted(() => vi.fn())

vi.mock('./stage/foliaAudio', () => ({ useFoliaAudio: () => ({}) }))
vi.mock('./stage/foliaRenderState', () => ({ useFoliaRenderState: () => ({ paused: false, staticMode: false }) }))
vi.mock('./stage/foliaClock', () => ({
  useFoliaClock: (offsetMs: number) => {
    const currentTime = useMemo(() => motionValue(0), [])
    useEffect(() => {
      const update = () => currentTime.set(Math.max(0, usePlayerStore.getState().currentTime - offsetMs / 1000))
      update()
      return usePlayerStore.subscribe(update)
    }, [currentTime, offsetMs])
    return { currentTime }
  },
}))
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
    still: (await import('./upstream/components/visualizer/still/VisualizerStill')).default,
    luminous: function TestLyricMode(props: FoliaSharedProps) {
      modeRendered(props)
      const { showText, currentLineIndex, lines } = props
      const { recentCompletedLine, upcomingLine } = useVisualizerRuntime({
        currentTime: props.currentTime, currentLineIndex, lines, getLineEndTime: getLineRenderEndTime,
      })
      return createElement(
        'div',
        {
          'data-testid': 'lyric-mode',
          'data-text-enabled': String(showText),
          'data-line-index': currentLineIndex,
          'data-recent-line': recentCompletedLine?.fullText ?? '',
          'data-upcoming-line': upcomingLine?.fullText ?? '',
        },
        createElement('span', { 'data-testid': 'scene-effect' }),
        // 上游 `ui.waitingForMusic` 是空串，没有歌词时这一行什么都不渲染。
        showText && lines[currentLineIndex] ? '歌词画面' : '',
      )
    },
  },
}))
// 背景层由上游 `VisualizerBackgroundRenderer` 绘制（默认 latent 背景会拉起 Paper shader，
// jsdom 里没有 WebGL）。这里只验证舞台结构里有背景层，替身即可。
vi.mock('./upstream/components/visualizer/backgrounds/VisualizerBackgroundRenderer', () => ({
  default: () => createElement('div', { 'data-testid': 'background' }),
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
  modeRendered.mockClear()
  useSettingsStore.getState().resetFoliaSettings()
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
    lyricId: '1',
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
describe('Folia 离散进度订阅', () => {
  it('在激活下标同为 -1 的间隙之间 seek 时更新前后字幕', () => {
    usePlayerStore.getState().setTtmlLines([1, 4, 7].map((start, index) => ({
      words: [{ word: `第${index + 1}句`, startTime: start * 1000, endTime: (start + 1) * 1000, romanWord: '', obscene: false }],
      startTime: start * 1000, endTime: (start + 1) * 1000,
      translatedLyric: '', romanLyric: '', isBG: false, isDuet: false,
    })))
    usePlayerStore.getState().setCurrentTime(1.5)
    mount()
    const mode = () => container.querySelector('[data-testid="lyric-mode"]')!
    act(() => usePlayerStore.getState().setCurrentTime(3))
    expect(mode().getAttribute('data-line-index')).toBe('-1')
    expect(mode().getAttribute('data-recent-line')).toBe('第1句')
    expect(mode().getAttribute('data-upcoming-line')).toBe('第2句')
    const renders = modeRendered.mock.calls.length
    act(() => usePlayerStore.getState().setCurrentTime(3.1))
    expect(modeRendered).toHaveBeenCalledTimes(renders)
    act(() => usePlayerStore.getState().setCurrentTime(6))
    expect(mode().getAttribute('data-line-index')).toBe('-1')
    expect(mode().getAttribute('data-recent-line')).toBe('第2句')
    expect(mode().getAttribute('data-upcoming-line')).toBe('第3句')
    act(() => usePlayerStore.getState().setCurrentTime(3))
    expect(mode().getAttribute('data-recent-line')).toBe('第1句')
  })

  it('进度不变时仍响应歌词校准预览与歌词替换', () => {
    usePlayerStore.getState().setLyric('[00:01.00]第一句\n[00:05.00]第二句\n[00:09.00]第三句')
    usePlayerStore.getState().setCurrentTime(6)
    mount()
    const props = () => modeRendered.mock.lastCall![0] as FoliaSharedProps
    const secondIndex = props().currentLineIndex
    act(() => usePlayerStore.getState().setLyricOffsetPreview({ key: 'netease:1', offsetMs: 4000 }))
    expect(props().currentLineIndex).not.toBe(secondIndex)
    act(() => usePlayerStore.getState().setLyricOffsetPreview(null))
    expect(props().currentLineIndex).toBe(secondIndex)
    act(() => usePlayerStore.getState().setLyric('[00:01.00]整首一行歌词'))
    expect(props().lines[props().currentLineIndex]?.fullText).toBe('整首一行歌词')
  })

  it('同行进度不重渲染，切行和反向 seek 保留调参及背景引用', () => {
    usePlayerStore.getState().setLyric('[00:01.00]第一句\n[00:05.00]第二句\n[00:09.00]第三句')
    usePlayerStore.getState().setCurrentTime(2)
    mount()
    const props = () => modeRendered.mock.lastCall![0] as FoliaSharedProps
    const initial = props()
    const renders = modeRendered.mock.calls.length
    for (const time of [2.1, 2.2, 2.3]) act(() => usePlayerStore.getState().setCurrentTime(time))
    expect(modeRendered).toHaveBeenCalledTimes(renders)
    act(() => usePlayerStore.getState().setCurrentTime(6))
    expect(props().currentLineIndex).not.toBe(initial.currentLineIndex)
    expect(props().classicTuning).toBe(initial.classicTuning)
    expect(props().background).toBe(initial.background)
    act(() => usePlayerStore.getState().setCurrentTime(2))
    expect(props().currentLineIndex).toBe(initial.currentLineIndex)
    act(() => useSettingsStore.getState().setFoliaSettings({ fontScale: 1.2 }))
    expect(props().lyricsFontScale).not.toBe(initial.lyricsFontScale)
    expect(props().classicTuning).not.toBe(initial.classicTuning)
  })
})

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
    const stage = container.querySelector('.visualizer-still')
    expect(stage?.textContent).toContain('第一句')
    act(() => usePlayerStore.getState().setCurrentTime(4))
    expect(container.querySelector('.visualizer-still')).toBe(stage)
    expect(stage?.textContent).toContain('第一句')
    expect(stage?.textContent).toContain('first')
    expect(stage?.textContent).not.toContain('等待')
    act(() => usePlayerStore.getState().setCurrentTime(6))
    expect(stage?.textContent).toContain('第二句')
  })
})
