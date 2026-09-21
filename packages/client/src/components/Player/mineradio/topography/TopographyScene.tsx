import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { readAudioBands } from '../shared/AudioAnalyser'
import { getSonicAudioFrame } from '../shared/SonicAudioMonitor'
import type { CoverPalette } from '../lyrics/coverPalette'
import type { RenderPolicy } from '../shared/RenderPolicy'
import { gestureRotationState, tickGestureRotation } from '../particles/gestureRotationState'
import { orbitCameraState } from '../particles/orbitCameraState'
import {
  DEFAULT_FLOATING_BLOCK_COUNT,
  RIPPLE_LIFETIME,
  RIPPLE_SOFT_FADE_START,
  TOPOGRAPHY_WORLD_SCALE,
  TOPOGRAPHY_WORLD_Y,
  TOPOGRAPHY_WORLD_Z,
  applyGroundEqBandValue,
  clampAnimationBlend,
  DEFAULT_GROUND_BANDS,
  deriveKickFollowLowBands,
  deriveTerrainGridSettings,
  smoothstep01,
  topographyQualityFor,
} from './topographyConfig'
import {
  createTopographyFloatingBlockMaterial,
  createTopographyMapMaterial,
  type TopographyRippleSlot,
} from './topographyShader'
import { resolveTopographyTheme } from './topographyTheme'

const MAX_METEORS = 20
const MAX_PARTICLES = 200
const RIPPLE_COUNT = 10
/** 上游 DEFAULT_GROUND_MOTION_SPEED（preset:18），驱动 sonicTime 缩放时钟。 */
const GROUND_MOTION_SPEED = 50
/** 上游 meteorMat 混色用的常量白（preset:767）。 */
const WHITE = new THREE.Color('#ffffff')

/**
 * 地形辉光压制系数（用户观感调整，2026-09-21）。
 *
 * 上游 uGlowIntensity 公式出厂算得 ≈1.64，叠加顶面边缘 ×0.8、presence
 * 闪光等加项后整体观感偏亮。本项目在其上统一乘 0.78 压制 —— 这是**刻意
 * 偏离上游**的观感档（上游无此系数），只作用于 uGlowIntensity 汇聚点，
 * 涟漪/白色闪光/陨石等独立加项不受影响。若要恢复忠实还原，改回 1.0。
 */
const TOPOGRAPHY_GLOW_TRIM = 0.78

/**
 * 顶面「presence 闪光」压制系数（同一轮观感调整）。
 *
 * presence 直接乘进着色器 flashChance 与闪光强度，是最容易过曝的加项；
 * 压到 0.85 只削顶部随机闪光，snare 白色涟漪触发阈值走原始 sonic 值
 * （第 462 行的判定在 trim 之前），不受影响。
 */
const TOPOGRAPHY_PRESENCE_TRIM = 0.85
/** 陨石生成最小间隔（秒），上游 `sonic-topography-preset.js:864`。 */
const METEOR_SPAWN_INTERVAL = 0.55

/**
 * 悬浮方块尺寸链的出厂档位。
 *
 * 上游这些值来自 `fx-defaults.js`（不是 preset 文件里的 fallback 常量）：
 * intensity 36 / minSize 9 / maxSize 12 / speed 59。
 * 本项目暂未暴露这组滑杆，先取出厂值对齐观感。
 */
const FLOATING_INTENSITY = 36
const FLOATING_MIN_SIZE = 9
const FLOATING_MAX_SIZE = 12
/** 上游 speed 滑杆出厂 59；speedRate = lerp(3.0, 36.0, 59/100) = 22.47。 */
const FLOATING_SPEED = 59
const FLOATING_SPEED_RATE = THREE.MathUtils.lerp(3.0, 36.0, FLOATING_SPEED / 100)

interface TopographySceneProps {
  policy: RenderPolicy
  palette: CoverPalette | null
  accent: string | null
  /** 地形整体是否跟随拖拽旋转（与其它舞台元素保持一致的开关注入点） */
  motionEnabled: boolean
  /**
   * 把「点击涟漪」入口暴露给上层（CameraRig）。
   *
   * 上游在 mouseup 里直接调 `MineradioSonicTopography.pointerRipple`。
   * 本项目相机层与地形层是兄弟，因此通过这个回调把 addRipple 桥接出去。
   */
  onRippleReady?: (fn: (nx: number, nz: number, strength: number) => void) => void
}

interface MeteorSlot {
  active: boolean
  x: number
  y: number
  z: number
  speed: number
  strength: number
}

