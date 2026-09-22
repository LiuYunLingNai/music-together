import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { usePlayerStore } from '@/stores/playerStore'
import { lyricPlayerBridge } from '@/lib/lyricPlayerBridge'
import type { VisualModeId } from '../shared/VisualMode'
import { consumePrimeCamPunch, stepBeatCameraFrame } from './beatCamera'
import { applyParticleSpinDrag, lyricWorldPos } from './gestureRotationState'
import { isPointerOverShelfCard } from './shelfHitRegistry'
import { stageProjectionShiftX, stepStageSafeArea } from './stageSafeArea'
import {
  MAX_PHI,
  MAX_RADIUS,
  MIN_PHI,
  MIN_RADIUS,
  SHELF_CAMERA_SPEED,
  boostCameraPunch,
  clampOrbit,
  orbitCameraState,
  recenterCamera,
  resetCameraPunch,
  setOrbitMode,
  shortestAngleDelta,
  tickCameraPunch,
  tickShelfFocusExitSettled,
  unlockCenteredView,
} from './orbitCameraState'

/** 拖动超过该像素数视为 drag（上游 `CLICK_THRESHOLD`）。 */
const CLICK_THRESHOLD = 6

/**
 * UI 命中检测（上游 `isPointerOverUi`）。
 *
 * 上游用一个 `UI_HIT_SELECTOR` 列出所有 HUD 容器，再 `closest()`。
 * 本项目里画布是唯一的全屏层，HUD 都是它的兄弟节点，因此这里用
 * 「命中点是否落在画布自身」来判断：落在画布上才是舞台交互。
 */
function isPointerOverUi(event: { clientX: number; clientY: number }): boolean {
  if (typeof document === 'undefined') return false
  const el = document.elementFromPoint(event.clientX, event.clientY)
  if (!el) return false
  return !el.closest('.mt-mineradio-canvas-layer')
}

interface CameraRigProps {
  mode: VisualModeId
  enabled?: boolean
  /**
   * 画布点击（未拖拽）回调：把归一化舞台坐标与按压强度交给地形涟漪。
   *
   * 上游在 mouseup 里直接调 `MineradioSonicTopography.pointerRipple(nx, nz, strength)`。
   * 本项目里地形是 ParticleScene 的兄弟层，因此回调由上层注入。
   */
  onCanvasClick?: (nx: number, nz: number, strength: number) => void
}

/**
 * OpenMusic/Mineradio 同构的统一轨道、闲置电影运镜与节拍推拉。
 *
 * 相机只能有**一个** `useFrame` 写入者，否则多套姿态会互相覆盖。
 * 本组件是唯一的相机写入者。
 */
