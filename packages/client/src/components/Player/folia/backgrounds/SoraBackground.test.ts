// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoraBackground } from './SoraBackground'
import type { Theme } from '../types'

const theme: Theme = { name: 'test', primaryColor: '#ffffff', secondaryColor: '#888888', accentColor: '#aaffcc', backgroundColor: '#000000', animationIntensity: 'normal', fontStyle: 'sans' }
let root: Root
let container: HTMLDivElement
let sequence: number
let resize: ResizeObserverCallback
const frames = new Map<number, FrameRequestCallback>()
const disconnect = vi.fn()
const context = { clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), globalAlpha: 1, fillStyle: '' }

function frame(time: number) {
  const entries = [...frames.entries()]
  frames.clear()
  entries.forEach(([, callback]) => callback(time))
}
function mount(paused: boolean) {
  act(() => root.render(createElement(SoraBackground, { theme, paused, fps: 30, scale: 0.5, speed: 1 })))
}
beforeEach(() => {
  sequence = 0
  frames.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    disconnect = disconnect
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Sora 背景资源与性能', () => {
  it('静止只绘制一帧，改变尺寸后重新绘制，并在卸载时清理', () => {
    mount(true)
    expect(frames.size).toBe(1)
    frame(0)
    expect(context.arc).toHaveBeenCalledTimes(150)
    expect(frames.size).toBe(0)
    resize([], {} as ResizeObserver)
    frame(16)
    expect(context.arc).toHaveBeenCalledTimes(300)
    expect(frames.size).toBe(0)
    act(() => root.unmount())
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('遵循帧率和渲染精度，暂停/卸载释放动画循环', () => {
    mount(false)
    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(400)
    expect(canvas.height).toBe(300)
    frame(0)
    frame(16)
    expect(context.arc).toHaveBeenCalledTimes(150)
    frame(34)
    expect(context.arc).toHaveBeenCalledTimes(300)
    expect(frames.size).toBe(1)
    mount(true)
    frame(50)
    expect(frames.size).toBe(0)
    act(() => root.unmount())
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
