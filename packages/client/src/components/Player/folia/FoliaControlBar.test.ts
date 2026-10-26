// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineAbilityFor, EVENTS, type UserRole } from '@music-together/shared'
import { AbilityContext } from '@/providers/ability-context'
import { SocketContext } from '@/providers/socket-context'
import type { TypedSocket } from '@/lib/socket'
import { TooltipProvider } from '@/components/ui/tooltip'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { FoliaControlBar } from './FoliaControlBar'
import { useFoliaStyleWindowStore } from './stage/foliaStyleWindowStore'
import { StageSwitcher } from '../stages/StageSwitcher'

/**
 * 设置入口在本文件里换成轻量替身：真实的上游工作窗口是懒加载的重组件，
 * 在假定时器下无法等待 chunk，也不属于播放栏行为。窗口自身有单独的用例。
 */
// 窗口本体挂在舞台之外（FoliaStyleWindowHost），本文件只验证“点击是否把窗口打开”。
vi.mock('./FoliaStyleWindow', () => ({ FoliaStyleWindowHost: () => null, FoliaStyleWindow: () => null }))

let root: Root
let container: HTMLDivElement
const callbacks = () => ({
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onSeek: vi.fn(),
  onNext: vi.fn(),
  onPrev: vi.fn(),
  onOpenQueue: vi.fn(),
  onOpenChat: vi.fn(),
  onStartVote: vi.fn(),
  onCastVote: vi.fn(),
  chatUnreadCount: 2,
  activeVote: null,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  // 上游样式窗口按视口宽度决定两栏还是一栏，jsdom 没有 matchMedia。
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
  useFoliaStyleWindowStore.getState().setOpen(false)
  localStorage.clear()
  useSettingsStore.getState().resetFoliaSettings()
  usePlayerStore.getState().reset()
  usePlayerStore.getState().setCurrentTrack({
    id: 'track',
    title: '测试歌曲',
    artist: ['歌手'],
    album: '',
    cover: '',
    duration: 180,
    source: 'netease',
    sourceId: '1',
    urlId: '1',
  })
  usePlayerStore.getState().setDuration(180)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function mount(role: UserRole) {
  const props = callbacks()
  const emit = vi.fn()
  const socket = { emit } as unknown as TypedSocket
  act(() =>
    root.render(
      createElement(
        SocketContext.Provider,
        { value: { socket, isConnected: true } },
        createElement(
          AbilityContext.Provider,
          { value: defineAbilityFor(role) },
          createElement(TooltipProvider, null, createElement(FoliaControlBar, props)),
        ),
      ),
    ),
  )
  return { ...props, emit }
}

function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button, label).not.toBeNull()
  act(() => button!.click())
}