export function CameraRig({ mode, enabled = true, onCanvasClick }: CameraRigProps) {
  const { camera, gl } = useThree()
  const cinemaTimeRef = useRef(0)

  /** 拖拽会话：记录按下点、上一帧位置与时间，用于判定 drag 并计算 spinDt。 */
  const dragRef = useRef<{
    lastX: number
    lastY: number
    lastT: number
    downX: number
    downY: number
    downT: number
    hadDrag: boolean
  } | null>(null)

  /** 回调走 ref，避免因回调身份变化重挂全部原生监听器。 */
  const onCanvasClickRef = useRef(onCanvasClick)
  onCanvasClickRef.current = onCanvasClick

  /** 看向歌词时的复用缓冲（上游 SONIC_CAMERA_LYRIC_LOOK_AT）。 */
  const lyricLookAtRef = useRef(new THREE.Vector3())

  useEffect(() => setOrbitMode(mode), [mode])

  useEffect(() => {
    const canvas = gl.domElement
    const state = orbitCameraState

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) return
      // 上游 `beginParticlePointerDrag`（00-pointer-cover-particles.js:71-84）：
      //   1. 命中 UI 时不启动拖拽
      //   2. 解除「锁在基准」（让闲置漂移停在被拖开的位置附近）
      //   3. 只置 rotating，**不动相机姿态**
      if (isPointerOverUi(event)) return
      unlockCenteredView()
      state.rotating = true
      state.lastX = event.clientX
      state.lastY = event.clientY
      dragRef.current = {
        lastX: event.clientX,
        lastY: event.clientY,
        lastT: performance.now(),
        downX: event.clientX,
        downY: event.clientY,
        downT: performance.now(),
        hadDrag: false,
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      // 歌单架热区需要持续读取指针位置（悬停判定不依赖射线命中）。
      state.pointerSlot = { x: event.clientX, y: event.clientY }
      if (!state.rotating) return

      const drag = dragRef.current
      if (!drag) return

      // ★ 拖拽转的是**物体组**，不是相机（上游禁止 applyOrbitPointerDrag）。
      //   上游 mousemove 分支：unlockCenteredView() 后 applyParticleSpinDrag()。
      const now = performance.now()
      const dx = event.clientX - drag.lastX
      const dy = event.clientY - drag.lastY
      const spinDt = Math.max(1 / 120, Math.min(0.08, (now - drag.lastT) / 1000 || 1 / 60))
      applyParticleSpinDrag(dx, dy, spinDt)
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      drag.lastT = now

      // 拖动超过 6px 视为 drag（上游 CLICK_THRESHOLD），据此抑制点击涟漪
      const totalDx = event.clientX - drag.downX
      const totalDy = event.clientY - drag.downY
      if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > CLICK_THRESHOLD) drag.hadDrag = true

      // 拖拽只解除基准锁；**不**清除跟拍（上游拖拽不碰 focus）
      //
      // ★ 但必须**取消进行中的回正**（上游 `00-pointer-cover-particles.js:135`：
      //   `if (orbit.recentering) orbit.recentering = false`）。否则用户双击回正
      //   后立刻拖动，recentering 分支每帧仍把 userTheta/Phi/Radius 往基准拉，
      //   与拖拽互相角力 —— 表现为"回正过程中拖不动"。
      if (state.recentering) state.recentering = false
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!state.rotating) return
      state.rotating = false
      const drag = dragRef.current
      dragRef.current = null

      // ★ 上游 mouseup **不**回正相机、**不**重置物体旋转 —— 物体靠惯性滑行。
      //   这里唯一要做的是：地形模式下，未发生拖拽的点击生成一道涟漪。
      if (drag && !drag.hadDrag && !isPointerOverUi(event) && onCanvasClickRef.current) {
        const pressMs = Math.max(0, performance.now() - drag.downT)
        const strength = Math.min(0.25 + (pressMs / 1000) * 2.6, 3.0)
        const nx = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 34
        const nz = (0.5 - event.clientY / Math.max(1, window.innerHeight)) * 34
        onCanvasClickRef.current(nx, nz, strength)
      }
    }
    const onPointerLeave = () => {
      state.pointerSlot = null
    }
    const onWheel = (event: WheelEvent) => {
      // 上游 wheel：命中 UI 时忽略；preventDefault（非被动监听）。
      if (isPointerOverUi(event)) return
      event.preventDefault()
      unlockCenteredView()
      state.userRadius += event.deltaY * 0.005
      state.focus.active = false
      state.focus.type = null
      // 同上：滚轮也要取消回正（上游 :173），否则缩放被回正缓动抵消
      if (state.recentering) state.recentering = false
      clampOrbit()
    }
    // 双击画布回正（上游 `dblclick → recenterCamera()`）。
    // 上游在回正前先对歌单架卡片做射线测试（00-pointer-cover-particles.js:177-191），
    // 命中卡片则直接 return —— 否则双击卡片会误触相机回正、清掉物体旋转。
    // 卡片 mesh 在 FloatingSongShelf（兄弟组件），命中判定经注册表桥接。
    const onDoubleClick = (event: MouseEvent) => {
      if (isPointerOverUi(event)) return
      if (isPointerOverShelfCard(event.clientX, event.clientY)) return
      recenterCamera()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDoubleClick)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDoubleClick)
      // ★ 卸载清理（orbitCameraState 是模块级单例，红线 22）：
      //   拖拽中途卸载时 rotating 会残留；姿态偏移也一并回基准，
      //   重进视觉模式时相机从基线开始而不是停在用户上次拖到的位置。
      state.rotating = false
      state.centerLocked = true
      state.recentering = false
      state.recenterStartedAt = 0
      state.userTheta = state.baselineTheta
      state.userPhi = state.baselinePhi
      state.userRadius = state.baselineRadius
      state.theta = state.baselineTheta
      state.phi = state.baselinePhi
      state.radius = state.baselineRadius
      // camPunch 同属模块级状态：不复位则残留的镜头前推会带进下次进入
      // 视觉模式（卸载期间无人衰减它，见 resetCameraPunch 说明）。
      resetCameraPunch()
    }
  }, [gl])

  /* eslint-disable react-hooks/immutability -- R3F camera objects are mutable render-loop handles. */
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20)
    cinemaTimeRef.current += delta
    const state = orbitCameraState
    const player = usePlayerStore.getState()

    // ★ 节拍冲击改由**事件调度器**给出（`beatCamera.ts`）。
    //
    //   上游不是"命中即踢一脚"，而是把每次命中排成带 `attack/hold/release`
    //   包络的事件，逐帧对**所有在飞事件**求包络、取最强者为 lead，再按
    //   `combo`（downbeat/push/drop/rebound/accent）分配
    //   radius/phi/roll —— 每一拍的形态因此不同，并有整曲自适应振幅。
    //
    //   此前本项目是"4 个常数 + 指数衰减"（`kick.phi = max(kick.phi, 0.0048)`
    //   等），于是**每一拍看起来都一样**，抒情歌与炸歌完全相同。
    //
    //   ★ 仍然是**单点驱动**（红线 33）：包络求值在这里（每帧一次，与上游
    //     `updateCinema(dt)` 的调用位置一致）；①④ 两步（引擎与整曲自适应）
    //     在 `AudioStepDriver` 里按**音频分析频率**推进（上游把它们放在
    //     `if (audioStepDt > 0)` 之内）—— 分频是**正确性**要求，见
    //     `stepBeatCameraAudio` 的说明。
    //
    //   注意 `enabled`（节拍相机开关）关闭时传 `playing=false`，让包络
    //   照常衰减到 0，避免关掉开关后镜头仍停在上一拍的推镜上。
    //
    //   ★ 时钟必须用**逐帧**的 `getFrameTime()`，不能用 `player.currentTime`
    //     （第三十四轮修，§5.4 B1）。后者被 `useHowl` 按
    //     `CURRENT_TIME_THROTTLE_MS = 100` 节流成 **10Hz**，而上游读的是
    //     逐帧精确的 `audio.currentTime`（`02-beat-camera-runtime.js:921`）。
    //
    //     10Hz 的量化步长（100ms）比包络的 `attack`（14–38ms）**还长**，
    //     于是攻击段实际退化成"一步到位"；`lockedWindow`（70–110ms）也与
    //     量化步长同量级，节奏接受判定会被量化误差干扰。
    //
    //     同一个时钟歌词侧已在用（第 31 轮为"10Hz 不流畅"专门加的），
    //     节拍相机此前漏了 —— 同一个问题只修了一半。
    //     取不到时（未起播 / 已停止）回退到 store 值，行为与之前一致。
    const frameTime = lyricPlayerBridge.getFrameTime()
    const audioClock = frameTime === null ? player.currentTime : frameTime
    const kick = stepBeatCameraFrame(delta, audioClock, player.isPlaying && enabled)

    // ★ 切歌入场推镜的 `camPunch` 抬高（§5.4 A8）。
    //   上游 `primeCinemaAfterTrackStart` 会 `camPunch = max(camPunch, 0.11)`
    //   配合 `punch/radiusKick/phiKick` 打一记入场冲击。`camPunch` 住在
    //   `orbitCameraState`，而 `beatCamera` 不反向依赖相机模块 —— 因此由
    //   它暴露一个**一次性**的待消费值，在这里取走（读后清零）。
    if (enabled) {
      const primePunch = consumePrimeCamPunch()
      if (primePunch > 0) boostCameraPunch(primePunch)
    }

    // theta（环绕角）在普通曲目上恒为 0：上游只在 `leadEvent.dj` 为真时累加
    // thetaKick，而 `djMode.active` 出厂 false 且只对直播/DJ 音源为真。
    // 本项目无直播音源，故 `kick.thetaKick` 恒为 0 —— 保留读取以对齐上游合成式。

    // ---- 回正：向基准姿态平滑收敛（上游 updateCamera 的 recentering 分支）----
    if (state.recentering) {
      const thetaDelta = shortestAngleDelta(state.userTheta, state.baselineTheta)
      const phiDelta = state.baselinePhi - state.userPhi
      const radiusDelta = state.baselineRadius - state.userRadius
      const distance = Math.sqrt(
        thetaDelta * thetaDelta + phiDelta * phiDelta + Math.pow(radiusDelta / Math.max(1, state.baselineRadius), 2),
      )
      // 上游：ease 随偏离量增大而略增，夹在 [0.052, 0.135]
      const ease = Math.max(0.05 + distance * 0.08, 0.052)
      const clampedEase = Math.min(0.135, ease)
      state.userTheta += thetaDelta * clampedEase
      state.userPhi += phiDelta * clampedEase
      state.userRadius += radiusDelta * clampedEase

      // 上游的第二段收敛判定（03-focus-cinema-camera.js:52-61）：
      // 用户姿态到位后还要等**渲染出的**相机姿态（theta/phi/radius 由 ease
      // 逐帧追赶）也收敛，才落定回正。只看用户姿态会提前一两帧落定。
      const visualThetaTarget = state.baselineTheta
      const visualPhiTarget = Math.max(MIN_PHI, Math.min(MAX_PHI, state.baselinePhi))
      const visualRadiusTarget = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, state.baselineRadius))
      const visualSettled =
        Math.abs(shortestAngleDelta(state.theta, visualThetaTarget)) < 0.0016 &&
        Math.abs(state.phi - visualPhiTarget) < 0.0016 &&
        Math.abs(state.radius - visualRadiusTarget) < 0.018
      const settled = Math.abs(thetaDelta) < 0.0012 && Math.abs(phiDelta) < 0.0012 && Math.abs(radiusDelta) < 0.014
      const timedOut = state.recenterStartedAt > 0 && performance.now() - state.recenterStartedAt > 1800
      if ((settled && visualSettled) || timedOut) {
        state.userTheta = state.baselineTheta
        state.userPhi = state.baselinePhi
        state.userRadius = state.baselineRadius
        state.recentering = false
        state.recenterStartedAt = 0
      }
    }

    // 上游 `updateCinema` 的阻尼语义（03-focus-cinema-camera.js:275-284）：
    //   shake    = clamp(fx.cinemaShake, 0, 1.8)        // 出厂默认 0.5
    //   idleDamp = (rotating ? 0.25 : 1) * shake        // 旋转时仍保留 1/4 漂移
    //   beatDamp = (focus.active ? 0.55 : 1.0) * shake  // ★ 跟拍时压低节拍冲击
    //
    // ★ `beatDamp` 在**跟拍激活时压到 0.55** —— 此前本项目漏了这一档，
    //   一律用 `shake`，于是歌单架跟拍/歌词 lookAt 期间镜头仍在满幅推拉，
    //   与"跟拍时画面应当稳定"的上游意图相反。
    const shake = enabled ? CINEMA_SHAKE : 0
    const idleDamp = (state.rotating ? 0.25 : 1) * shake
    const beatDamp = (state.focus.active ? 0.55 : 1.0) * shake
    const cineTheta = Math.sin(cinemaTimeRef.current * 0.08) * 0.012 * idleDamp + kick.thetaKick * beatDamp
    const cinePhi = Math.sin(cinemaTimeRef.current * 0.06 + 1) * 0.01 * idleDamp + kick.phiKick * beatDamp
    const cineRadius = Math.sin(cinemaTimeRef.current * 0.04 + 2) * 0.08 * idleDamp - kick.radiusKick * beatDamp * 1.18

    // focus 优先；否则若有基准锁用 baseline，否则用 user（上游三分支）。
    const focus = state.focus
    const locked = state.centerLocked && !state.recentering
    const baseTheta = locked ? state.baselineTheta : state.userTheta
    const basePhi = locked ? state.baselinePhi : state.userPhi
    const baseRadius = locked ? state.baselineRadius : state.userRadius

    const targetTheta = focus.active ? focus.theta : baseTheta + cineTheta
    const targetPhi = focus.active ? focus.phi : Math.max(MIN_PHI, Math.min(MAX_PHI, basePhi + cinePhi))
    const targetRadius = focus.active
      ? focus.radius
      : Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, baseRadius + cineRadius))
    // 看向目标：跟拍优先；否则若歌词在世界空间就看向歌词
    //（上游 `readSonicLyricLookAtTarget`，01-orbit-free-camera.js:82-105 ——
    //  这正是地形预设"立体空间感"的另一半：**相机看向歌词**，而不是
    //  把歌词搬到相机前面）。
    let targetLookAt = focus.active ? focus.lookAt : ZERO
    let positionEase = focus.active ? 0.16 : 0.1
    let radiusEase = focus.active ? 0.12 : 0.07
    // ★ 歌单架跟拍的进/出限速（上游 03-focus-cinema-camera.js:97-107）：
    //   shelf 类 focus 用 shelfCameraEnter/ExitSpeed（出厂 0.24）把 ease 压到
    //   ≈0.038/0.029，进 出都是慢速推拉。没有这层时指针在命中边界抖动，
    //   跟拍以全速来回甩 —— 用户报告的"触发相机位移又莫名回正、抽搐"。
    const shelfFocusType = focus.type === 'shelf'
    if (shelfFocusType) {
      // 进入中（active）或退出中（type 未清但 active 已关）都要限速
      const speed = SHELF_CAMERA_SPEED
      positionEase = Math.max(0.018, Math.min(0.42, positionEase * speed))
      radiusEase = Math.max(0.014, Math.min(0.36, radiusEase * speed))
    }
    if (!focus.active && !shelfFocusType && lyricWorldPos.active) {
      // 上游的 clamp：x∈[-2.4,2.4]、y=clamp(y-0.18,-1.55,1.25)、z=clamp(z+0.10,-2.6,1.55)
      lyricLookAtRef.current.set(
        Math.max(-2.4, Math.min(2.4, lyricWorldPos.x)),
        Math.max(-1.55, Math.min(1.25, lyricWorldPos.y - 0.18)),
        Math.max(-2.6, Math.min(1.55, lyricWorldPos.z + 0.1)),
      )
      targetLookAt = lyricLookAtRef.current
      positionEase = Math.max(positionEase, 0.115)
      radiusEase = Math.max(radiusEase, 0.082)
    }

    state.theta += (targetTheta - state.theta) * positionEase
    state.phi += (targetPhi - state.phi) * positionEase
    state.radius += (targetRadius - state.radius) * radiusEase
    state.lookAt.lerp(targetLookAt, positionEase)

    // 歌单架跟拍退出的收敛落定（上游 03-focus-cinema-camera.js:114-124）：
    // 退出跟拍时只关 focus.active、保留 type='shelf'，直到相机姿态与
    // lookAt 都回到主姿态附近才真正清 type —— 期间退出限速持续生效，
    // 相机是"缓缓滑回"而不是被踢回全速姿态。
    if (shelfFocusType && !focus.active) {
      const settled = tickShelfFocusExitSettled(
        state.theta,
        state.phi,
        state.radius,
        targetTheta,
        targetPhi,
        targetRadius,
        targetLookAt.x - state.lookAt.x,
        targetLookAt.y - state.lookAt.y,
        targetLookAt.z - state.lookAt.z,
      )
      if (settled) {
        state.focus.type = null
      }
    }

    const cy = Math.cos(state.phi)
    const sy = Math.sin(state.phi)
    const ct = Math.cos(state.theta)
    const st = Math.sin(state.theta)
    camera.position.set(
      state.lookAt.x + state.radius * cy * st,
      state.lookAt.y + state.radius * sy,
      state.lookAt.z + state.radius * cy * ct,
    )
    camera.lookAt(state.lookAt)

    // 节拍滚转（上游 updateCinema 的 rollKick，逐帧叠加在 lookAt 之后 ——
    // `lookAt` 会重算四元数，放在它前面会被整个覆盖掉）。
    camera.rotation.z += kick.rollKick * shake

    // ---- 侧栏安全区退让（第三十三轮，HANDOFF §2 D12）----
    //
    // 侧栏（热歌榜/聊天）展开时整幅 3D 内容横向让开，等价于经典播放器的
    // `padding-inline` —— 画布是 absolute inset-0，CSS 内边距对 WebGL 无效，
    // 只能在相机侧表达。见 `stageSafeArea.ts` 顶部说明。
    //
    // ★ 用**离轴投影**（叠加到 `projectionMatrix.elements[8]`），**不是**平移机位。
    //
    //   相机平移是**世界空间**的，而透视会按深度缩放世界尺度：同一个世界
    //   位移在近处（歌曲架 z≈0.98）与远处（歌词 z≈2.24）产生的**屏幕**
    //   位移不等。要让近处的歌曲架刚好清开面板，挑任何单一深度做换算都会
    //   给其他深度留下残差（实测：挑 lookAt 深度在 1366 上残差 1.05%）。
    //
    //   离轴投影把整个视锥横移，**所有深度得到完全相同的屏幕平移**
    //   （实测四个深度 Δ 均为精确 5.000%），这才是"内边距"的语义。
    //   射线拾取读的是相机矩阵 + 投影矩阵，`elements[8]` 会被计入，
    //   因此歌单架的命中判定与画面同步，无需另改。
    //
    // ★★ 必须放在 `updateProjectionMatrix()` **之后**。
    //
    //   那个调用会用 `fov/aspect/near/far` **重建**投影矩阵，把叠加值覆盖掉。
    //   放在它前面 = 每帧白改（画面纹丝不动），且不报任何错 —— 典型的静默失效。
    //   本组件末尾本来就有一次重建，因此这里在其后追加。
    const perspective = camera as THREE.PerspectiveCamera
    const globalPunch = tickCameraPunch()
    const cameraPunch = Math.max(globalPunch * 0.55, (kick.punch * 0.54 + kick.radiusKick * 0.16) * shake)
    const targetFov = 45 - cameraPunch * 2.35
    perspective.fov += (targetFov - perspective.fov) * (targetFov < perspective.fov ? 0.24 : 0.12)
    perspective.updateProjectionMatrix()

    // ↑ 重建之后才能叠加离轴偏移（顺序不可调换，见上）
    //
    // ★ 退让量走 `stepStageSafeArea`（200ms `ease-out` 缓动），不是直接把
    //   目标值用上 —— 经典播放器的 padding 是 `transition: 200ms ease-out`，
    //   3D 侧必须复刻同样的"滑过去"，否则开关面板时画面是硬切。
    //   缓动与投影叠加都在这里（每帧唯一的相机写入者）—— 单点驱动。
    const projectionShift = stageProjectionShiftX(stepStageSafeArea(delta))
    if (projectionShift !== 0) {
      perspective.projectionMatrix.elements[8] += projectionShift
      // 逆矩阵要跟着更新：`Raycaster.setFromCamera` 与部分 R3F 内部逻辑
      // 会用它做反投影，不同步会让拾取与画面错位。
      perspective.projectionMatrixInverse.copy(perspective.projectionMatrix).invert()
    }
  })
  /* eslint-enable react-hooks/immutability */

  return null
}

const ZERO = new THREE.Vector3()

/**
 * 运镜阻尼系数 —— 对应上游 `fxDefaults.cinemaShake`（04-fx-defaults.js）。
 * 出厂默认 0.5，可调区间 [0, 1.8]。闲置漂移与节拍冲击整体乘以它。
 * 本项目暂未暴露该滑杆，硬取出厂默认 0.5 以对齐 Mineradio 观感。
 */
const CINEMA_SHAKE = 0.5
