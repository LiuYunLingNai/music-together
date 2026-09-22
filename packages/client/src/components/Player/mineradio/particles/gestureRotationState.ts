/**
 * 手势/拖拽旋转层 —— 对照 Mineradio `10-shell/00-gesture-control.js`。
 *
 * **这是本项目上一轮接错的那一层。** 上游的画布拖拽**不旋转相机**，
 * 而是累加一个物体组的旋转角 `gestureRotation`，松手后按角速度惯性滑行。
 * 上游 `scripts/quick-check.js` 把它写成了断言：
 *
 *   !/function applyOrbitPointerDrag/        // 必须"不存在"（禁止拖拽转相机）
 *   !/applyOrbitPointerDrag\(dx,\s*dy\)/     // 同上
 *   !/applyParticleSpinDrag\(dx,\s*dy,\s*spinDt\)/  // 必须是这个
 *   !/gestureRotation\.x\s*\+=\s*rx/        // 必须存在
 *
 * ### 应用方式：写 `.rotation`，**不是**挂到新增的父级 group
 *
 * 上游并没有"可旋转的组"这个物体。`11-main-loop.js` 逐帧做的是：
 *
 *   targetRotY = centerLocked ? 0 : headParallax + gestureRotation.y
 *   particles.rotation.y += (targetRotY - particles.rotation.y) * 0.055
 *   bloomParticles.rotation.copy(particles.rotation)   // 其余层直接拷贝
 *
 * 因此本项目也按"每个组件写自己的 `.rotation`"实现，不重挂 JSX 层级
 * （重挂反而更不忠实，且会与现有逐帧写入者打架）。
 *
 * 模块级单例：组件会重建，但旋转状态不会。这与 `orbitCameraState` 同款，
 * 卸载时由使用者显式 `resetGestureRotation()`。
 */

/** 指针拖拽：每像素对应的弧度增量（上游 00-gesture-control.js:39-40）。 */
export const PARTICLE_POINTER_SPIN_X = 0.0032
export const PARTICLE_POINTER_SPIN_Y = 0.0034

/** 角速度上限（上游 `PARTICLE_SPIN_MAX`）。 */
export const PARTICLE_SPIN_MAX = 6.2

/** 惯性衰减系数：逐帧按 `damping^(dt*60)` 衰减。 */
const PARTICLE_SPIN_DAMPING = 0.9

/** 拖拽瞬间的角速度增益（指针 0.46 / 手势捏合 0.48，这里只用到指针）。 */
const PARTICLE_SPIN_DRAG_GAIN = 0.46

/** 低于该角速度直接归零，避免无限趋近 0 的浮点尾巴。 */
const PARTICLE_SPIN_EPSILON = 0.01

/** rebase 阈值：超过 10π 就折回等价角，防止长时间累加导致精度漂移。 */
const REBASE_LIMIT = Math.PI * 10

/** 逐帧缓动到目标旋转的比例（上游 11-main-loop.js:635-636）。 */
export const PARTICLE_ROTATION_EASE = 0.055

/**
 * 「封面世界姿态」的共享出口。
 *
 * 上游歌词**不是**自己旋转，而是每帧采样 `particles.getWorldQuaternion()`
 * 作为自己的朝向基准（`14-stage-lyrics-rendering.js:2190-2204`），
 * 于是歌词"跟随封面坐标系"，既不是屏幕锁定、也不是自转。
 *
 * 本项目里 `ParticleField`（粒子/封面）与 `LyricStage` 是 `ParticleScene`
 * 的兄弟节点，因此用这个单例把封面姿态桥接给歌词。
 * 值是弧度四元数分量，避免三处各自 new THREE.Quaternion 造成分配。
 */
export const coverPose = {
  /** 封面当前世界四元数（x, y, z, w）；未挂载时为单位四元数 */
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  /** 封面当前世界位置。上游歌词的锚点就是它（`lyricLayoutBase`）。 */
  position: { x: 0, y: 0, z: 0 },
  /** 封面是否已挂载并提供姿态 */
  active: false,
}

/** 由 `ParticleField` 每帧写入封面姿态与位置。 */
export function publishCoverPose(x: number, y: number, z: number, w: number, px = 0, py = 0, pz = 0): void {
  coverPose.quaternion.x = x
  coverPose.quaternion.y = y
  coverPose.quaternion.z = z
  coverPose.quaternion.w = w
  coverPose.position.x = px
  coverPose.position.y = py
  coverPose.position.z = pz
  coverPose.active = true
}

/** 卸载时清空，避免歌词读到一个已消失的封面姿态。 */
export function clearCoverPose(): void {
  coverPose.quaternion.x = 0
  coverPose.quaternion.y = 0
  coverPose.quaternion.z = 0
  coverPose.quaternion.w = 1
  coverPose.position.x = 0
  coverPose.position.y = 0
  coverPose.position.z = 0
  coverPose.active = false
}

