import { Canvas, useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/stores/playerStore'
import { disposeAudioAnalyser, ensureAudioAnalyser, stepAudioFrame } from '../shared/AudioAnalyser'
import type { CoverAssets } from '../shared/CoverTextureLoader'
import { resolveFrameloop, type RenderPolicy } from '../shared/RenderPolicy'
import { getVisualMode, isTopographyMode, type VisualModeId } from '../shared/VisualMode'
import { LyricStage } from '../lyrics/LyricStage'
import type { CoverPalette } from '../lyrics/coverPalette'
import { TopographyScene } from '../topography/TopographyScene'
import type {
  LyricDisplayMode,
  LyricMotionStyle,
  LyricTranslationMode,
} from '../lyrics/lyricDisplayConfig'
import { CameraRig } from './CameraRig'
import { FloatingSongShelf } from './FloatingSongShelf'
import { ParticleField } from './ParticleField'
import { StarRiver } from './StarRiver'

interface ParticleSceneProps {
  mode: VisualModeId
  cover: CoverAssets | null
  policy: RenderPolicy
  isPlaying: boolean
  /** WebGL 上下文丢失时通知上层降级 */
  onContextLost?: () => void
  /** 是否在 3D 场景内渲染歌词（关闭时由 DOM 回退层接管） */
  showLyrics?: boolean
  /** 3D 歌词的外观设置 */
  lyricOptions?: LyricStageOptions
  /** 点击 3D 歌单架时打开完整队列 */
  onOpenQueue: () => void
}

/** 3D 歌词的外观设置，由设置面板驱动 */
export interface LyricStageOptions {
  palette: CoverPalette | null
  displayMode: LyricDisplayMode
  customLineCount: number
  motionStyle: LyricMotionStyle
  translationMode: LyricTranslationMode
}

/**
 * 音频分析的单点驱动。
 *
 * 用 `useFrame(cb, -1)` 抢在所有消费者之前执行（R3F 的 `renderPriority`
 * 越小越先跑），保证同一帧里大家读到的是**同一份**分析结果。
 *
 * 上游在主循环里也是每帧只算一次音频再分发；本项目此前让 6 个组件各自
 * 触发分析，破坏了共享的峰值/节拍状态（详见 SonicAudioMonitor 顶部）。
 */
function AudioStepDriver({ policy, documentVisible }: { policy: RenderPolicy; documentVisible: boolean }) {
  // ★ 音频接线必须在这里，**不能**放在 `ParticleField` 里。
  //
  // 曾经的致命错误：`ensureAudioAnalyser()` 只在 `ParticleField` 的 effect 里
  // 调用，而「声波地形」模式下 `ParticleField` 根本不挂载（两者互斥）。
  // 于是地形模式下分析节点从未接线 → `stepAudioFrame` 直接 return →
  // `getSonicAudioFrame()` 恒为 null → **地形完全拿不到音频，没有任何鼓点**。
  //
  // `AudioStepDriver` 与渲染模式无关、始终挂载，所以接线放这里。
  //
  // ★ 且必须**逐帧重试**：舞台挂载瞬间 Howler 的 AudioContext 往往还没建
  //   （Howler 懒初始化），此时 `ensureAudioAnalyser()` 返回 false 是正常的，
  //   不能就此放弃。下面每帧都尝试接一次，ctx 一就绪就自动接上。
  //   重试同时会检测 tap 升级（切歌后新 tap 发布）与兜底让位。
  useEffect(() => {
    return () => disposeAudioAnalyser()
  }, [])

  /**
   * 音频分析节流累加器（秒）。
   *
   * ★ 上游按**画质档**控制音频分析的**频率**，不只是步长：
   *   `targetMainAudioFps` = `(交互中 ? 72 : 54) × runtimeAudioAnalysisScale`
   *   （`11-main-loop.js:243-251`），eco 档 scale 0.68 → 约 37/49 fps，
   *   ultra 档 1.0 → 满帧。分析频率是 CPU 侧的主要开销之一
   *   （每帧 FFT 读数 + 八频段积分），低端设备上必须跟着档位降。
   *
   *   这里等价实现：按 `1 / targetFps` 的间隔推进 `stepAudioFrame`，
   *   其余帧只接线不分析 —— 视觉读到的仍是上一帧缓存（`readAudioBands`），
   *   因此节拍反馈连续，只是刷新率降低。
   */
  const analysisAccumulatorRef = useRef(0)
  // 上游 `targetMainAudioFps` 的非交互稳态基准是 **54**（交互中才抬到 72）；
  // 本项目未跟踪"主循环交互中"状态，取稳态基准 —— 保守且与常驻播放一致。
  // 上游随后做 `max(30, …)` 下界与 `capMainLoopFpsToDisplay` 上界，
  // 这里只保留下界（本项目不跟随显示器刷新率自适应）。
  const targetAudioFps = Math.max(30, Math.round(54 * policy.audioAnalysisScale))
  const analysisInterval = 1 / targetAudioFps

  // 后台时 Canvas 使用 demand，useFrame 不会运行。页面恢复可见时先在 React
  // effect 中主动唤醒 AudioContext，并让恢复后的第一帧立即分析，避免还要等
  // 下一次帧累加或下一首歌才重新出现节拍反馈。
  useEffect(() => {
    if (!documentVisible) return
    ensureAudioAnalyser()
    analysisAccumulatorRef.current = analysisInterval
  }, [analysisInterval, documentVisible])

  useFrame((_, delta) => {
    ensureAudioAnalyser()
    analysisAccumulatorRef.current += delta
    if (analysisAccumulatorRef.current < analysisInterval) return
    // 取实际经过时间（而非固定间隔），保证 `dt` 与音频推进量一致，
    // 否则低画质档下 env 平滑/衰减会比真实时间慢。
    const step = Math.min(analysisAccumulatorRef.current, 1 / 20)
    analysisAccumulatorRef.current = 0
    const player = usePlayerStore.getState()
    stepAudioFrame(step, player.currentTime, player.isPlaying)
  }, -1)
  return null
}

/** 可选的上下文丢失回退提示 */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const handler = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
  return visible
}

