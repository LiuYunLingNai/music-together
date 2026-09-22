import * as THREE from 'three'
import type { VisualModeId } from '../shared/VisualMode'
import { resetGestureRotation } from './gestureRotationState'
import { SHELF_CENTER, shelfFocusLookAtOffset, shelfFollowTier, shelfSideX } from './floatingSongCard'

/**
 * 轨道相机状态 —— 对照 Mineradio `01-scene/01-orbit-free-camera.js` 与
 * `03-focus-cinema-camera.js` 的 `orbit` 对象。
 *
 * 上游的状态机有三个关键概念，缺一不可：
 *
 *   baseline*    当前预设的**基准姿态**（切预设时重设）
 *   centerLocked 是否锁在基准上（拖拽/滚轮会解除）
 *   recentering  解除后正在**平滑回正**到基准
 *
 * 「拖拽偏离 → 松手自动回正」正是靠 recentering 实现的，而不是靠夹取
 * theta —— theta 是环绕角，上游本身不夹取它，允许转满 360°。
 * 缺失这一层就会表现为「可以随意旋转、没有限制」。
 */

const MODE_CAMERA: Record<VisualModeId, { radius: number; phi: number; theta: number }> = {
  emily: { radius: 6.6, phi: 0.08, theta: 0 },
  tunnel: { radius: 6.2, phi: 0.03, theta: 0 },
  planet: { radius: 7, phi: 0.15, theta: 0 },
  // 上游 preset 3（VOID）的基线 8.0/0.05 不列出 —— 本项目已无模式选中该槽位。
  vinyl: { radius: 6.5, phi: 0.04, theta: 0 },
  galaxy: { radius: 6.6, phi: 0.08, theta: 0 },
  /**
   * 声波地形基线，取自上游 `SONIC_ORBIT_BASELINE`
   * （`01-orbit-free-camera.js:26`）：{ theta: 0.00, phi: 0.18, radius: 8.4 }。
   * 注意 radius 是 **8.4**，不是 9.2；地形锚定在 y=-6.362
   * （`topographyConfig.ts` 按 range/lower/depth 出厂值推导），需要略高的俯角。
   */
  topography: { radius: 8.4, phi: 0.18, theta: 0 },
}

/** 上游 `orbit.minPhi/maxPhi/minRadius/maxRadius`。 */
export const MIN_PHI = -Math.PI * 0.45
export const MAX_PHI = Math.PI * 0.45
export const MIN_RADIUS = 2.4
export const MAX_RADIUS = 14

/**
 * 相机前推冲击（上游全局 `camPunch`，03-focus-cinema-camera.js:137/142）：
 * 与 beatCam.punch 不同源 —— 预设切换（04-preset-grid-uniforms.js:44，
 * `max(camPunch, wallpaperFlow ? 0.04 : 0.12)`）与歌单架跟拍（:188/196/204）
 * 都会直接抬高它，逐帧衰减 `camPunch *= 0.86`，最终进
 * `cameraPunch = max(camPunch*0.55, beat.punch*0.54 + beat.radius*0.16)`。
 */
let camPunch = 0

/** 抬高相机前推冲击（取 max，语义同上游）。 */
export function boostCameraPunch(amount: number): void {
  camPunch = Math.max(camPunch, amount)
}

/** 读取并按 `*= 0.86` 衰减（上游 updateCamera 逐帧调用）。 */
export function tickCameraPunch(): number {
  camPunch *= 0.86
  return camPunch
}

/**
 * 清零相机前推冲击。
 *
 * ★ 模块级单例的清理义务（红线 22）：`camPunch` 与 `orbitCameraState`
 *   同属模块级可变状态，但此前**只有后者**在 `CameraRig` 卸载时被复位。
 *   残留后果：在镜头前推脉冲尚未衰减完时切走舞台（切到经典播放器或
 *   另一个视觉模式），下次进入视觉模式时 FOV 会带着上一次的冲击值 ——
 *   表现为"刚进模式镜头就猛地一推"，且因为 `tickCameraPunch` 只在
 *   `CameraRig` 的 useFrame 里跑，残留值在卸载期间**不会自行衰减**。
 */
