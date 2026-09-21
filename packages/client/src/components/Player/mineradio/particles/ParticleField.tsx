import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { readAudioBands } from '../shared/AudioAnalyser'
import { createAudioNormalizerState, stepAudioNormalize } from '../shared/audioNormalize'
import type { CoverAssets } from '../shared/CoverTextureLoader'
import type { RenderPolicy } from '../shared/RenderPolicy'
import { PRESET_INDEX, getVisualMode, usesParticlePreset, type VisualModeId } from '../shared/VisualMode'
import { disposeDotTexture, getDotTexture } from './dotTexture'
import {
  PARTICLE_ROTATION_EASE,
  clearCoverPose,
  gestureRotationState,
  publishCoverPose,
  rebaseParticleRotationIfNeeded,
  resetGestureRotation,
  tickGestureRotation,
} from './gestureRotationState'
import { boostCameraPunch, orbitCameraState } from './orbitCameraState'
import {
  ALPHA_FADE_DURATION_SECONDS,
  PARTICLE_PLANE_SIZE,
  RENDER_FX,
} from './particleContract'
import {
  beginPresetTransition,
  createPresetTransition,
  tickPresetTransition,
  PRESET_TRANSITION_RIPPLE_COUNT,
  PRESET_TRANSITION_RIPPLE_SPREAD,
  type PresetTransitionState,
} from './presetTransition'
import { RippleController } from './RippleController'
import {
  PARTICLE_BLOOM_FRAGMENT_SHADER,
  PARTICLE_BLOOM_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
} from './shaders/particleVertex'

interface ParticleFieldProps {
  mode: VisualModeId
  cover: CoverAssets | null
  policy: RenderPolicy
  isPlaying: boolean
}

/**
 * 粒子平面的世界尺寸，取自上游 `particleGeometry.ts` 的 `PLANE_SIZE = 4.8`。
 * SILK 预设直接使用 position 作为坐标，因此这个值决定封面在舞台上的占比。
 *
 * 通过契约常量引入，保证实现与测试引用同一个值。
 */
const PLANE_SIZE = PARTICLE_PLANE_SIZE

/**
 * 唯一的粒子渲染实现 —— 使用着色器分支的模式，其差异全部来自 `uPreset`。
 *
 * 几何体与着色器程序只创建一次：切换模式只更新 uniform，
 * 不重建 BufferGeometry，也不重新编译 shader。
 *
 * 所有 uniform 写入都发生在 useFrame 或 effect 中（即 render 之外），
 * 因此组件本身保持纯函数。
 *
 * 注意：`topography`（声波地形）不经过本组件，它由独立的
 * `TopographyScene` 渲染。这里的 mode 类型仍然包含它，是为了与
 * `VisualModeId` 保持同一来源；`PRESET_INDEX` 查不到时回退到 0（SILK），
 * 不会抛错，但正常的调用路径不会走到这个分支。
 */
/**
 * 启发式深度图的 `uAiBoost` 目标值。
 *
 * 上游 `15-ripples-cover-depth.js` 在只生成启发式（非 AI）深度图时把
 * `uAiBoost` 缓动到 **0.55**；出厂初值是 0，真 AI 深度才用 1。
 * 本项目只做启发式深度，因此固定用 0.55 —— 用 1 会让静态 z 位移过大，
 * 外圈粒子渲染尺寸不一，表现为「静止时封面边缘参差」。
 */
const HEURISTIC_AI_BOOST = 0.55