/**
 * Three.js 舞台宿主。
 *
 * 同一时刻只应存在一个 Canvas —— 由父级保证在切回经典播放器时卸载本组件。
 */
export function ParticleScene({
  mode,
  cover,
  policy,
  isPlaying,
  onContextLost,
  showLyrics = true,
  lyricOptions,
  onOpenQueue,
}: ParticleSceneProps) {
  const documentVisible = useDocumentVisible()
  const meta = getVisualMode(mode)
  const containerRef = useRef<HTMLDivElement>(null)
  const topography = isTopographyMode(mode)

  /**
   * 地形点击涟漪入口。
   *
   * 上游在 `mouseup` 里直接调 `MineradioSonicTopography.pointerRipple(nx, nz, strength)`。
   * 本项目里相机/指针层（CameraRig）与地形层是兄弟，因此由 ParticleScene
   * 持有一个 ref，把 TerrainScene 暴露的 addRipple 桥接给 CameraRig。
   */
  const rippleRef = useRef<((nx: number, nz: number, strength: number) => void) | null>(null)
  const handleCanvasClick = useCallback(
    (nx: number, nz: number, strength: number) => {
      rippleRef.current?.(nx, nz, strength)
    },
    [],
  )

  // WebGL 上下文丢失：只监听一次，交给上层决定回退目标
  useEffect(() => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return
    const handler = (event: Event) => {
      event.preventDefault()
      onContextLost?.()
    }
    canvas.addEventListener('webglcontextlost', handler)
    return () => canvas.removeEventListener('webglcontextlost', handler)
  }, [onContextLost])

  return (
    <div
      ref={containerRef}
      className="mt-mineradio-canvas-layer absolute inset-0"
      aria-hidden="true"
    >
      <Canvas
        // ★ 用上游 `getRenderPixelRatio` 的**计算结果**作为唯一 DPR，
        //   而不是 `[1, cap]` 区间 —— R3F 的区间形式会让 `window.devicePixelRatio`
        //   直接生效（例如 2.0），完全绕过上游的像素预算（budget/cssPixels）
        //   与各档下限（min）。上游是"按预算算出一个确定值"，这里必须一致，
        //   否则大屏设备上 eco 档也按满 DPR 渲染，画质档形同虚设。
        dpr={policy.pixelRatio}
        frameloop={resolveFrameloop(isPlaying, documentVisible)}
        // ★ flat + linear：关闭 R3F 默认的 ACES tone mapping / sRGB 输出变换 /
        //   THREE.ColorManagement，回到上游的「原始色彩管线」。
        //   Mineradio 是旧式 three 用法（无任何色彩管理，纹理原样采样、
        //   颜色原样输出）。R3F 默认管线会把 ACES 压缩 + 双重 gamma 叠加在
        //   移植着色器的手调颜色上 —— 滚筒条纹旋转中的走样闪烁、整体对比度
        //   与歌词可读性偏差都源于此。所有 uniforms/主题色数值都按原始管线
        //   手调，本标志改变的是**管线**，不改任何材质与着色器内容。
        flat
        linear
        gl={{
          antialias: false,
          // 画布必须透明，让下方的环境底色层（封面模糊铺底 + 主色渐变）透出来。
          // 若这里不透明，舞台就是一块纯黑矩形 —— 这正是"整个背景是黑的"的原因。
          alpha: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
        camera={{ fov: 45, near: 0.1, far: 200, position: [0, 3.1, 7.7] }}
        onCreated={({ gl }) => {
          // 透明清屏；背景由 DOM 的环境层负责
          gl.setClearColor(0x000000, 0)
        }}
      >
        {/* 不再设置 <color attach="background">，否则会盖住环境层。
            ★ 也不再设 <fog>：上游全工程没有任何 scene.fog（grep 零命中），
            纵深感来自各着色器内部的距离衰减（地形 aerialFog、粒子
            depthFade smoothstep(-4.5,4.5,z)）。场景雾只影响 MeshBasicMaterial
            （陨石/拖尾/卡片），曾把地形模式出生在 30-40 高度的陨石压成
            近黑 —— "陨石粒子效果很奇怪"的直接原因之一。 */}
        <ambientLight intensity={0.78} />
        <directionalLight color={meta.ambient} intensity={1.3} position={[3, 7, 5]} />

        {/* ★ 音频单点驱动：必须在所有消费者之前执行（renderPriority -1）。
            上游在主循环里每帧只算一次音频，再分发给所有视觉层；本项目
            此前让 6 个组件各自触发分析，破坏了共享状态（详见
            SonicAudioMonitor 顶部说明）。 */}
        <AudioStepDriver policy={policy} documentVisible={documentVisible} />

        <CameraRig
          mode={mode}
          enabled={policy.beatCamera}
          onCanvasClick={topography ? handleCanvasClick : undefined}
        />

        {/* 声波地形是独立模块：整片 instanced 地形取代粒子层。
            它自带世界锚定与雾，因此与粒子层互斥，不会同时渲染。 */}
        {topography ? (
          <TopographyScene
            policy={policy}
            palette={cover ? (lyricOptions?.palette ?? null) : null}
            accent={cover?.accent ?? null}
            motionEnabled={policy.beatCamera}
            onRippleReady={(fn) => {
              rippleRef.current = fn
            }}
          />
        ) : (
          <>
            {/* Mineradio 的各粒子预设均围绕世界原点构图；保持中央主舞台，
                不再用多人房间 UI 的分栏逻辑平移或缩放粒子主体。 */}
            <ParticleField mode={mode} cover={cover} policy={policy} isPlaying={isPlaying} />

            {/* OpenMusic 的纵深弧形背景星河；galaxy 模式由主粒子层承担星河。 */}
            <StarRiver enabled={policy.starRiver} mode={mode} />
          </>
        )}

        {/* OpenMusic 的完整 3D 队列架：滚轮浏览、悬停放大、相机跟拍。
            ★ 不再传 `maxItems`：卡片池现在是上游固定的 `SHELF_MAX_RENDER`
              （11 张，= 可见半径 5 的 ±1），**与画质档无关** —— 上游
              `01-manager-core.js:6-7` 里它就是个渲染预算常量，不是画质档
              派生值。此前按 `particleGrid` 分档给 24/12/6，会让低画质档
              连"当前歌 ±2 首"都看不到。 */}
        <FloatingSongShelf
          accent={cover?.accent ?? null}
          onOpenQueue={onOpenQueue}
          motionEnabled={policy.beatCamera}
        />

        {/* 歌词与 Mineradio 主视觉共享中央舞台。OpenMusic 仅作为多人房间
            适配和右侧 3D 卡片的参考，不反向改变 Mineradio 的构图轴心。 */}
        {showLyrics && (
          <LyricStage
            palette={lyricOptions?.palette ?? null}
            displayMode={lyricOptions?.displayMode}
            customLineCount={lyricOptions?.customLineCount}
            motionStyle={lyricOptions?.motionStyle}
            translationMode={lyricOptions?.translationMode}
          />
        )}

      </Canvas>
    </div>
  )
}
