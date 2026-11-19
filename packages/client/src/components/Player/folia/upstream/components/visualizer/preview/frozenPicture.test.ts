// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyImage, freezeStage, watchStage } from './frozenPicture'

const drawImage = vi.fn()
let stage: HTMLDivElement
let frame: HTMLIFrameElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  const context = {
    drawImage, clearRect: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) }),
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((type: string) => type === '2d' ? context : null) as HTMLCanvasElement['getContext'],
  )
  stage = document.createElement('div')
  stage.getAnimations = () => []
  frame = document.createElement('iframe')
  frame.setAttribute('data-picture-canvas-frame', '')
  frame.className = 'absolute inset-0 h-full w-full'
  stage.append(frame)
  document.body.append(stage)
})
afterEach(() => {
  stage.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('local canvas frame pictures', () => {
  it('waits for the engine canvas instead of caching just its subtitles', () => {
    const subtitle = document.createElement('div')
    subtitle.textContent = 'next lyric'
    stage.append(subtitle)
    expect(freezeStage(stage)).toBeNull()
    const done = vi.fn()
    const stop = watchStage(stage, 'drawn', done)
    vi.advanceTimersByTime(200)
    expect(done).not.toHaveBeenCalled()
    const canvas = frame.contentDocument!.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    frame.contentDocument!.body.append(canvas)
    vi.advanceTimersByTime(100)
    expect(done).toHaveBeenCalledWith('shown')
    stop()
  })

  it('freezes and reuses frame pixels without retaining an iframe or reloading its scripts', () => {
    const canvas = frame.contentDocument!.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    canvas.style.width = '1280px'
    canvas.style.height = '720px'
    frame.contentDocument!.body.append(canvas)
    const image = freezeStage(stage)!
    expect(image.querySelector('iframe, script')).toBeNull()
    const flat = image.querySelector('canvas')!
    expect(flat.width).toBe(384)
    expect(flat.height).toBe(216)
    expect(flat.style.width).toBe('1280px')
    expect(flat.style.height).toBe('720px')
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 384, 216)
    const reused = copyImage(image)
    expect(reused.querySelector('iframe')).toBeNull()
    expect(reused.querySelector('canvas')?.width).toBe(384)
    expect(frame.isConnected).toBe(true)
  })

  it('does not access unmarked frames or crash on an inaccessible frame', () => {
    const getDocument = vi.spyOn(frame, 'contentDocument', 'get').mockImplementation(() => {
      throw new DOMException('different origin', 'SecurityError')
    })
    frame.removeAttribute('data-picture-canvas-frame')
    expect(freezeStage(stage)).toBeNull()
    expect(getDocument).not.toHaveBeenCalled()
    frame.setAttribute('data-picture-canvas-frame', '')
    expect(freezeStage(stage)).toBeNull()
    expect(getDocument).toHaveBeenCalled()
  })
})