describe('Folia 播放栏行为', () => {
  it('手动隐藏只能用恢复按钮恢复，不被鼠标、键盘或暂停唤醒', () => {
    useSettingsStore.getState().setFoliaSettings({ autoHide: true })
    usePlayerStore.getState().setIsPlaying(true)
    mount('owner')
    click('隐藏播放栏')
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('[aria-label="恢复播放栏"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(JSON.parse(localStorage.getItem('mt-foliaSettings')!).manualHide).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      usePlayerStore.getState().setIsPlaying(false)
      vi.advanceTimersByTime(4000)
    })
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).toBeNull()
    act(() => usePlayerStore.getState().setIsPlaying(true))
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).toBeNull()
    click('恢复播放栏')
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).not.toBeNull()
    expect(useSettingsStore.getState().foliaSettings.manualHide).toBe(false)
    expect(useSettingsStore.getState().foliaSettings.autoHide).toBe(true)
    act(() => vi.advanceTimersByTime(3100))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(true)
  })
  it('手动隐藏的选择在重新挂载后保留，恢复按钮始终存在', () => {
    useSettingsStore.getState().setFoliaSettings({ manualHide: true })
    mount('owner')
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).toBeNull()
    expect(container.querySelector('[aria-label="恢复播放栏"]')).not.toBeNull()
    click('恢复播放栏')
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).not.toBeNull()
  })
  it('调整模式、关闭自动隐藏或重置参数均不会解除手动隐藏', () => {
    useSettingsStore.getState().setFoliaSettings({ manualHide: true, autoHide: true })
    mount('owner')
    act(() => {
      useSettingsStore.getState().setVisualStage('partita')
      useSettingsStore.getState().setFoliaSettings({ autoHide: false, background: 'sora' })
      useSettingsStore.getState().resetFoliaSettings()
    })
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).toBeNull()
    expect(useSettingsStore.getState().foliaSettings.manualHide).toBe(true)
    click('恢复播放栏')
    expect(container.querySelector('[aria-label="Folia 播放控制"]')).not.toBeNull()
  })
  it('舞台切换器：未激活 Folia 段直接进入上次保存的歌词样式', () => {
    useSettingsStore.getState().setFoliaSettings({ lyricMode: 'cappella' })
    const onSelect = vi.fn()
    act(() => root.render(createElement(StageSwitcher, { mode: 'classic', onSelect })))
    click('切换到Folia 歌词')
    expect(onSelect).toHaveBeenCalledWith('cappella')
  })
  it('舞台切换器：已激活段展开模式列表，未激活段点击切换', () => {
    useSettingsStore.getState().setVisualStage('galaxy')
    const onSelect = vi.fn()
    act(() => root.render(createElement(StageSwitcher, { mode: 'galaxy', onSelect })))
    // 已激活 3D：点击展开模式列表而不是切换（浮层经 portal 挂在 body 上）。
    click('切换到3D 视觉（当前）')
    expect(onSelect).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('声波地形')
    // 未激活的经典段：直接切换。
    act(() => click('切换到经典播放器'))
    expect(onSelect).toHaveBeenLastCalledWith('classic')
  })
  it('房主直接播放、切歌与切模式，使用现有房间权限', () => {
    const props = mount('owner')
    click('播放')
    click('下一首')
    click('顺序播放')
    expect(props.onPlay).toHaveBeenCalledOnce()
    expect(props.onNext).toHaveBeenCalledOnce()
    expect(props.emit).toHaveBeenCalledWith(EVENTS.PLAYER_SET_MODE, { mode: 'loop-all' })
    expect(props.onStartVote).not.toHaveBeenCalled()
  })
  it('普通成员播放、切歌与切模式均走投票，进度条不可拖动', () => {
    const props = mount('member')
    click('播放')
    click('下一首')
    click('顺序播放')
    expect(props.onStartVote.mock.calls).toEqual([['resume'], ['next'], ['set-mode', { mode: 'loop-all' }]])
    expect(props.onPlay).not.toHaveBeenCalled()
    expect(props.onNext).not.toHaveBeenCalled()
    expect(props.emit).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="播放进度"]')?.hasAttribute('data-disabled')).toBe(true)
  })
  it('隐藏进度条后保留播放、队列与聊天入口', () => {
    useSettingsStore.getState().setFoliaSettings({ showProgress: false, barOffset: 80 })
    const props = mount('owner')
    expect(container.querySelector('[aria-label="播放进度"]')).toBeNull()
    expect(
      (container.querySelector('.folia-console') as HTMLElement).style.getPropertyValue('--folia-bar-offset'),
    ).toBe('80px')
    click('播放列表')
    click('聊天')
    expect(props.onOpenQueue).toHaveBeenCalledOnce()
    expect(props.onOpenChat).toHaveBeenCalledOnce()
  })
  it('底栏设置按钮打开歌词样式窗口', () => {
    mount('owner')
    expect(useFoliaStyleWindowStore.getState().open).toBe(false)
    click('Folia 播放器设置')
    // 窗口由舞台之外的宿主渲染（切样式不再带着它重挂），这里只断言开关被打开。
    expect(useFoliaStyleWindowStore.getState().open).toBe(true)
  })
  it('鼠标关闭设置后，焦点返回底栏也会在三秒后隐藏', () => {
    useSettingsStore.getState().setFoliaSettings({ autoHide: true })
    usePlayerStore.getState().setIsPlaying(true)
    mount('owner')
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Folia 播放器设置"]')!
    act(() => trigger.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    click('Folia 播放器设置')
    act(() => vi.advanceTimersByTime(4000))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(false)
    act(() => useFoliaStyleWindowStore.getState().setOpen(false))
    act(() => vi.advanceTimersByTime(0))
    act(() => trigger.focus())
    expect(document.activeElement).toBe(trigger)
    act(() => vi.advanceTimersByTime(3100))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(true)
  })
  it('音量浮层打开时保持可见，关闭后鼠标焦点不再阻止隐藏', () => {
    useSettingsStore.getState().setFoliaSettings({ autoHide: true })
    usePlayerStore.getState().setIsPlaying(true)
    mount('owner')
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="调节音量"]')!
    act(() => {
      trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      trigger.click()
    })
    act(() => vi.advanceTimersByTime(4000))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(false)
    act(() => trigger.click())
    act(() => vi.advanceTimersByTime(0))
    act(() => trigger.focus())
    act(() => vi.advanceTimersByTime(3100))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(true)
  })
  it('键盘操作保持可见，切回鼠标操作后不被残留焦点锁住', () => {
    useSettingsStore.getState().setFoliaSettings({ autoHide: true })
    usePlayerStore.getState().setIsPlaying(true)
    mount('owner')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      ;(container.querySelector('.folia-console__inner') as HTMLElement).focus()
    })
    act(() => vi.advanceTimersByTime(3100))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(false)
    act(() => window.dispatchEvent(new Event('pointermove')))
    act(() => vi.advanceTimersByTime(3100))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(true)
  })
  it('暂停后恢复播放重新等待闲置间隔，不继承之前的隐藏状态', () => {
    useSettingsStore.getState().setFoliaSettings({ autoHide: true })
    usePlayerStore.getState().setIsPlaying(true)
    mount('owner')
    act(() => vi.advanceTimersByTime(3100))
    act(() => usePlayerStore.getState().setIsPlaying(false))
    act(() => usePlayerStore.getState().setIsPlaying(true))
    const consoleElement = container.querySelector('.folia-console')!
    expect(consoleElement.hasAttribute('data-hidden')).toBe(false)
    act(() => vi.advanceTimersByTime(3100))
    expect(consoleElement.hasAttribute('data-hidden')).toBe(true)
  })
})
