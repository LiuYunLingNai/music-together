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
import { FoliaEntryButton } from './FoliaEntryButton'

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
  it('单个 Folia 按钮直接进入上次保存的歌词样式', () => {
    useSettingsStore.getState().setFoliaSettings({ lyricMode: 'cappella' })
    const onSelect = vi.fn()
    act(() => root.render(createElement(FoliaEntryButton, { mode: 'classic', onSelect })))
    click('进入 Folia 播放器')
    expect(onSelect).toHaveBeenCalledWith('cappella')
    expect(container.querySelectorAll('button')).toHaveLength(1)
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
  it('底栏设置可打开，切换进度条立即生效并保存，恢复默认后重新显示', () => {
    mount('owner')
    click('Folia 播放器设置')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Folia 播放器设置')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
    const playerTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent === '播放器',
    )!
    act(() => playerTab.click())
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="显示进度条"]')!
    act(() => toggle.click())
    expect(useSettingsStore.getState().foliaSettings.showProgress).toBe(false)
    expect(container.querySelector('[aria-label="播放进度"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('mt-foliaSettings')!).showProgress).toBe(false)
    const reset = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.textContent === '恢复默认',
    )!
    act(() => reset.click())
    expect(container.querySelector('[aria-label="播放进度"]')).not.toBeNull()
  })
  it('闲置播放时隐藏，操作唤醒；暂停和键盘聚焦时保持可见', () => {
    useSettingsStore.getState().setFoliaSettings({ autoHide: true })
    usePlayerStore.getState().setIsPlaying(true)
    mount('owner')
    const consoleElement = container.querySelector('.folia-console')!
    act(() => vi.advanceTimersByTime(3100))
    expect(consoleElement.hasAttribute('data-hidden')).toBe(true)
    act(() => window.dispatchEvent(new Event('pointermove')))
    expect(consoleElement.hasAttribute('data-hidden')).toBe(false)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      ;(container.querySelector('.folia-console__inner') as HTMLElement).focus()
    })
    act(() => vi.advanceTimersByTime(3100))
    expect(consoleElement.hasAttribute('data-hidden')).toBe(false)
    act(() => usePlayerStore.getState().setIsPlaying(false))
    act(() => vi.advanceTimersByTime(4000))
    expect(consoleElement.hasAttribute('data-hidden')).toBe(false)
  })
  it('无歌曲时播放与切歌禁用，设置与队列仍可访问', () => {
    usePlayerStore.getState().setCurrentTrack(null)
    mount('owner')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="播放"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="下一首"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Folia 播放器设置"]')?.disabled).toBe(false)
  })
  it('鼠标点击按钮留下的焦点不会阻止闲置隐藏', () => {
    useSettingsStore.getState().setFoliaSettings({ autoHide: true })
    usePlayerStore.getState().setIsPlaying(true)
    mount('owner')
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="暂停"]')!
    act(() => {
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      button.focus()
      button.click()
    })
    expect(document.activeElement).toBe(button)
    act(() => vi.advanceTimersByTime(3100))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(true)
    act(() => window.dispatchEvent(new Event('pointermove')))
    expect(container.querySelector('.folia-console')!.hasAttribute('data-hidden')).toBe(false)
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
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="关闭 Folia 设置"]')!
    act(() => close.click())
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