export function resetCameraPunch(): void {
  camPunch = 0
}

/** 跟拍类型：目前只用到歌单架侧栏。 */
export type FocusType = 'shelf' | null

interface CameraFocus {
  active: boolean
  type: FocusType
  theta: number
  phi: number
  radius: number
  lookAt: THREE.Vector3
}

export interface OrbitCameraState {
  mode: VisualModeId
  /** 用户当前姿态（拖拽直接改它） */
  userTheta: number
  userPhi: number
  userRadius: number
  /** 实际渲染姿态（向 user/cine 或 focus 缓动） */
  theta: number
  phi: number
  radius: number
  lookAt: THREE.Vector3
  /** 预设基准姿态 */
  baselineTheta: number
  baselinePhi: number
  baselineRadius: number
  rotating: boolean
  lastX: number
  lastY: number
  /** 锁在基准上（拖拽/滚轮会解除） */
  centerLocked: boolean
  /** 正在平滑回正 */
  recentering: boolean
  recenterStartedAt: number
  focus: CameraFocus
  /**
   * 最近一次指针位置（画布坐标）。
   *
   * 歌单架的悬停判定是**屏幕热区**而非射线命中，需要持续读取指针位置；
   * 上游同样把指针位置缓存在 `shelfHoverCue.x/y` 上逐帧复用。
   * `null` 表示指针不在画布上。
   */
  pointerSlot: { x: number; y: number } | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 最短角差，避免回正时绕远路（上游 `shortestAngleDelta`）。 */
export function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function applyBaseline(
  state: OrbitCameraState,
  base: { radius: number; phi: number; theta: number },
  sync: boolean,
): void {
  state.baselineTheta = base.theta
  state.baselinePhi = clamp(base.phi, MIN_PHI, MAX_PHI)
  state.baselineRadius = clamp(base.radius, MIN_RADIUS, MAX_RADIUS)
  state.userTheta = state.baselineTheta
  state.userPhi = state.baselinePhi
  state.userRadius = state.baselineRadius
  if (sync) {
    state.theta = state.userTheta
    state.phi = state.userPhi
    state.radius = state.userRadius
  }
}

function createState(mode: VisualModeId): OrbitCameraState {
  const base = MODE_CAMERA[mode]
  const state: OrbitCameraState = {
    mode,
    userTheta: base.theta,
    userPhi: base.phi,
    userRadius: base.radius,
    theta: base.theta,
    phi: base.phi,
    radius: base.radius,
    lookAt: new THREE.Vector3(),
    baselineTheta: base.theta,
    baselinePhi: base.phi,
    baselineRadius: base.radius,
    rotating: false,
    lastX: 0,
    lastY: 0,
    centerLocked: true,
    recentering: false,
    recenterStartedAt: 0,
    focus: {
      active: false,
      type: null,
      theta: 0.28,
      phi: -0.04,
      radius: 4.74,
      lookAt: new THREE.Vector3(1.78, 0.22, 0.86),
    },
    pointerSlot: null,
  }
  return state
}

export const orbitCameraState = createState('emily')

/** 切换预设：重设基准并同步当前姿态（上游 `applyPresetOrbitBaseline`）。 */
export function setOrbitMode(mode: VisualModeId): void {
  if (orbitCameraState.mode === mode) return
  orbitCameraState.mode = mode
  applyBaseline(orbitCameraState, MODE_CAMERA[mode], true)
  orbitCameraState.focus.active = false
  orbitCameraState.focus.type = null
  orbitCameraState.centerLocked = true
  orbitCameraState.recentering = false
  orbitCameraState.recenterStartedAt = 0
}

/**
 * 解除「锁在基准」状态。
 *
 * 上游在拖拽开始（`mousedown`）与滚轮时调用 `unlockCenteredView()`，
 * 之后由 `updateCamera` 的 recentering 分支负责回正。
 */
export function unlockCenteredView(): void {
  orbitCameraState.centerLocked = false
}

/**
 * 请求回正。
 *
 * 上游 `recenterCamera()`（03-focus-cinema-camera.js:291-315）做了**两件事**：
 *
 *   1. 相机锁回基准，由逐帧 `recentering` 缓动收敛（不是瞬移）
 *   2. 调 `clearCenteredViewOffsets()`，把 `gestureRotation` 与 `particleSpin`
 *      **一起归零** —— 否则相机回正了、物体却永远歪着
 *
 * 第 2 点是此前漏掉的：本题的 `resetGestureRotation` 只在测试里被调用过，
 * 生产路径从不清空物体旋转，表现为「拖完能转，但双击回正时背景不跟着回正」。
 * 上游的顺序是先清偏移（含物体）再启动相机缓动，这里保持一致。
 */
export function recenterCamera(): void {
  const state = orbitCameraState
  // 先清物体侧（上游 clearCenteredViewOffsets 在前，recentering 标记在后）
  resetGestureRotation()
  state.centerLocked = true
  state.recentering = true
  state.recenterStartedAt = performance.now()
  state.focus.active = false
  state.focus.type = null
  state.focus.lookAt.set(0, 0, 0)
}

/**
 * 歌单架跟拍相机进/出限速（上游 `fxDefaults.shelfCameraEnterSpeed` /
 * `shelfCameraExitSpeed`，00-state/04-fx-defaults.js:184-185 出厂 0.24）。
 *
 * 上游 `updateCamera` 对 shelf 类跟拍把 focusEase/radiusEase 乘上该系数并
 * 夹到 [0.018,0.42] / [0.014,0.36]（03-focus-cinema-camera.js:97-107）——
 * 进出走 ≈0.038/0.029 的慢速缓动。没有这一层时，指针在卡片命中边界
 * 抖动会导致跟拍以全速来回切换，表现为相机"抽搐"。
 */
export const SHELF_CAMERA_SPEED = 0.24

/**
 * 歌单架跟拍退出的收敛判定（上游 03-focus-cinema-camera.js:114-124）：
 * 退出后 focus.type 保留为 'shelf'，直到姿态与 lookAt 都逼近主姿态才
 * 真正清空 —— 清空前退出缓动持续生效。
 */
export function tickShelfFocusExitSettled(
  theta: number,
  phi: number,
  radius: number,
  focusTheta: number,
  focusPhi: number,
  focusRadius: number,
  lookAtDx: number,
  lookAtDy: number,
  lookAtDz: number,
): boolean {
  return (
    Math.abs(shortestAngleDelta(theta, focusTheta)) < 0.003 &&
    Math.abs(phi - focusPhi) < 0.003 &&
    Math.abs(radius - focusRadius) < 0.03 &&
    lookAtDx * lookAtDx + lookAtDy * lookAtDy + lookAtDz * lookAtDz < 0.0009
  )
}

/**
 * 歌单架跟拍。
 *
 * 对照上游 OpenMusic `activateFocusZone('shelf-side')` 的**桌面**参数
 * （`03-focus-cinema-camera.js:192-196`）：
 *   theta 0.42 / phi -0.12 / radius 4.20 / lookAt(2.32, -0.10, 0.72)
 *
 * ★ 用户观感调整（2026-09-21）：**齐平档**。上表的 phi −0.12 /
 *   lookAt.y −0.10 是"俯拍"档 —— 相机低于 lookAt 平面再往下看，
 *   整列卡片因此整体下沉。实测投影（theta 0.42 / radius 4.2 / 横屏 16:9）：
 *     上卡 ndcY +1.723、下卡 ndcY −1.983 → 列中心 −0.130
 *     上间隙 −0.723、下间隙 −0.983 → 上下差 0.261
 *   用户要求"齐平以保持上下间隙对称"，改为 phi 0 / lookAt.y 0：
 *     上卡 +1.859、下卡 −1.859 → 列中心 0.000，上下差 0.000（完全对称）。
 *   theta 与 lookAt.x/z 不动，保留右侧构图与推近幅度。
 *   注：上游对 preset 5（WALLPAPER）本就另有一档（phi 0.02），
 *   说明"按模式/观感分档"与上游结构一致；且此跟拍引自 OpenMusic，
 *   不属于 Mineradio 忠实还原范围。
 *
 * 与上游一致，激活跟拍同时解除 centerLock（`activateFocusZone` 首行
 * 就调用 `unlockCenteredView()`）；退出跟拍后由调用方决定是否回正。
 *
 * ★ 退出时**保留** `focus.type = 'shelf'`（只关 active）：上游退出跟拍后
 *   type 要等相机收敛才清空（updateCamera 的 shelfFocusType && !fa 分支），
 *   期间退出缓动持续生效。立即清 type 会让退出帧掉回全速 ease ——
 *   这正是跟拍进/出边界上相机抽搐的另一半来源。
 */
export function setShelfCameraFocus(active: boolean): void {
  const state = orbitCameraState
  if (!active) {
    if (state.focus.type === 'shelf') {
      state.focus.active = false
      // type 保留，由 CameraRig 在收敛后清除（tickShelfFocusExitSettled）
    }
    return
  }
  unlockCenteredView()
  state.focus.active = true
  state.focus.type = 'shelf'
  // ★ lookAt.x 必须**跟随歌单架的横向位置**（第三十三轮），且偏移**分档**
  //   （第三十四轮修 §5.4 C5）。
  //
  //   卡片列由 `floatingSongCard.ts` 的 `SHELF_CENTER.x` 定位；跟拍时相机
  //   推近，若注视点仍停在旧的 x，整列就会偏出画面中心。
  //   上游的 `lookAt.x` 只有两档（竖屏 1.08 / 其余 2.32），而卡片列 `sideX`
  //   有三档 —— 因此偏移**必须按档位取**（见 `shelfFocusLookAtOffset` 的推导）：
  //     竖屏 +0.14 ／ 窄屏 −0.18 ／ 宽屏 +0.52
  //   此前对所有档位用宽屏的 0.52：窄屏下注视点落到 1.96、上游是 2.32，
  //   差 0.36 world，推近后整列在构图里偏左。
  const shelfLookAtX = shelfSideX() + SHELF_CENTER.x - shelfFocusLookAtOffset()
  // 跟拍档位参数也分档（上游竖屏 theta 0.24 / radius 5.28 —— 更正面、更远）。
  // `phi` / `lookAt.y` 取 0 是已登记的 §2 D3"齐平"偏离，不随档位变化。
  const tier = shelfFollowTier()
  if (state.mode === 'topography') {
    // 地形档：与粒子档同一"齐平"原则（phi 0 / lookAt.y 0 → 列中心 0.000、
    // 上下间隙差 0.000）。半径 5.2 保留第二十二轮的"拉近幅度减半"——
    // 地形主相机基线更远（radius 8.4），拉近到 4.2 的落差比粒子档大一倍。
    // 注：第二十二轮曾把 lookAt.y 抬到 0.30 去对齐"抬升后的歌词/地形视觉
    // 中心"，但那会让列中心回到 −0.134、上下间隙差 0.267 —— 与"齐平对称"
    // 直接冲突，故一并归零。
    state.focus.theta = tier.theta
    state.focus.phi = 0.0
    state.focus.radius = 5.2
    state.focus.lookAt.set(shelfLookAtX, 0.0, 0.72)
  } else {
    state.focus.theta = tier.theta
    state.focus.phi = 0.0
    state.focus.radius = tier.radius
    state.focus.lookAt.set(shelfLookAtX, 0.0, 0.72)
  }
}

/** 无条件清除跟拍（卸载/无曲目时用）。 */
export function clearShelfFocus(): void {
  const state = orbitCameraState
  state.focus.active = false
  state.focus.type = null
}

/** 夹取 phi 与 radius（theta 不夹取，上游允许环绕）。 */
export function clampOrbit(): void {
  const state = orbitCameraState
  state.userPhi = clamp(state.userPhi, MIN_PHI, MAX_PHI)
  state.userRadius = clamp(state.userRadius, MIN_RADIUS, MAX_RADIUS)
}