interface ParticleSlot {
  active: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  scale: number
}

/**
 * 「声波地形」舞台。
 *
 * 移植自 Mineradio `public/sonic-topography-preset.js`。它是一整片
 * instanced 方块地形，由 8 段频谱分别驱动不同形态的抬升：
 *
 *   subBass  → 中心区整体抬升
 *   bass     → 块状抬升
 *   lowMid   → 全图缓慢起伏
 *   mid      → 对角线"河流"
 *   highMid  → 外围随机尖刺
 *   presence / brilliance / air → 顶面闪光与边缘微光
 *
 * 音频来源复用本项目既有的 `readAudioBands`（只读旁路 AnalyserNode），
 * 因此不需要引入上游那套 galaxy 音频引擎，也不会碰到播放链路。
 */
export function TopographyScene({
  policy,
  palette,
  accent,
  motionEnabled,
  onRippleReady,
}: TopographySceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const floatingRef = useRef<THREE.InstancedMesh>(null)
  const meteorRef = useRef<THREE.InstancedMesh>(null)
  const particleRef = useRef<THREE.InstancedMesh>(null)
  const worldRef = useRef<THREE.Group>(null)
  const platterRef = useRef<THREE.Group>(null)
  /** autoYaw 累计角（上游 `state.autoYaw`），与拖拽的 boundRot 相加。 */
  const autoYawRef = useRef(0)
  /** 上游 `state.sonicTime`：按 motionSpeed 缩放的音乐时钟。 */
  const sonicTimeRef = useRef(0)

  const mapMaterial = useMemo(() => createTopographyMapMaterial(), [])
  const floatingMaterial = useMemo(() => createTopographyFloatingBlockMaterial(), [])
  // 陨石材质：颜色逐帧跟随主题（上游 meteorMat.color = warmCore 混白 70%）
  const meteorMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  // 拖尾材质：颜色逐帧跟随主题涟漪色（上游 trailMat.color.copy(ripple)，preset:768）
  const trailMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#33e6ff',
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )

  /**
   * 主题色只在封面/主色变化时重算。
   *
   * `resolveTopographyTheme` 内部会 new/clone 约十个 `THREE.Color`；此前它写在
   * 逐帧的 `useFrame` 里，60fps 下每秒产生数百次对象分配，造成 GC 抖动。
   * 主题本来只在切歌或换封面时变化，因此用 memo 固定下来。
   */
  const themeRef = useRef(resolveTopographyTheme(palette, accent))
  useEffect(() => {
    themeRef.current = resolveTopographyTheme(palette, accent)
  }, [palette, accent])

  // 地形密度按画质档推导；低画质档会显著降网格，保证移动端可用
  const quality = topographyQualityFor(policy)
  const density = policy.particleGrid >= 149 ? 62 : policy.particleGrid >= 100 ? 50 : 38
  const grid = useMemo(() => deriveTerrainGridSettings(density, quality), [density, quality])

  // 涟漪槽：Vector4(x, z, startTime, signedStrength)。
  //
  // 关键：这里拿的就是材质 uniforms 里那个**同一个数组引用**
  // （`mapMaterial.uniforms.uRipples.value`）。这样 `syncRippleUniforms`
  // 直接改元素即可上传，不需要逐帧重新赋值（重新赋值会让 three 重新
  // 建立 GPU 侧绑定，且改动 vec4 元素本身就已经标记了 needsUpdate）。
  const ripplesRef = useRef<TopographyRippleSlot[]>(
    mapMaterial.uniforms.uRipples.value as TopographyRippleSlot[],
  )
  const rippleIndexRef = useRef(0)
  /** CPU 侧记录每个槽的位置/强度/白/起始时间，用于逐帧回填带符号的 uniform。 */
  const rippleMetaRef = useRef(
    Array.from({ length: RIPPLE_COUNT }, () => ({
      x: 0,
      z: 0,
      strength: 0,
      white: false,
      start: -100,
    })),
  )

  const meteorsRef = useRef<MeteorSlot[]>(
    Array.from({ length: MAX_METEORS }, () => ({ active: false, x: 0, y: -1000, z: 0, speed: 0, strength: 0 })),
  )
  const meteorIndexRef = useRef(0)

  const particlesRef = useRef<ParticleSlot[]>(
    Array.from({ length: MAX_PARTICLES }, () => ({
      active: false,
      x: 0,
      y: -1000,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
      scale: 1,
    })),
  )
  const particleIndexRef = useRef(0)

  const smoothedRef = useRef({
    subBass: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    highMid: 0,
    presence: 0,
    brilliance: 0,
    air: 0,
  })
  const floatingPulseRef = useRef(0)
  /** 上升沿判定的"已触发"锁存（上游 lastKickActive / lastSnareActive）。 */
  const lastKickTriggerRef = useRef(false)
  const lastSnareTriggerRef = useRef(false)
  /** 陨石生成节气门（上游 `lastMeteorAt`，间隔 0.55s）。 */
  const lastMeteorAtRef = useRef(-Infinity)

  const floatingBlocks = useMemo(
    () =>
      Array.from({ length: DEFAULT_FLOATING_BLOCK_COUNT }, (_, index) => {
        const ring = index / DEFAULT_FLOATING_BLOCK_COUNT
        const angle = ring * Math.PI * 2 * 5.0 + Math.sin(index * 12.9898) * 0.7
        const radius = 14 + ((index * 37) % 62)
        const height = 6 + ((index * 17) % 19)
        return {
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          y: height,
          baseScale: 0.75 + ((index * 11) % 9) * 0.05,
          phase: index * 0.73,
          rotationSpeed: 0.18 + ((index * 7) % 10) * 0.035,
        }
      }),
    [],
  )

  const dummy = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      euler: new THREE.Euler(),
    }),
    [],
  )

  // 地形实例矩阵：一次铺好，之后只由着色器抬升，不逐帧改矩阵
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const offset = (grid.gridSize * grid.spacing) / 2
    let i = 0
    for (let x = 0; x < grid.gridSize; x++) {
      for (let z = 0; z < grid.gridSize; z++) {
        dummy.matrix.makeTranslation(x * grid.spacing - offset, 0.5, z * grid.spacing - offset)
        mesh.setMatrixAt(i, dummy.matrix)
        i++
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [grid.gridSize, grid.spacing, dummy])

  useEffect(
    () => () => {
      mapMaterial.dispose()
      floatingMaterial.dispose()
    },
    [mapMaterial, floatingMaterial],
  )

  /**
   * 写入一道涟漪（上游 `addRipple`，sonic-topography-preset.js:851-860）。
   *
   * 强度夹在 [0.1, 3.0]，按环形索引覆盖最旧的槽。
   */
  const addRipple = (x: number, z: number, strength: number, isWhite = false) => {
    const idx = rippleIndexRef.current
    const meta = rippleMetaRef.current[idx]
    meta.x = x
    meta.z = z
    meta.strength = Math.max(0.1, Math.min(3.0, strength))
    meta.white = isWhite
    // 上游 `r.start = state.sonicTime`（preset:856）—— 必须与 syncRippleUniforms
    // 里的 `time`（sonicTime 时钟）同源，否则 age 计算错位、涟漪提前消失。
    meta.start = sonicTimeRef.current
    rippleIndexRef.current = (idx + 1) % RIPPLE_COUNT
  }

  /**
   * 把 CPU 侧涟漪状态回填到 uniform（上游 `syncRippleUniforms`，
   * sonic-topography-preset.js:833-849）。
   *
   * 死槽必须写成 `(0, 0, -100, 0)`：着色器靠 `rd.w != 0.0` 判活，
   * 若不回收，槽位会永远保持 isActive，远处残留一圈永不消退的涟漪。
   * 同时按寿命做 JS 侧的软淡出（2.1s 起，4.8s 归零）。
   */
  const syncRippleUniforms = (time: number) => {
    const slots = ripplesRef.current
    const metas = rippleMetaRef.current
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const meta = metas[i]
      const age = time - meta.start
      const active = meta.strength > 0.001 && age >= 0 && age < RIPPLE_LIFETIME
      if (!active) {
        slots[i].set(0, 0, -100, 0)
        if (meta.strength > 0) meta.strength = 0
        continue
      }
      const fade = 1 - smoothstep01((age - RIPPLE_SOFT_FADE_START) / (RIPPLE_LIFETIME - RIPPLE_SOFT_FADE_START))
      const strength = meta.strength * fade
      slots[i].set(meta.x, meta.z, meta.start, meta.white ? -strength : strength)
    }
  }

  // 把点击涟漪入口交给上层（上游 mouseup → pointerRipple → addRipple）。
  // 卸载时清空引用，避免桥接到已卸载的场景。
  useEffect(() => {
    if (!onRippleReady) return
    onRippleReady((nx, nz, strength) => addRipple(nx, nz, strength, false))
    return () => onRippleReady(() => {})
    // addRipple 是稳定闭包（只读 ref），依赖无需扩展
  }, [onRippleReady])

  const spawnParticle = (x: number, y: number, z: number, speedMultiplier: number) => {
    const idx = particleIndexRef.current
    const p = particlesRef.current[idx]
    p.active = true
    p.x = x + (Math.random() - 0.5) * 1.5
    p.y = y + (Math.random() - 0.5) * 1.5
    p.z = z + (Math.random() - 0.5) * 1.5
    p.vx = (Math.random() - 0.5) * 2.0
    p.vy = Math.random() * 2.0 + speedMultiplier * 10.0
    p.vz = (Math.random() - 0.5) * 2.0
    p.life = 0
    p.maxLife = 0.5 + Math.random() * 0.5
    p.scale = Math.random() * 0.6 + 0.2
    particleIndexRef.current = (idx + 1) % MAX_PARTICLES
  }

  const addMeteor = (strength: number) => {
    // 生成节气门：上游 `if (now - state.lastMeteorAt < 0.55) return`
    // （preset:864-865），时钟取 **sonicTime**（缩放时钟）而非真实时间。
    const now = sonicTimeRef.current
    if (now - lastMeteorAtRef.current < METEOR_SPAWN_INTERVAL) return
    lastMeteorAtRef.current = now

    const idx = meteorIndexRef.current
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * 25
    const m = meteorsRef.current[idx]
    m.active = true
    m.x = Math.cos(angle) * dist
    m.z = Math.sin(angle) * dist
    m.y = 30 + Math.random() * 10
    m.speed = 1.0 + Math.random() * 0.5 + strength * 1.5
    m.strength = strength
    meteorIndexRef.current = (idx + 1) % MAX_METEORS
  }

  /* eslint-disable react-hooks/immutability -- Three.js 场景对象是渲染循环的可变句柄。 */
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20)
    // ★ 上游的「音乐时间」：sonicTime 以 dt*(0.45 + motionSpeed*0.017) 推进，
    //   出厂 motionSpeed=50 → 每秒推进 1.30 个 sonicTime 单位。涟漪起点、
    //   悬浮方块的 bob/自转都用它 —— 所以本项目的 time 也要用同一条
    //   缩放时钟，否则方块律动比上游慢 30%。
    //   陨石下落仍用真实 dt（上游 updateMeteorsAndTrails(dt) 同样如此）。
    sonicTimeRef.current += delta * (0.45 + GROUND_MOTION_SPEED * 0.017)
    const time = sonicTimeRef.current

    // ---- autoYaw 自转 + 共享旋转绑定 ----
    //
    // 上游 `updateSonicRotation`（sonic-topography-preset.js:686-695）：
    //   speed = lerp(0, 0.30, autoRotate/100) * clamp(fx.speed, 0.35, 1.8)
    //   拖拽中（orbit.rotating）speed *= 0.35
    //   state.autoYaw += dt * speed
    //
    // 并且地形读主粒子层的 rotation 作为自己的姿态基准
    //   （`bindVisualRotation`：root.rotation.x = boundRotX;
    //     root.rotation.y = boundRotY + autoYaw），
    // 因此地形与粒子/歌词共享同一套旋转，而不是各转各的。
    // 拖拽惯性：地形模式下 ParticleField 未挂载，因此由这里推进
    // （上游里 tickGestureRotation 是全局主循环的一部分，每帧都跑）。
    tickGestureRotation(delta)

    if (platterRef.current) {
      if (motionEnabled) {
        const autoRotate = 0.5 // 上游默认 sonicGroundAutoRotate = 50/100
        // 上游第二因子是 `clamp(fx.speed, 0.35, 1.8)`（preset:689）。fx.speed
        // 是全局运动速度滑杆（04-fx-defaults.js:15 出厂 1.0），本项目未暴露
        // 该滑杆，恒取出厂 1.0 —— clamp(1, 0.35, 1.8) = 1.0，故此处写死 1.0
        // 与上游等价。若未来暴露 fx.speed 滑杆，这里必须同步接上。
        let speed = THREE.MathUtils.lerp(0, 0.3, autoRotate) * 1.0
        if (orbitCameraState.rotating) speed *= 0.35
        autoYawRef.current += delta * speed
      }
      // boundRot 语义同上游 `visualRotation`：地形姿态跟随拖拽手势。
      //
      // 上游读的是 `particles.rotation`（隐藏但仍推进）。本项目里地形与
      // 粒子层互斥挂载，没有粒子对象，因此直接读 gestureRotation 单例——
      // 它正是 ParticleField 写入 .rotation 的那个来源，语义等价。
      // 地形模式下 centerLocked 时归零，与粒子层保持同一门控。
      const locked = orbitCameraState.centerLocked
      const boundRotX = locked ? 0 : gestureRotationState.x
      const boundRotY = locked ? 0 : gestureRotationState.y
      platterRef.current.rotation.x = boundRotX
      platterRef.current.rotation.y = boundRotY + autoYawRef.current
      platterRef.current.rotation.z = 0
    }

    const bands = readAudioBands()
    // 八频段直接来自上游定义的 Hz 边界（见 AudioAnalyser.SONIC_BAND_EDGES），
    // 不再用六段 RMS 聚合后再"猜想"对应关系。
    const sonic = bands.sonic
    // ★ kick 包络直接取音频引擎的产出（上游 `readMineradioAudio` 的
    //   `kickEnvelope` 就是引擎给的）。引擎内部已经做了：节拍窗口加权 RMS、
    //   90 帧自适应阈值、drumGate、快攻 42/s 慢放 11.5/s 的包络。
    //   此前本项目在本地又跑一遍 `stepKickEnvelope`，且喂的是普通均值
    //   `bands.kickCore`，导致鼓点既弱又迟钝。
    const monitorFrame = getSonicAudioFrame()
    const kickEnvelopeValue = monitorFrame?.kickEnvelope ?? 0

    // ---- 涟漪/陨石触发（上游 updateAudioTriggers，preset:895-911）----
    //
    // 用**上升沿**判定，而不是每帧只要超阈值就触发：
    //   kick  : kickEnvelope > 0.58 → 彩色涟漪；回落到 0.32 以下才重新武装
    //   snare : presence > 0.52 或 brilliance > 0.56 → 白色涟漪
    //           （回落到 0.38/0.42 以下重新武装），且有 0.55 概率过滤
    const kickActive = kickEnvelopeValue > 0.58
    if (kickActive && !lastKickTriggerRef.current) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * 20
      addRipple(
        Math.cos(angle) * dist,
        Math.sin(angle) * dist,
        Math.min(kickEnvelopeValue * 2.0, 3.0),
        false,
      )
    }
    lastKickTriggerRef.current = kickEnvelopeValue > 0.32

    const snareActive = sonic.presence > 0.52 || sonic.brilliance > 0.56
    if (snareActive && !lastSnareTriggerRef.current && Math.random() < 0.55) {
      const angle = Math.random() * Math.PI * 2
      const dist = 10 + Math.random() * 35
      addRipple(
        Math.cos(angle) * dist,
        Math.sin(angle) * dist,
        Math.min((sonic.presence + sonic.brilliance) * 1.2, 3.0),
        true,
      )
    }
    lastSnareTriggerRef.current = sonic.presence > 0.38 || sonic.brilliance > 0.42

    // 逐频段 EQ（上游 `applyGroundEqBandValue` + `DEFAULT_GROUND_BANDS`）。
    // 低端出厂被抬到 90/92 → ×2.44/×2.51，是鼓点抬升量的主要来源；
    // 此前完全缺失这一步，等于低端少了一半响应。
    const eq = DEFAULT_GROUND_BANDS
    const low = deriveKickFollowLowBands({
      kickEnvelope: kickEnvelopeValue,
      subBassEnergy: sonic.subBass,
      bassEnergy: sonic.bass,
    })

    const responseRate = THREE.MathUtils.lerp(2.2, 60, 0.5)
    const blend = clampAnimationBlend(1 - Math.exp(-responseRate * delta))
    const smoothed = smoothedRef.current
    smoothed.subBass = THREE.MathUtils.lerp(smoothed.subBass, low.subBass, blend)
    smoothed.bass = THREE.MathUtils.lerp(smoothed.bass, low.bass, blend)
    smoothed.lowMid = THREE.MathUtils.lerp(smoothed.lowMid, applyGroundEqBandValue(sonic.lowMid, eq, 2), blend)
    smoothed.mid = THREE.MathUtils.lerp(smoothed.mid, applyGroundEqBandValue(sonic.mid, eq, 3), blend)
    smoothed.highMid = THREE.MathUtils.lerp(smoothed.highMid, applyGroundEqBandValue(sonic.highMid, eq, 4), blend)
    smoothed.presence = THREE.MathUtils.lerp(smoothed.presence, applyGroundEqBandValue(sonic.presence, eq, 5), blend)
    smoothed.brilliance = THREE.MathUtils.lerp(
      smoothed.brilliance,
      applyGroundEqBandValue(sonic.brilliance, eq, 6),
      blend,
    )
    smoothed.air = THREE.MathUtils.lerp(smoothed.air, applyGroundEqBandValue(sonic.air, eq, 7), blend)

    const u = mapMaterial.uniforms
    const theme = themeRef.current
    const colorBlend = clampAnimationBlend(3.0 * delta)

    for (const key of [
      'uBaseColor1',
      'uBaseColor2',
      'uFogColor',
      'uCoolCore',
      'uCoolEdge',
      'uWarmCore',
      'uWarmEdge',
      'uRippleColor',
    ] as const) {
      ;(u[key].value as THREE.Color).lerp(theme[key], colorBlend)
    }
    u.uGlowIntensity.value = THREE.MathUtils.lerp(
      u.uGlowIntensity.value as number,
      theme.uGlowIntensity * TOPOGRAPHY_GLOW_TRIM,
      colorBlend,
    )
    // 陨石颜色跟随主题（上游 preset:767：warmCore lerp 白 0.7）
    meteorMaterial.color.copy(theme.uWarmCore).lerp(WHITE, 0.7)
    // 拖尾颜色跟随主题涟漪色（上游 preset:768：trailMat.color.copy(ripple)）。
    // 此前写死 #a8ecff，与封面联动后拖尾色和涟漪/地形主色脱节。
    trailMaterial.color.copy(theme.uRippleColor)

    u.uTime.value = time
    u.uSubBass.value = smoothed.subBass
    u.uBass.value = smoothed.bass
    u.uLowMid.value = smoothed.lowMid
    u.uMid.value = smoothed.mid
    u.uHighMid.value = smoothed.highMid
    u.uPresence.value = smoothed.presence * TOPOGRAPHY_PRESENCE_TRIM
    u.uBrilliance.value = smoothed.brilliance
    u.uAir.value = smoothed.air
    // EQ 平均值参与 uEnergy 与 uAmplitude 的缩放（上游 preset:788-790）
    const eqAvg = eq.reduce((sum, v) => sum + v, 0) / eq.length
    // 上游：uEnergy = clamp01(energy * (0.25 + eqAvg/50*0.75))
    u.uEnergy.value = clampAnimationBlend(
      (monitorFrame?.energy ?? bands.energy) * (0.25 + (eqAvg / 50) * 0.75),
    )
    // uSmoothness / uDensity 由音频**引擎**推导（上游 frame 直接给出），
    // 不再本地硬编码，也不再重复推导。
    u.uSmoothness.value = monitorFrame?.smoothness ?? 0.5
    u.uDensity.value = monitorFrame?.density ?? 0.5
    // 上游：amplitude<=50 时 ampMul = amplitude/50；>50 时 1+((a-50)/50)²*14。
    // 出厂 amplitude=50 → 1.0。本项目暂未暴露该滑杆，取出厂值。
    const amplitude = 50
    u.uAmplitude.value =
      amplitude <= 50 ? amplitude / 50 : 1 + Math.pow((amplitude - 50) / 50, 2) * 14

    const total = smoothed.subBass + smoothed.bass + smoothed.lowMid + smoothed.mid
    const high = smoothed.presence + smoothed.brilliance + smoothed.air
    u.uWarmth.value = total / Math.max(0.001, total + high)
    u.uBrightness.value = high / Math.max(0.001, total + high)
    // 上游：sharpness = brightness*0.42 + snap*0.14 + kickOnset*0.28
    u.uSharpness.value =
      (monitorFrame?.brightness ?? 0) * 0.42 + (monitorFrame?.snap ?? 0) * 0.14 + (monitorFrame?.kickOnset ?? 0) * 0.28
    // 涟漪：先把 CPU 状态回填进 uniform（含死槽回收与软淡出），
    // uniform 数组本身是同一个引用，因此不需要重新赋值。
    syncRippleUniforms(time)

    // 悬浮方块：整块随踢鼓脉冲放大
    const floatingMesh = floatingRef.current
    if (floatingMesh) {
      // 上游 speed 出厂 59（FLOATING_SPEED），speedRate = lerp(3, 36, 59/100) = 22.47
      const pulseBlend = clampAnimationBlend(1 - Math.exp(-FLOATING_SPEED_RATE * delta))
      floatingPulseRef.current = THREE.MathUtils.lerp(
        floatingPulseRef.current,
        kickEnvelopeValue,
        pulseBlend,
      )
      const pulse = floatingPulseRef.current
      floatingMaterial.uniforms.uTime.value = time
      floatingMaterial.uniforms.uPulse.value = pulse
      for (const key of [
        'uBaseColor1',
        'uBaseColor2',
        'uFogColor',
        'uCoolCore',
        'uCoolEdge',
        'uWarmCore',
        'uWarmEdge',
        'uRippleColor',
      ] as const) {
        ;(floatingMaterial.uniforms[key].value as THREE.Color).copy(u[key].value as THREE.Color)
      }
      floatingMaterial.uniforms.uGlowIntensity.value = u.uGlowIntensity.value
      floatingMaterial.uniforms.uWarmth.value = u.uWarmth.value
      floatingMaterial.uniforms.uBrightness.value = u.uBrightness.value
      floatingMaterial.uniforms.uSharpness.value = u.uSharpness.value

      // 悬浮方块尺寸链（上游 updateFloatingBlocks，preset:913-944）：
      //   speedRate      = lerp(3.0, 36.0, speed/100)   ← speed 59 → 22.47
      //   pulseBlend     = 1 - exp(-speedRate*dt)
      //   minVisualScale = lerp(0.12, 0.75, minSize/100)
      //   maxVisualScale = max(min+0.05, lerp(0.45, 3.2, maxSize/100))
      //   sizeMix        = clamp(pulse * (0.5 + intensity*1.7), 0, 1)
      //   pulseScale     = lerp(minVisualScale, maxVisualScale, sizeMix)
      // 此前直接用 lerp(0.5, 1.6, pulse)，忽略了整条尺寸链，方块起伏不明显；
      // 脉冲跟随率也写死 18（上游 speed=59 应为 22.47），鼓点胀缩偏慢。
      const minVisualScale = THREE.MathUtils.lerp(0.12, 0.75, FLOATING_MIN_SIZE / 100)
      const maxVisualScale = Math.max(
        minVisualScale + 0.05,
        THREE.MathUtils.lerp(0.45, 3.2, FLOATING_MAX_SIZE / 100),
      )
      const sizeMix = Math.max(
        0,
        Math.min(1, pulse * (0.5 + (FLOATING_INTENSITY / 100) * 1.7)),
      )
      const pulseScale = THREE.MathUtils.lerp(minVisualScale, maxVisualScale, sizeMix)
      const pulseLift = pulse * (FLOATING_INTENSITY / 100) * 1.4

      for (let i = 0; i < floatingBlocks.length; i++) {
        const block = floatingBlocks[i]
        const bob = Math.sin(time * (0.55 + block.rotationSpeed) + block.phase) * 0.45
        dummy.position.set(block.x, block.y + bob + pulseLift, block.z)
        dummy.euler.set(
          time * block.rotationSpeed + block.phase,
          time * block.rotationSpeed * 0.7 + block.phase,
          time * block.rotationSpeed * 0.45,
        )
        dummy.quaternion.setFromEuler(dummy.euler)
        const scale = block.baseScale * pulseScale
        dummy.scale.setScalar(scale)
        dummy.matrix.compose(dummy.position, dummy.quaternion, dummy.scale)
        floatingMesh.setMatrixAt(i, dummy.matrix)
      }
      floatingMesh.instanceMatrix.needsUpdate = true
    }

    // 陨石
    const meteorMesh = meteorRef.current
    if (meteorMesh) {
      for (let i = 0; i < MAX_METEORS; i++) {
        const m = meteorsRef.current[i]
        if (!m.active) {
          dummy.position.set(0, -1000, 0)
          dummy.scale.setScalar(0)
          dummy.quaternion.identity()
          dummy.matrix.compose(dummy.position, dummy.quaternion, dummy.scale)
          meteorMesh.setMatrixAt(i, dummy.matrix)
          continue
        }
        m.y -= m.speed * 60 * delta
        if (m.y <= 0) {
          // 命中地面：涟漪 + 拖尾爆发，实例当场隐藏（上游把 pos/scale 归零后
          // 走 else 渲染路径 —— 此前本项目命中后仍以满尺寸多画一帧，
          // 落点会闪出一个贴地白块）。
          m.active = false
          addRipple(m.x, m.z, Math.min(m.strength, 1.2), true)
          for (let p = 0; p < 10; p++) spawnParticle(m.x, 0.5, m.z, m.speed * 1.5)
          dummy.position.set(0, -1000, 0)
          dummy.scale.setScalar(0)
          dummy.quaternion.identity()
          dummy.matrix.compose(dummy.position, dummy.quaternion, dummy.scale)
          meteorMesh.setMatrixAt(i, dummy.matrix)
          continue
        }
        // 下落途中按上游概率沿途撒拖尾（上游 `Math.random() > 0.3`，
        // 即每帧 70% 概率；此前只在命中后一次性生成，下落轨迹没有拖尾）
        if (Math.random() > 0.3) spawnParticle(m.x, m.y, m.z, m.speed * 0.2)
        dummy.position.set(m.x, Math.max(0, m.y), m.z)
        dummy.scale.setScalar(1.5)
        dummy.quaternion.identity()
        dummy.matrix.compose(dummy.position, dummy.quaternion, dummy.scale)
        meteorMesh.setMatrixAt(i, dummy.matrix)
      }
      meteorMesh.instanceMatrix.needsUpdate = true
    }

    // 陨石拖尾粒子
    const particleMesh = particleRef.current
    if (particleMesh) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particlesRef.current[i]
        if (!p.active) {
          dummy.position.set(0, -1000, 0)
          dummy.scale.setScalar(0)
        } else {
          p.life += delta
          if (p.life >= p.maxLife) {
            p.active = false
            dummy.scale.setScalar(0)
          } else {
            p.x += p.vx * delta * 10
            p.y += p.vy * delta * 10
            p.z += p.vz * delta * 10
            dummy.scale.setScalar(p.scale * (1 - p.life / p.maxLife))
          }
          dummy.position.set(p.x, p.y, p.z)
        }
        dummy.quaternion.identity()
        dummy.matrix.compose(dummy.position, dummy.quaternion, dummy.scale)
        particleMesh.setMatrixAt(i, dummy.matrix)
      }
      particleMesh.instanceMatrix.needsUpdate = true
    }

    // 陨石由强节拍触发（上游 Meteor 触发器，preset:910）
    if (kickEnvelopeValue > 0.62 && Math.random() < 0.045) {
      addMeteor(Math.max(0.28, Math.min(0.9, kickEnvelopeValue)))
    }
  })
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      {/* ★ 不设场景级 <fog>：上游全工程没有 scene.fog（大气感全部在地形
          shader 内部的 aerialFog，preset:496/831）。场景雾只影响
          MeshBasicMaterial —— 陨石/拖尾出生在 30-40 高度，被 near=2.88 的
          雾完全压黑，观感是"凭空浮现的暗块"而不是"从天上掉下来的陨石"。
          ParticleScene 的全局雾（near 14）在地形模式下也会压暗它们，已由
          上游无雾事实统一移除（见 ParticleScene）。 */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={1} />

      {/* 168 单位的地形整体缩进主场景：相机推拉会同时作用在
          地形、歌词与 3D 卡片上，保持中央构图。 */}
      <group ref={worldRef} position={[0, TOPOGRAPHY_WORLD_Y, TOPOGRAPHY_WORLD_Z]} scale={TOPOGRAPHY_WORLD_SCALE}>
        <group ref={platterRef}>
          <instancedMesh
            key={grid.gridSize}
            ref={meshRef}
            args={[undefined, undefined, grid.instanceCount]}
            frustumCulled={false}
          >
            <boxGeometry args={[grid.boxWidth, 1, grid.boxWidth]} />
            <primitive object={mapMaterial} attach="material" />
          </instancedMesh>

          <instancedMesh
            ref={floatingRef}
            args={[undefined, undefined, floatingBlocks.length]}
            frustumCulled={false}
          >
            <boxGeometry args={[1, 1, 1]} />
            <primitive object={floatingMaterial} attach="material" />
          </instancedMesh>

          <instancedMesh ref={meteorRef} args={[undefined, undefined, MAX_METEORS]} frustumCulled={false}>
            <boxGeometry args={[0.4, 1.2, 0.4]} />
            {/* 上游陨石色 = warmCore 混白 70%（preset:767），动态取自主题 */}
            <primitive object={meteorMaterial} attach="material" />
          </instancedMesh>

          <instancedMesh ref={particleRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
            <boxGeometry args={[0.8, 0.8, 0.8]} />
            {/* 上游拖尾材质（preset:723 + 768）：MeshBasicMaterial，颜色逐帧
                copy 主题涟漪色 —— 见上方 trailMaterial 同步处 */}
            <primitive object={trailMaterial} attach="material" />
          </instancedMesh>
        </group>
      </group>
    </>
  )
}