export function ParticleField({ mode, cover, policy, isPlaying }: ParticleFieldProps) {
  const meta = getVisualMode(mode)
  const gl = useThree((s) => s.gl)
  // 每个模式有独立的着色器分支（3 号 VOID 槽位留空，见 VisualMode.ts）。
  // `usesParticlePreset` 只排除 `topography`（独立模块，没有 uPreset 编号）。
  const preset = usesParticlePreset(mode) ? PRESET_INDEX[mode] : 0

  // 涟漪控制器：低频命中时触发，状态由 CPU 推进后写入 uniform
  const rippleController = useMemo(() => new RippleController(), [])
  /** 上游音频归一化层的状态（峰值跟随/env 平滑），组件生命周期内持续。 */
  const normalizerRef = useRef(createAudioNormalizerState())

  // ---------------------------------------------------------------- 几何
  // 严格对照上游 `buildGalaxyParticleGeometry`：
  //   - UV 取**纹素中心** `(gx + 0.5) / grid`，而不是 gx/(grid-1)
  //   - position 写入**真实坐标** `(px - 0.5) * PLANE_SIZE`，PLANE_SIZE = 4.8
  //
  // 此前的实现把 position 写成全 0 数组、坐标全在着色器里由 UV 反算，
  // 导致构图与上游不一致（SILK 预设上游是直接 `pos = position`）。
  const geometry = useMemo(() => {
    const side = policy.particleGrid
    const count = side * side
    const positions = new Float32Array(count * 3)
    const uvs = new Float32Array(count * 2)
    const rands = new Float32Array(count)
    const texelStep = 1 / side

    for (let i = 0; i < count; i++) {
      const gx = i % side
      const gy = Math.floor(i / side)
      // 纹素中心，避免采样到封面边缘时出现半像素偏移
      uvs[i * 2] = (gx + 0.5) * texelStep
      uvs[i * 2 + 1] = (gy + 0.5) * texelStep
      const px = gx / (side - 1)
      const py = gy / (side - 1)
      positions[i * 3] = (px - 0.5) * PLANE_SIZE
      positions[i * 3 + 1] = (py - 0.5) * PLANE_SIZE
      positions[i * 3 + 2] = 0
      rands[i] = hash11(i * 0.618033988749895)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2))
    geo.setAttribute('aRand', new THREE.BufferAttribute(rands, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60)
    return geo
  }, [policy.particleGrid])

  // ---------------------------------------------------------------- 纹理
  const coverTexture = useMemo(() => {
    if (!cover) return null
    const texture = new THREE.Texture(cover.image)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
  }, [cover])

  const edgeTexture = useMemo(() => {
    if (!cover?.edge) return null
    const texture = new THREE.Texture(cover.edge)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
  }, [cover])

  // ---------------------------------------------------------------- 材质
  //
  // ★ 必须**命令式**创建 ShaderMaterial，不能用 JSX 的 `<shaderMaterial uniforms={...}>`。
  //
  // 原因（真实事故，导致整个舞台"全黑、改了任何参数都没变化"）：
  // R3F 把 `uniforms` 当作**构造参数**处理。它会在内部构造一个新的
  // ShaderMaterial，并把传入的 uniforms 对象**复制/重新包装**，
  // 于是 `material.uniforms !== 我持有的 uniforms 对象`。
  //
  // 后果：`useFrame` 里所有 `u.uAlpha.value = ...` 都写进了那个**游离的**
  // 对象，而真正参与渲染的材质永远停在初始值：
  //     uAlpha = 0 → 片元 alpha 恒为 0 → 每个粒子完全透明 → 画面什么都没有
  //
  // 实测证据（从场景图内部读）：
  //     sameUniformsObject: false
  //     matUAlpha: 0   而   expectedUAlpha: 1
  //     matUTime: 0    而   frameCount 已跑到 150+
  //
  // 命令式创建后，`material.uniforms` 就是我传进去的同一个对象引用，
  // 逐帧写入才真正生效（与上游 three.js 原生写法一致）。
  //
  // 具体创建见下方 `uniforms` 声明之后的 mainMaterial / bloomMaterial。
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      /** 切歌/入场爆发强度，上游用于过渡与亮度加成 */
      uBurstAmt: { value: 0 },
      uPreset: { value: preset },
      // 取值全部沿用上游 `DEFAULT_ROOM_VISUAL_FX`（见 particleContract.RENDER_FX）。
      //
      // 注意 `uAiBoost` 与 `uDepth` 的关系：深度位移项是
      //   depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth
      // 上游 `uAiBoost` 出厂 0，只有生成深度图后才升到 0.55（启发式）。
      // 本项目只做启发式深度，因此下面在纹理就绪时写 0.55，而不是 1。
      uIntensity: { value: RENDER_FX.intensity },
      uDepth: { value: RENDER_FX.depth },
      uPointScale: { value: RENDER_FX.point as number },
      uSpeed: { value: 1 },
      uTwist: { value: 0 },
      uVinylSpin: { value: 0 },
      uColorBoost: { value: RENDER_FX.colorBoost },
      uScatter: { value: RENDER_FX.scatter as number },
      uCoverRes: { value: policy.coverResolutionScale },
      uBgFade: { value: RENDER_FX.bgFade },
      uHasCover: { value: 0 },
      uHasDepth: { value: 0 },
      uAiBoost: { value: 0 },
      uEdgeEnabled: { value: 0 },
      uMouseActive: { value: meta.pointerParallax ? 1 : 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uMouseXY: { value: new THREE.Vector2(0, 0) },
      uPixel: { value: 1 },
      uColorMixT: { value: 1 },
      uLoading: { value: 0 },
      uCoverTex: { value: null as THREE.Texture | null },
      uPrevCoverTex: { value: null as THREE.Texture | null },
      uEdgeTex: { value: null as THREE.Texture | null },
      uDotTex: { value: null as THREE.Texture | null },
      // ★ 全局淡入乘数。
      //
      // 上游把 uAlpha 从 0 动画到 1（0.26s），且**明确不依赖播放状态**：
      //   "淡入不能依赖播放状态：暂停时进入沉浸也必须让粒子可见，
      //    否则 uAlpha 停在 0 会黑屏。"
      // 缺少这条链路时画面几乎全黑 —— 这正是此前"看不出变化"的主因。
      uAlpha: { value: 0 },
      uParticleDim: { value: 1 },
      uBloomStrength: { value: policy.bloom ? 0.62 : 0 },
      uBloomSize: { value: 2.65 },
      // 亮底避光强度。Mineradio `fxDefaults.lyricBackgroundAdapt = 0.72`，
      // 由 `syncFxUniforms` 写入本 uniform；片元用它缩放"亮粒子描暗边 /
      // 暗粒子描亮边"的强度，提升封面在亮背景下的可辨识度。
      //
      // 此前这里是 0，而片元又把系数写死成 0.38 / 0.20 —— 即这个 uniform
      // 传了也没人读，整条亮底自适应链路是断的。
      uBackdropAdapt: { value: 0.72 },
      /**
       * 整体染色链（Mineradio `syncFxUniforms`）。
       *
       * Mineradio 的 `visualTintMode` 为 `'custom'` 时 uTintStrength = 0.42，
       * `'auto'`（默认）时为 0。本项目尚未暴露该开关，因此保持 0 =
       * 不染色，与 Mineradio 的默认行为一致。
       * uniform 本身必须存在，否则着色器引用未声明变量会编译失败。
       */
      uTintColor: { value: new THREE.Color('#9db8cf') },
      uTintStrength: { value: 0 },
      uRipples: { value: rippleController.toUniformValue() },
      uRippleCount: { value: 0 },
    }),
    // 初始值只在挂载时确定；后续变化由 useFrame 统一写入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // 纹理对象变化时更新 uniform 引用。
  // uniforms 是 useMemo 返回的稳定对象；Three.js 的 uniform 容器本质上就是
  // 可变句柄，写入必须发生在渲染之外，这里在 effect 中完成。
  //
  // ★ 封面交叉淡化（上游 15-ripples-cover-depth.js:319-332 + :601/609）：
  //   切歌时旧纹理先挪到 uPrevCoverTex，uColorMixT 从 0 渐变到 1
  //   （SILK 0.32s / 其余 0.46s，visualEase），着色器
  //   `mix(prevCol, newCol, uColorMixT)` 三分支同式 —— 否则切歌瞬间
  //   封面颜色硬切。mode prop 变化视为"切歌"（封面随之更换）。
  const prevCoverRef = useRef<THREE.Texture | null>(null)
  const colorMixTweenRef = useRef<{ raf: number } | null>(null)
  useEffect(() => {
    if (prevCoverRef.current && prevCoverRef.current !== coverTexture) {
      uniforms.uPrevCoverTex.value = prevCoverRef.current
      // 启动渐变 tween（上游 startColorMixTween）
      if (colorMixTweenRef.current) cancelAnimationFrame(colorMixTweenRef.current.raf)
      uniforms.uColorMixT.value = 0
      const durationMs = preset === 0 ? 320 : 460
      const start = performance.now()
      const step = (now: number) => {
        let tt = Math.min(1, (now - start) / durationMs)
        // 上游 visualEase：cubic-out
        tt = 1 - Math.pow(1 - tt, 3)
        uniforms.uColorMixT.value = tt
        if (tt < 1) colorMixTweenRef.current = { raf: requestAnimationFrame(step) }
        else colorMixTweenRef.current = null
      }
      colorMixTweenRef.current = { raf: requestAnimationFrame(step) }
    }
    prevCoverRef.current = coverTexture
    uniforms.uCoverTex.value = coverTexture
    uniforms.uEdgeTex.value = edgeTexture
    uniforms.uDotTex.value = getDotTexture()
    uniforms.uHasCover.value = coverTexture ? 1 : 0
    // ★ 轮廓高亮由**用户设置**决定（上游 `fx.edge ? 1 : 0`，
    //   `07-fx/04-preset-grid-uniforms.js:122`，出厂 false）。
    //
    //   此前这里写的是 `edgeTexture ? 1 : 0` —— 一旦建出边缘纹理（总是会建）
    //   轮廓高亮就被强制打开，而着色器把 `edgeBoost` 累进 `vBright` 并参与
    //   颜色混合（`00-pointer-cover-particles.js:901,912`），于是**所有模式
    //   每个粒子系统性偏亮**且用户无法关闭。深度门控（uHasDepth）另算。
    uniforms.uEdgeEnabled.value = policy.edgeEnabled && edgeTexture ? 1 : 0
    uniforms.uHasDepth.value = edgeTexture ? 1 : 0
    // 上游只有**启发式深度图**时把 uAiBoost 缓动到 0.55（真 AI 深度才用 1）。
    // 本项目只产出启发式深度，因此目标固定 0.55；无纹理时为 0。
    aiBoostTargetRef.current = edgeTexture ? HEURISTIC_AI_BOOST : 0
  }, [uniforms, coverTexture, edgeTexture, preset, policy.edgeEnabled])

  // ---------------------------------------------------------------- 材质
  //
  // ★ 必须用 `material={...}` 命令式传入，**不能**用 JSX
  //   `<shaderMaterial uniforms={uniforms} />`。
  //
  // R3F 会把 `uniforms` 当构造参数处理并重新包装，导致
  // `material.uniforms !== uniforms`。这样 useFrame 里所有
  // `u.uAlpha.value = ...` 都写进游离对象，真正参与渲染的材质
  // 永远停在初始值 uAlpha = 0 → 片元 alpha 恒为 0 → 粒子全透明不可见。
  //
  // 实测证据（从场景图内部读回）：
  //   sameUniformsObject: false
  //   matUAlpha: 0  而 expectedUAlpha: 1
  //   matUTime:  0  而 frameCount 已 150+
  const mainMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        // ★ 主粒子必须是 NormalBlending。
        //
        // Mineradio `00-pointer-cover-particles.js:1012` 与 OpenMusic
        // `GalaxyParticles.tsx` **两个基准都是** NormalBlending，
        // 只有泛光层用 AdditiveBlending（见下方 bloomMaterial）。
        //
        // 此前这里误用 AdditiveBlending，导致：
        //   1. 封面暗部被背景加亮 → 近黑区域发灰，封面失去黑场
        //   2. 粒子重叠处累加削顶 → 高光糊成一片白
        //   3. 顶点着色器里的 blackParticleGuard / 片元的 keepBlack
        //      这两条「保住封面黑场」的逻辑被加色抵消，等于白写
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  )

  const bloomMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_BLOOM_VERTEX_SHADER,
        fragmentShader: PARTICLE_BLOOM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  )

  useEffect(() => {
    return () => mainMaterial.dispose()
  }, [mainMaterial])

  useEffect(() => {
    return () => bloomMaterial.dispose()
  }, [bloomMaterial])

  // ---------------------------------------------------------------- 鼠标
  const pointerRef = useRef(new THREE.Vector2(0.5, 0.5))

  /** `uAiBoost` 的目标值（有启发式深度图时 0.55，否则 0），逐帧缓动过去。 */
  const aiBoostTargetRef = useRef(0)

  /** 复用的四元数/位置缓冲，避免逐帧分配。 */
  const coverQuatRef = useRef(new THREE.Quaternion())
  const coverPosRef = useRef(new THREE.Vector3())

  useEffect(() => {
    if (!meta.pointerParallax) return
    // 坐标必须相对**画布**归一化，而不是 `event.target`。
    // 之前用 event.target 的 rect：指针移到控制栏/歌词等兄弟元素上时，
    // rect 变成那个元素的盒子，归一化坐标突变 → 封面粒子焦点乱跳。
    // 监听器挂在画布上，指针移到覆盖其上的控制栏时事件不再触发，
    // 焦点停在最后位置；离开画布则平滑回到中心。
    const canvas = gl.domElement
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      pointerRef.current.set(
        (event.clientX - rect.left) / rect.width,
        1 - (event.clientY - rect.top) / rect.height,
      )
    }
    // 指针离开画布：焦点回中心，uMouse 会逐帧缓动过去，推挤随之淡出。
    const onLeave = () => pointerRef.current.set(0.5, 0.5)
    canvas.addEventListener('pointermove', onMove, { passive: true })
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [gl, meta.pointerParallax])

  useEffect(() => {
    // 音频接线已上移到 `ParticleScene` 的 `AudioStepDriver`（地形模式也要用，
    // 而 ParticleField 在地形模式下不挂载）。这里只做本组件自己的清理。
    return () => {
      // 点精灵纹理是模块级缓存；舞台卸载时一并释放，避免长时间
      // 反复进出视觉模式时持续占用纹理内存。
      disposeDotTexture()
      // 让歌词层回落到"不跟随"的中性姿态
      clearCoverPose()
      // ★ 手势旋转单例随舞台卸载归零（本文件头部文档声明的清理义务）：
      //   否则带惯性卸载后重进视觉模式，封面会带着上次的歪斜角度出现。
      resetGestureRotation()
    }
  }, [])

  // ---------------------------------------------------------------- 渲染
  const elapsedRef = useRef(0)
  const burstRef = useRef(0)

  // 手势旋转层（拖拽/惯性）。上游把它写在 `particles.rotation` 上，
  // 泛光层与背面层直接 `copy`，本项目同样以主粒子层为权威。
  const mainPointsRef = useRef<THREE.Points>(null)
  const bloomPointsRef = useRef<THREE.Points>(null)

  // 预设切换脉冲：切模式时抬 scatter / burst 并触发涟漪，避免硬切。
  // 脉冲曲线是纯函数（见 presetTransition.ts，对照 Mineradio 的
  // triggerPresetParticleTransition / tickPresetTransition），
  // 这里只持有「目标预设 + 起始时间」这点过渡状态。
  //
  // 初始值 null 表示「尚未挂载过任何预设」：首帧不放脉冲，
  // 因为入场已经有 uAlpha 淡入，再叠一次爆发会过冲。
  const lastPresetRef = useRef<number | null>(null)
  const transitionRef = useRef<PresetTransitionState | null>(null)

  useFrame((_, delta) => {
    // 标签页切回时 delta 可能很大，钳制避免粒子瞬移
    const dt = Math.min(delta, policy.maxDeltaSeconds)
    elapsedRef.current += dt

    const bands = readAudioBands()
    const u = uniforms
    u.uTime.value = elapsedRef.current

    // ★ 上游音频归一化层（11-main-loop.js:396-560，`shared/audioNormalize.ts`）：
    //   动态峰值归一化 → pow 曲线 → env 攻/放平滑 → 最终合成。
    //   此前用固定系数 lerp 直连原始频段 —— 滚筒条纹（uMid/uTreble 直接
    //   调制幅度）随频谱帧级抖动而闪烁，就是这个缺层导致的。
    const norm = stepAudioNormalize(
      normalizerRef.current,
      {
        lowDrive: bands.lowDrive,
        snap: bands.snap,
        tHigh: bands.snap,
        vocal: bands.vocal,
        energy: bands.energy,
        playing: isPlaying,
        dt: delta,
      },
      RENDER_FX.intensity,
      // ★ preset ≥ 4 环带再合成（上游 11-main-loop.js:540-565）：
      //   vinyl 走"冲"档、galaxy 走"平"档，此前两模式都吃 emily 的通用
      //   合成曲线 —— 唱片少了冲击感、星河的背景响应又太跳。
      preset,
    )
    u.uBass.value = norm.bass
    u.uMid.value = norm.mid
    u.uTreble.value = norm.treble
    u.uBeat.value = norm.beat
    u.uEnergy.value = norm.energy

    // ★ 全局淡入。
    //
    // 严格对照上游 GalaxyParticles.tsx：
    //   "淡入不能依赖播放状态：暂停时进入沉浸也必须让粒子可见，
    //    否则 uAlpha 停在 0 会黑屏。"
    //
    // 注意 delta 用**真实帧时长**而不是钳制后的 dt：
    // 淡入是入场动画，应该跟随真实时间推进（上游同样用 delta）。
    // 并且**不受 isPlaying 影响** —— 这点是上游明确强调的。
    if (u.uAlpha.value < 1) {
      u.uAlpha.value = Math.min(1, u.uAlpha.value + delta / ALPHA_FADE_DURATION_SECONDS)
    }

    // 暂停时的衰减由 normalizer 的 idle 分支处理（上游 0.91^idle 语义）

    // 切歌/节拍爆发：命中时冲到 1，然后指数回落（上游 11-main-loop.js:592
    // `uBurstAmt *= 0.90`，帧率无关换算为 pow(0.90, dt*60)）。
    // 此前线性衰减，回落拖尾比上游长得多。
    burstRef.current = bands.bassHit ? 1 : burstRef.current * Math.pow(0.9, delta * 60)
    u.uBurstAmt.value = burstRef.current

    // 预设切换脉冲。
    //
    // 顺序要求：先写 uScatter / uPointScale 的基准值，再叠加脉冲。
    // 脉冲只做「抬高到不低于基准」（对照上游的 Math.max 语义），
    // 若基准在它之后才写入就会把脉冲覆盖掉。
    const basePoint = RENDER_FX.point
    u.uScatter.value = RENDER_FX.scatter
    u.uPointScale.value = basePoint

    if (lastPresetRef.current !== preset) {
      const from = lastPresetRef.current
      lastPresetRef.current = preset
      // ★ 把新预设写进 uniform —— 着色器全部 6 个分支都靠 uPreset 选择。
      // 上一会话抽离过渡逻辑时漏掉了这行，导致切模式只更新 lastPresetRef，
      // uPreset 永远停在挂载时的初值，视觉上「只有一种预设」。
      u.uPreset.value = preset
      // 首帧（from===null）不放脉冲：入场已有 uAlpha 淡入，再叠爆发会过冲。
      if (from !== null) {
        if (!transitionRef.current) transitionRef.current = createPresetTransition()
        const kick = beginPresetTransition(transitionRef.current, preset, elapsedRef.current)
        u.uScatter.value = Math.max(u.uScatter.value, RENDER_FX.scatter + kick.scatter)
        u.uBurstAmt.value = Math.max(u.uBurstAmt.value, kick.burst)
        // 相机前推（上游 04-preset-grid-uniforms.js:44：
        // camPunch = max(camPunch, wallpaperFlow ? 0.04 : 0.12)）
        boostCameraPunch(preset === 5 ? 0.04 : 0.12)
        // 切换涟漪：上游在 ±1.7 世界坐标随机撒 3 道，强度 0.58+rand*0.32
        // （04-preset-grid-uniforms.js:44-46）。涟漪控制器接受世界坐标。
        for (let i = 0; i < PRESET_TRANSITION_RIPPLE_COUNT; i++) {
          rippleController.trigger(
            (Math.random() - 0.5) * PRESET_TRANSITION_RIPPLE_SPREAD,
            (Math.random() - 0.5) * PRESET_TRANSITION_RIPPLE_SPREAD,
            0.58 + Math.random() * 0.32,
          )
        }
      }
    }

    if (transitionRef.current) {
      const pulse = tickPresetTransition(transitionRef.current, elapsedRef.current)
      if (pulse) {
        u.uScatter.value = Math.max(u.uScatter.value, RENDER_FX.scatter + pulse.scatter)
        u.uBurstAmt.value = Math.max(u.uBurstAmt.value, pulse.burst)
        u.uPointScale.value = basePoint * pulse.pointScaleMul
      }
    }

    // 涟漪：bass 电平回落穿越阈值时触发（上游 `updateRipples` 语义），
    // 不再用 kickOnset 布尔直接当触发源 —— 那会在一拍内连发多道且无区域结构。
    // 喂的是归一化后的 uBass（上游同样读合成后的全局 `bass`）。
    const activeRipples = rippleController.update(dt, isPlaying ? u.uBass.value : 0)
    u.uRippleCount.value = activeRipples
    if (activeRipples > 0) {
      const targets = u.uRipples.value as THREE.Vector4[]
      const source = rippleController.data
      for (let i = 0; i < targets.length; i++) {
        const base = i * 4
        targets[i].set(source[base], source[base + 1], source[base + 2], source[base + 3])
      }
    }

    // 模式与画质相关 uniform：每帧写入，天然跟随 props 变化。
    // uPreset 由上方的切换检测块负责写入，这里不再重复赋值。
    u.uMouseActive.value = meta.pointerParallax ? 1 : 0
    u.uBloomStrength.value = policy.bloom ? 0.62 : 0
    // uAiBoost 缓动（上游在切深度图时用缓动而非瞬变）
    u.uAiBoost.value += (aiBoostTargetRef.current - (u.uAiBoost.value as number)) * Math.min(1, dt * 4)
    u.uCoverRes.value = policy.coverResolutionScale

    // 唱片自旋（仅 VINYL 使用）。上游 11-main-loop.js:573-574：
    //   vinylSpinSpeed = (0.40 + smoothBass*0.09) * fx.speed，累加后 mod 2π。
    // 本项目未暴露 speed 滑杆（出厂 1.0），低频调制补上 —— 唱片随鼓点
    // 加速旋转。elapsedRef 恒速自旋是此前的简化。
    const vinylSpinSpeed = 0.4 + norm.bass * 0.09
    u.uVinylSpin.value = (u.uVinylSpin.value + dt * vinylSpinSpeed) % (Math.PI * 2)

    u.uMouse.value.lerp(pointerRef.current, 0.06)
    // 鼠标世界坐标：把 0..1 的归一化位置映射到舞台平面
    u.uMouseXY.value.set(
      (u.uMouse.value.x - 0.5) * PLANE_SIZE,
      (u.uMouse.value.y - 0.5) * PLANE_SIZE,
    )

    // 上游 GalaxyParticles.tsx:848 —— uPixel 取的是 **devicePixelRatio**：
    //     uniforms.uPixel.value = state.gl.getPixelRatio();
    // 顶点着色器里是 `gl_PointSize = sz * uPixel * uPointScale`，
    // 因此 uPixel 的语义是"一个 CSS 像素对应多少设备像素"，
    // 而不是视口高度比例。
    //
    // 此前误用 `size.y / 900`（≈0.80），比 DPR 小了一倍以上，
    // 导致点尺寸整体偏小、粒子几乎看不见。
    u.uPixel.value = gl.getPixelRatio()

    // ---- 手势旋转层（拖拽 + 惯性）----
    //
    // 严格对照上游 `11-main-loop.js:624-644`：
    //   1. 先 tickGestureRotation(dt) 推进惯性（必须在读取之前）
    //   2. targetRot = centerLocked ? 0 : gestureRotation —— 居中锁定时物体不转
    //   3. 主层缓动到 target（0.055/帧），其余层直接 copy
    //
    // 注意：这里**不**碰相机。相机由 CameraRig 独占写入，拖拽只转物体。
    tickGestureRotation(dt)

    const mainPoints = mainPointsRef.current
    if (mainPoints) {
      const orb = orbitCameraState
      const targetRotX = orb.centerLocked ? 0 : gestureRotationState.x
      const targetRotY = orb.centerLocked ? 0 : gestureRotationState.y
      mainPoints.rotation.x += (targetRotX - mainPoints.rotation.x) * PARTICLE_ROTATION_EASE
      mainPoints.rotation.y += (targetRotY - mainPoints.rotation.y) * PARTICLE_ROTATION_EASE
      // 泛光层与主层共享姿态（上游 `bloomParticles.rotation.copy(particles.rotation)`）
      bloomPointsRef.current?.rotation.copy(mainPoints.rotation)
      // rebase 时把偏移同步减到本层，避免长时间拖拽后跳变
      rebaseParticleRotationIfNeeded(
        [mainPoints, bloomPointsRef.current].filter(Boolean) as THREE.Points[],
      )

      // 把封面世界姿态发布给歌词层（上游歌词每帧采样 particles 的世界四元数
      // 与其世界位置作为锚点）。只写分量，不分配对象。
      mainPoints.getWorldQuaternion(coverQuatRef.current)
      const q = coverQuatRef.current
      mainPoints.getWorldPosition(coverPosRef.current)
      const p = coverPosRef.current
      publishCoverPose(q.x, q.y, q.z, q.w, p.x, p.y, p.z)
    }
  })

  // ---------------------------------------------------------------- 释放
  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])

  // 纹理会随切歌更换，必须在上传新纹理时释放旧纹理，否则持续泄漏显存。
  // ★ 交叉淡化期间旧纹理被 uPrevCoverTex 引用，延迟到渐变结束后释放。
  useEffect(() => {
    return () => {
      if (colorMixTweenRef.current) {
        cancelAnimationFrame(colorMixTweenRef.current.raf)
        colorMixTweenRef.current = null
      }
      // 旧封面纹理（正被 uPrevCoverTex 采样）等 tween 走完或组件卸载时释放
      const stale = prevCoverRef.current
      if (stale && stale !== coverTexture) stale.dispose()
      prevCoverRef.current = null
      coverTexture?.dispose()
    }
  }, [coverTexture])

  useEffect(() => {
    return () => edgeTexture?.dispose()
  }, [edgeTexture])

  // 泛光 pass 与主粒子共享同一个 uniform 对象与 geometry。
  // renderOrder：泛光先画（0），主粒子后画（1），与上游一致。
  //
  // 材质用 `material={...}` 命令式传入，而不是 JSX `<shaderMaterial>` ——
  // 后者会让 R3F 复制 uniforms，导致逐帧写入失效（见上方材质区注释）。
  return (
    <>
      {policy.bloom && (
        <points
          ref={bloomPointsRef}
          geometry={geometry}
          material={bloomMaterial}
          frustumCulled={false}
          renderOrder={0}
        />
      )}

      <points
        ref={mainPointsRef}
        geometry={geometry}
        material={mainMaterial}
        frustumCulled={false}
        renderOrder={1}
      />
    </>
  )
}

/** 确定性哈希：替代 Math.random，保证几何构建是可复现的纯计算。 */
function hash11(p: number): number {
  const x = Math.sin(p * 127.1) * 43758.5453123
  return x - Math.floor(x)
}
