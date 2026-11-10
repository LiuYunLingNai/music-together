import { IsolationRenderer, MeshGradientRenderer, PixiRenderer, type BaseRenderer } from '@applemusic-like-lyrics/core'
import { BackgroundRender } from '@applemusic-like-lyrics/react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { getAudioTapRevision, getLowFreqAnalyser } from '@/lib/audioTap'
import type { BgRendererSetting } from '@/lib/storage'

/**
 * 经典播放器的 AMLL 背景，按上游 amll-player / react-full 的实现接线：
 * 渲染器选择（含 CSS 背景回退）、低频鼓点跳动，均与上游同一条路径。
 */

type RendererConstructor = new (canvas: HTMLCanvasElement) => BaseRenderer

/** 与上游 `BACKGROUND_RENDERERS` 中设置面板暴露的三项一致 */
const BACKGROUND_RENDERERS: Record<
  Exclude<BgRendererSetting, 'css-bg'>,
  { renderer: RendererConstructor; isSupported: () => boolean }
> = {
  mesh: {
    renderer: MeshGradientRenderer,
    isSupported: () => MeshGradientRenderer.isSupported(),
  },
  pixi: {
    renderer: PixiRenderer,
    isSupported: () => PixiRenderer.isSupported(),
  },
  isolation: {
    renderer: IsolationRenderer,
    isSupported: () => IsolationRenderer.isSupported(),
  },
}

/** 上游解析顺序：当前环境不支持时先回退 Mesh，再回退纯色 CSS 背景 */
function resolveBackgroundRenderer(id: BgRendererSetting): RendererConstructor | 'css-bg' {
  if (id === 'css-bg') return 'css-bg'
  if (BACKGROUND_RENDERERS[id].isSupported()) return BACKGROUND_RENDERERS[id].renderer
  return BACKGROUND_RENDERERS.mesh.isSupported() ? BACKGROUND_RENDERERS.mesh.renderer : 'css-bg'
}

// ---------------------------------------------------------------------------
// 低频音量（鼓点跳动）
// ---------------------------------------------------------------------------

const LOW_FREQ_FROM_HZ = 80
/** 上游取 128 段频谱（80–2000Hz）的前两段，约 80–110Hz */
const LOW_FREQ_BIN_COUNT = 2
const GRADIENT_WINDOW = 10
/** 每毫秒向目标值逼近的系数（上游 `0.003 * delta`） */
const SMOOTHING_PER_MS = 0.003
/** 与上游 Rust 侧一致：满刻度 PCM（i16）折算成 32768 后除以 255 */
const PCM_FULL_SCALE = 32768

function amplitudeToLevel(amplitude: number): number {
  return 0.5 * Math.log10(amplitude / 255 + 1)
}

function readLowFreqLevel(analyser: AnalyserNode, data: Float32Array<ArrayBuffer>): number {
  analyser.getFloatFrequencyData(data)
  const binHz = analyser.context.sampleRate / analyser.fftSize
  const from = Math.min(data.length - 1, Math.max(0, Math.floor(LOW_FREQ_FROM_HZ / binHz)))
  let sum = 0
  for (let i = 0; i < LOW_FREQ_BIN_COUNT; i++) {
    const db = data[Math.min(data.length - 1, from + i)]
    sum += amplitudeToLevel(Number.isFinite(db) ? 10 ** (db / 20) * PCM_FULL_SCALE : 0)
  }
  return sum / LOW_FREQ_BIN_COUNT
}

/** 上游 `calculateGradient`：10 帧窗口内的峰值检测 */
function calculateGradient(history: number[], level: number): number {
  if (history.length < GRADIENT_WINDOW && !history.includes(level)) {
    history.push(level)
    return 0
  }
  history.shift()
  history.push(level)

  const maxInInterval = Math.max(...history) ** 2
  const minInInterval = Math.min(...history)
  return maxInInterval - minInInterval > 0.35 ? maxInInterval : minInInterval * 0.25
}

/** 上游 `FFTToLowPassContext` 的无值订阅版：直接返回平滑后的低频音量 */
function useLowFreqVolume(active: boolean): number {
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    if (!active) return

    let raf = 0
    let lastTime = 0
    let curValue = 1
    let revision = getAudioTapRevision()
    let data: Float32Array<ArrayBuffer> | null = null
    const history: number[] = []

    const onFrame = (time: number) => {
      raf = requestAnimationFrame(onFrame)

      // 新的播放会话：丢掉上一首的响度历史，否则安静歌曲会长时间检测不到鼓点。
      const currentRevision = getAudioTapRevision()
      if (currentRevision !== revision) {
        revision = currentRevision
        history.length = 0
        curValue = 1
      }

      const analyser = getLowFreqAnalyser()
      let value = 0
      if (analyser) {
        if (!data || data.length !== analyser.frequencyBinCount) {
          data = new Float32Array(analyser.frequencyBinCount)
        }
        value = calculateGradient(history, readLowFreqLevel(analyser, data))
      }

      const delta = lastTime ? Math.min(100, time - lastTime) : 16
      lastTime = time
      curValue += (value - curValue) * Math.min(1, SMOOTHING_PER_MS * delta)
      setVolume(curValue)
    }

    raf = requestAnimationFrame(onFrame)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return volume
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

interface BackgroundProps {
  album?: string | HTMLImageElement | HTMLVideoElement
  albumIsVideo?: boolean
  /** 画面静止（离开播放器页/窗口隐藏）时停掉渲染与频谱循环；暂停播放不触发 */
  staticMode: boolean
  fps: number
  flowSpeed: number
  renderScale: number
  renderer: RendererConstructor
  style?: CSSProperties
}

/**
 * 把低频订阅收进背景子树，避免鼓点更新带动整个播放器重渲染（同上游）。
 */
function LowFreqBackgroundRender({
  album,
  albumIsVideo,
  staticMode,
  fps,
  flowSpeed,
  renderScale,
  renderer,
  style,
}: BackgroundProps) {
  // 只有 Mesh 渲染器消费低频音量，其余渲染器不必跑每帧的频谱循环。
  const lowFreqVolume = useLowFreqVolume(renderer === MeshGradientRenderer && !staticMode)

  return (
    <BackgroundRender
      album={album}
      albumIsVideo={albumIsVideo}
      staticMode={staticMode}
      fps={fps}
      flowSpeed={flowSpeed}
      renderScale={renderScale}
      renderer={renderer}
      lowFreqVolume={lowFreqVolume}
      style={style}
    />
  )
}

export interface AmllBackgroundRenderProps {
  album?: string | HTMLImageElement | HTMLVideoElement
  albumIsVideo?: boolean
  staticMode: boolean
  fps: number
  flowSpeed: number
  renderScale: number
  renderer: BgRendererSetting
  /** `css-bg` 时用作 `background` 的属性值 */
  cssBackground: string
  style?: CSSProperties
}

export function AmllBackgroundRender({
  album,
  albumIsVideo,
  staticMode,
  fps,
  flowSpeed,
  renderScale,
  renderer,
  cssBackground,
  style,
}: AmllBackgroundRenderProps) {
  const resolved = useMemo(() => resolveBackgroundRenderer(renderer), [renderer])

  if (resolved === 'css-bg') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          background: cssBackground,
          ...style,
        }}
      />
    )
  }

  return (
    <LowFreqBackgroundRender
      album={album}
      albumIsVideo={albumIsVideo}
      staticMode={staticMode}
      fps={fps}
      flowSpeed={flowSpeed}
      renderScale={renderScale}
      renderer={resolved}
      style={style}
    />
  )
}