/**
 * 「歌词世界位置」的共享出口 —— 供相机看向它。
 *
 * 上游 `readSonicLyricLookAtTarget`（`01-orbit-free-camera.js:82-105`）读的就是
 * 歌词组的**世界位置**，clamp 后让相机看向它。地形预设的"立体空间感"
 * = 歌词锚在封面上（世界空间） + 相机看向它，而不是把歌词搬到相机前面。
 */
export const lyricWorldPos = { x: 0, y: 0, z: 0, active: false }

export interface GestureRotationState {
  /** 累计旋转角（弧度），拖拽与惯性共同推进 */
  x: number
  y: number
  /** 角速度，松手后靠它滑行 */
  spinVx: number
  spinVy: number
}

/** 模块级单例：与 `orbitCameraState` 同款，组件重建不影响它。 */
export const gestureRotationState: GestureRotationState = {
  x: 0,
  y: 0,
  spinVx: 0,
  spinVy: 0,
}

/** 夹取角速度（上游 `clampParticleSpinVelocity`）。 */
export function clampParticleSpinVelocity(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(-PARTICLE_SPIN_MAX, Math.min(PARTICLE_SPIN_MAX, v))
}

/**
 * 拖拽增量 → 旋转角与角速度（上游 `applyParticleSpinDrag`）。
 *
 * 注意轴向：**dy 驱动 x，dx 驱动 y**。这不是笔误，上游就是交叉的
 * （横向拖拽绕 Y 轴转，纵向拖拽绕 X 轴转）。
 */
export function applyParticleSpinDrag(dx: number, dy: number, dt: number): void {
  const rx = dy * PARTICLE_POINTER_SPIN_X
  const ry = dx * PARTICLE_POINTER_SPIN_Y
  const state = gestureRotationState
  state.x += rx
  state.y += ry
  if (dt > 0) {
    state.spinVx = clampParticleSpinVelocity((rx / dt) * PARTICLE_SPIN_DRAG_GAIN)
    state.spinVy = clampParticleSpinVelocity((ry / dt) * PARTICLE_SPIN_DRAG_GAIN)
  }
}

/**
 * 逐帧推进惯性（上游 `tickGestureRotation`）。
 *
 * 返回本帧的旋转增量，调用方据此把 `gestureRotation` 应用到各自的
 * `.rotation` 上。**必须在消费旋转之前调用**（上游在 11-main-loop.js:624
 * 先 tick，633 才写 `particles.rotation`）。
 */
export function tickGestureRotation(deltaSeconds: number): void {
  const dt = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0)
  const state = gestureRotationState

  if (Math.abs(state.spinVx) > 0.0001 || Math.abs(state.spinVy) > 0.0001) {
    state.x += state.spinVx * dt
    state.y += state.spinVy * dt
    rebaseParticleRotationIfNeeded()
  }

  // 上游用 pow(damping, dt*60) 让衰减与帧率无关
  const decay = Math.pow(PARTICLE_SPIN_DAMPING, dt * 60)
  state.spinVx *= decay
  state.spinVy *= decay

  if (Math.abs(state.spinVx) < PARTICLE_SPIN_EPSILON) state.spinVx = 0
  if (Math.abs(state.spinVy) < PARTICLE_SPIN_EPSILON) state.spinVy = 0
}

/**
 * rebase：把超过 10π 的累计角折回等价区间。
 *
 * 上游同时把偏移量减到**每一个**受该旋转影响的物体上，否则物体会跳变。
 * 本项目里受影响的层由调用方通过 `consumers` 传入。
 */
export function rebaseParticleRotationAxis(
  axis: 'x' | 'y',
  consumers: Array<{ rotation: { x: number; y: number } }> = [],
): void {
  const state = gestureRotationState
  const current = state[axis]
  if (Math.abs(current) < REBASE_LIMIT) return
  const offset = Math.round(current / (Math.PI * 2)) * Math.PI * 2
  state[axis] -= offset
  for (const target of consumers) target.rotation[axis] -= offset
}

/** 对两个轴各做一次 rebase。 */
export function rebaseParticleRotationIfNeeded(consumers: Array<{ rotation: { x: number; y: number } }> = []): void {
  rebaseParticleRotationAxis('x', consumers)
  rebaseParticleRotationAxis('y', consumers)
}

/**
 * 重置旋转与惯性（上游 `resetParticleRotationTarget`）。
 *
 * 双击回正、切歌、准备销毁时调用。传 `syncVisual` 的消费者会被直接
 * 归零，避免下一次挂载带着旧角度进入。
 */
export function resetGestureRotation(consumers: Array<{ rotation: { x: number; y: number; z?: number } }> = []): void {
  const state = gestureRotationState
  state.x = 0
  state.y = 0
  state.spinVx = 0
  state.spinVy = 0
  for (const target of consumers) {
    target.rotation.x = 0
    target.rotation.y = 0
    if (typeof target.rotation.z === 'number') target.rotation.z = 0
  }
}
