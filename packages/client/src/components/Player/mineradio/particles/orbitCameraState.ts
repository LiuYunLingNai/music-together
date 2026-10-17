import * as THREE from 'three'
import type { VisualModeId } from '../../stages/VisualMode'
import { dampBeatCameraImpulse } from './beatCamera'
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

/**
 * 回正时按系数衰减 `camPunch` —— 上游 `dampCameraImpulseForRecenter` 里的
 * `camPunch *= damp` 那一行（`01-orbit-free-camera.js:251`）。
 * `beatCam` 的五个 kick 由 `dampBeatCameraImpulse` 负责。
 */
export function dampCameraPunch(strength: number): void {
  camPunch *= Math.max(0, Math.min(1, strength))
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
   *
   * ★ `movedAt` 是**真实 pointermove 事件**的时刻，不是读取时刻。
   *
   *   上游 `shelfHoverCue.lastAt` 只在 `updateShelfHoverCueFromPointer(e)`
   *   里被写（`00-layout-hover.js:171`），而该函数**只由 DOM 事件驱动**
   *   （`10-shell/02-peek-panels-upload.js:389,410` 的 mousemove）；
   *   `tickShelfHoverCue` 则靠 `now - lastAt > 650` 判定"指针已停止活动"。
   *
   *   本项目的指针位置走这个共享槽、由渲染循环逐帧读取。若在逐帧读取处
   *   把 `lastAt` 写成 `now`，就等于**每帧伪造一次 pointermove** ——
   *   650ms 空闲永远累积不到，`target` 再也回不到 0，歌单架一旦浮现
   *   就**永不淡出**。因此事件时刻必须由事件写入方（CameraRig）盖戳。
   */
  pointerSlot: { x: number; y: number; movedAt: number } | null
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
  // ★ 衰减在飞的节拍冲量（上游 `dampCameraImpulseForRecenter(0.32)`，
  //   03-focus-cinema-camera.js:295）。
  //
  //   不做这一步，回正缓动会与仍在飞的 beatCam kick 互相拉扯约 0.25s ——
  //   表现为"双击回正了却被弹回去一下才归位"。
  //   `cineTheta/cinePhi/cineRadius` 在本项目是 `CameraRig` 的局部量
  //   （每帧由 idle 漂移 + kick 重算，不持久），因此无需单独衰减。
  dampCameraPunch(0.32)
  dampBeatCameraImpulse(0.32)
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
 * ★ 该档的 `phi` / `lookAt.y` 已**恢复上游值**（用户 2026-10-17 决策）。
 *   此前（2026-09-21）曾按"齐平以保持上下间隙对称"把它们归零，实测
 *     上卡 ndcY +1.723、下卡 ndcY −1.983 → 列中心 −0.130
 *     上间隙 −0.723、下间隙 −0.983 → 上下差 0.261
 *   但歌单架现已移植上游的悬停召唤包络（`./shelfSummonState`），
 *   静止态整列不可见 —— "整列常驻时需要上下对称"这个前提已不成立，
 *   因此改为忠实复刻上游的俯拍档。
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
  // 跟拍档位参数**分档**（上游竖屏 theta 0.24 / phi −0.06 / radius 5.28 /
  // lookAt.y −0.18，横屏 theta 0.42 / phi −0.12 / radius 4.20 / lookAt.y −0.10）。
  const tier = shelfFollowTier()
  if (state.mode === 'topography') {
    // 地形档：与粒子档同一原则，但半径保留第二十二轮的"拉近幅度减半"——
    // 地形主相机基线更远（radius 8.4），拉近到 4.2 的落差比粒子档大一倍。
    // 第二十二轮曾把 lookAt.y 抬到 0.30 去对齐"抬升后的歌词/地形视觉中心"，
    // 但那与上游俯拍档冲突，故随 phi 一并对齐上游。
    state.focus.theta = tier.theta
    state.focus.phi = tier.phi
    state.focus.radius = 5.2
    state.focus.lookAt.set(shelfLookAtX, tier.lookAtY, 0.72)
  } else {
    state.focus.theta = tier.theta
    state.focus.phi = tier.phi
    state.focus.radius = tier.radius
    state.focus.lookAt.set(shelfLookAtX, tier.lookAtY, 0.72)
  }
  // ★ 上游 `03-focus-cinema-camera.js:196` 的 `camPunch = Math.max(camPunch, 0.82)`
  //   —— 只在 `setFocusZone('shelf-side')` 分支里，即**歌单架真正打开**
  //   （上游 = 右键 `pinnedOpen`）时的那一次镜头前推。
  //
  //   此前本项目跟拍完全没有这一项：相机靠 ease 缓动滑到跟拍位，没有"推近"的
  //   冲击感，观感是"画面慢慢飘过去"。补上后与上游一致。
  //
  //   ★ 放在 `if (!active) return` 之后：退出跟拍**不得**加冲击
  //     （上游退出分支只有 `setFocusZone(null)`，没有 camPunch）。
  //     否则每次指针移出右缘都会再推一次镜头。
  boostCameraPunch(SHELF_FOCUS_CAM_PUNCH)
}

/**
 * 上游跟拍开启时的镜头前推冲击（`03-focus-cinema-camera.js:196`，仅 shelf-side）。
 *
 * 其余分支的值不同（shelf-detail 0.38 / 壁纸安全档 0.28~0.30），本项目只有
 * shelf-side 一档，故只取 0.82。
 */
export const SHELF_FOCUS_CAM_PUNCH = 0.82

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
