import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { gestureRotationState } from './gestureRotationState'
import { SHELF_CENTER, shelfFocusLookAtOffset, shelfFollowTier, shelfSideX } from './floatingSongCard'
import {
  MAX_PHI,
  boostCameraPunch,
  resetCameraPunch,
  MAX_RADIUS,
  MIN_PHI,
  MIN_RADIUS,
  clampOrbit,
  clearShelfFocus,
  orbitCameraState,
  recenterCamera,
  setOrbitMode,
  setShelfCameraFocus,
  shortestAngleDelta,
  tickCameraPunch,
  tickShelfFocusExitSettled,
  unlockCenteredView,
} from './orbitCameraState'

/**
 * 回归保护：这组测试钉住 Mineradio 相机状态机的三个关键契约。
 *
 * 此前实现缺少 `baseline` / `centerLocked` / `recentering` 这一整层，
 * 导致「拖拽可以随意旋转、没有限制」——因为 theta 本身不夹取，
 * 真正的约束来自「松手后回正到基准」。
 */
describe('轨道相机状态机', () => {
  beforeEach(() => {
    setOrbitMode('emily')
    orbitCameraState.userTheta = 0
    orbitCameraState.userPhi = 0.08
    orbitCameraState.userRadius = 6.6
    orbitCameraState.centerLocked = true
    orbitCameraState.recentering = false
    orbitCameraState.recenterStartedAt = 0
    clearShelfFocus()
  })

  it('声波地形的基准来自上游 SONIC_ORBIT_BASELINE（radius 8.4，不是 9.2）', () => {
    setOrbitMode('topography')
    expect(orbitCameraState.baselineRadius).toBeCloseTo(8.4, 6)
    expect(orbitCameraState.baselinePhi).toBeCloseTo(0.18, 6)
    expect(orbitCameraState.baselineTheta).toBeCloseTo(0, 6)
  })

  it('切换预设会重设基准并同步当前姿态', () => {
    setOrbitMode('planet')
    expect(orbitCameraState.baselineRadius).toBeCloseTo(7, 6)
    expect(orbitCameraState.userRadius).toBeCloseTo(7, 6)
    expect(orbitCameraState.radius).toBeCloseTo(7, 6)
    expect(orbitCameraState.centerLocked).toBe(true)
  })

  it('拖拽（unlockCenteredView）会解除基准锁', () => {
    unlockCenteredView()
    expect(orbitCameraState.centerLocked).toBe(false)
  })

  it('recenterCamera 恢复基准锁并进入回正状态', () => {
    unlockCenteredView()
    orbitCameraState.userTheta = 2.5
    recenterCamera()
    expect(orbitCameraState.centerLocked).toBe(true)
    expect(orbitCameraState.recentering).toBe(true)
    // 回正是缓动而不是瞬移：调用瞬间用户姿态不应被改写
    expect(orbitCameraState.userTheta).toBeCloseTo(2.5, 6)
  })

  /**
   * 回归：回正必须**同时**清掉物体旋转。
   *
   * 上游 `recenterCamera()` 会调 `clearCenteredViewOffsets()`，把
   * `gestureRotation` 与 `particleSpin` 归零（03-focus-cinema-camera.js:16-26）。
   * 此前本项目只回正相机、从不碰物体旋转，表现为「双击回正后背景/封面
   * 仍保持拖拽角度」，与歌词的固定形态构成不协调的视觉。
   */
  it('recenterCamera 归零物体旋转与惯性（上游 clearCenteredViewOffsets）', () => {
    // 模拟一次拖拽留下的旋转与角速度
    gestureRotationState.x = 0.8
    gestureRotationState.y = -1.2
    gestureRotationState.spinVx = 3
    gestureRotationState.spinVy = -2

    recenterCamera()

    expect(gestureRotationState.x).toBe(0)
    expect(gestureRotationState.y).toBe(0)
    expect(gestureRotationState.spinVx).toBe(0)
    expect(gestureRotationState.spinVy).toBe(0)
    // 且相机侧也进入回正
    expect(orbitCameraState.centerLocked).toBe(true)
    expect(orbitCameraState.recentering).toBe(true)
  })

  it('clampOrbit 夹取 phi 与 radius，但**不**夹取 theta（允许环绕）', () => {
    orbitCameraState.userPhi = 99
    orbitCameraState.userRadius = 999
    orbitCameraState.userTheta = 99
    clampOrbit()
    expect(orbitCameraState.userPhi).toBeCloseTo(MAX_PHI, 6)
    expect(orbitCameraState.userRadius).toBeCloseTo(MAX_RADIUS, 6)
    // theta 保持原值 —— 上游允许转满 360°
    expect(orbitCameraState.userTheta).toBeCloseTo(99, 6)
  })

  it('phi / radius 的下界同样被夹取', () => {
    orbitCameraState.userPhi = -99
    orbitCameraState.userRadius = 0
    clampOrbit()
    expect(orbitCameraState.userPhi).toBeCloseTo(MIN_PHI, 6)
    expect(orbitCameraState.userRadius).toBeCloseTo(MIN_RADIUS, 6)
  })

  it('跟拍激活时解除基准锁，并采用上游俯拍档（phi −0.12 / lookAt.y −0.10）', () => {
    setShelfCameraFocus(true)
    expect(orbitCameraState.centerLocked).toBe(false)
    expect(orbitCameraState.focus.active).toBe(true)
    expect(orbitCameraState.focus.type).toBe('shelf')
    expect(orbitCameraState.focus.theta).toBeCloseTo(0.42, 6)
    // ★ 恢复上游值（用户 2026-10-17 决策）：桌面档 phi −0.12 /
    //   lookAt.y −0.10（俯拍），见 `03-focus-cinema-camera.js:193-195`。
    //
    //   此前（2026-09-21）曾按"齐平以保持上下间隙对称"把它们归零，实测
    //     上卡 ndcY +1.723、下卡 ndcY −1.983 → 列中心 −0.130
    //     上间隙 −0.723、下间隙 −0.983 → 上下差 0.261
    //   但歌单架现已移植上游的悬停召唤包络（`./shelfSummonState`），
    //   静止态整列不可见 —— "整列常驻时需要上下对称"的前提已不成立，
    //   因此改为忠实复刻上游的俯拍档。
    expect(orbitCameraState.focus.phi).toBeCloseTo(-0.12, 6)
    expect(orbitCameraState.focus.lookAt.y).toBeCloseTo(-0.1, 6)
    expect(orbitCameraState.focus.radius).toBeCloseTo(4.2, 6)
  })

  /**
   * 上游 `03-focus-cinema-camera.js:196`：`camPunch = Math.max(camPunch, 0.82)`。
   *
   * 这是"歌单架打开时镜头有明确的推近感"的来源 —— 单靠 ease 滑到跟拍位
   * 只是"慢慢飘过去"，没有冲击。本项目此前跟拍完全没有这一项。
   *
   * ★ 取 `max` 语义：beat 脉冲已经把 camPunch 抬高时，跟拍不得**压低**它。
   */
  it('跟拍开启会抬高 camPunch 到 0.82（上游 shelf-side 分支）', () => {
    resetCameraPunch()
    expect(tickCameraPunch()).toBe(0)
    setShelfCameraFocus(true)
    expect(tickCameraPunch()).toBeCloseTo(0.82 * 0.86, 6)
    // 取 max：已有更高冲击时不回落（先抬到 0.9，再开跟拍仍是 0.9）
    boostCameraPunch(0.9)
    setShelfCameraFocus(true)
    expect(tickCameraPunch()).toBeCloseTo(0.9 * 0.86, 6)
  })

  it('退出跟拍不加 camPunch（上游退出分支没有 camPunch）', () => {
    resetCameraPunch()
    setShelfCameraFocus(true)
    tickCameraPunch()
    resetCameraPunch()
    setShelfCameraFocus(false)
    // 退出只解除 active；若此处也 boost，每次指针移出右缘都会再推一次镜头
    expect(tickCameraPunch()).toBe(0)
  })

  it('跟拍注视点 x 必须跟随歌单架位置（同源推导）', () => {
    // 卡片列中心世界 x = shelfSideX() + SHELF_CENTER.x；偏移按**档位**取
    // （第三十四轮 §5.4 C5：上游 lookAt.x 只有两档，而 sideX 有三档）。
    const expectedX = shelfSideX() + SHELF_CENTER.x - shelfFocusLookAtOffset()
    setShelfCameraFocus(true)
    expect(orbitCameraState.focus.lookAt.x).toBeCloseTo(expectedX, 6)
    // 宽屏下 `SHELF_CENTER.x` 回到上游出厂 −0.34 后，这个推导值**就是**
    // 上游的 2.32（3.18 − 0.34 − 0.52 = 2.32）—— 不再断言"不得等于 2.32"，
    // 那个断言只在歌单架被右移到 0 时才成立（第三十三轮的代偿态）。
    expect(orbitCameraState.focus.lookAt.x).toBeCloseTo(2.32, 6)
    // 纵/横都与卡片列中心保持**该档位**的偏移关系
    expect(shelfSideX() + SHELF_CENTER.x - orbitCameraState.focus.lookAt.x).toBeCloseTo(shelfFocusLookAtOffset(), 6)
  })

  it('★ 跟拍偏移与档位参数按分档取（§5.4 C5：窄屏 −0.18 / 竖屏 +0.14 / 宽屏 +0.52）', () => {
    // 偏移表本身（纯函数，传 viewport 避开 node 无 window 的问题）
    expect(shelfFocusLookAtOffset({ width: 1600, height: 900 })).toBeCloseTo(0.52, 6)
    expect(shelfFocusLookAtOffset({ width: 900, height: 600 })).toBeCloseTo(-0.18, 6)
    expect(shelfFocusLookAtOffset({ width: 390, height: 844 })).toBeCloseTo(0.14, 6)

    // 档位参数：上游竖屏更正面（theta 0.24）、更远（radius 5.28）
    const portrait = shelfFollowTier({ width: 390, height: 844 })
    const wide = shelfFollowTier({ width: 1600, height: 900 })
    expect(portrait.theta).toBeCloseTo(0.24, 6)
    expect(portrait.radius).toBeCloseTo(5.28, 6)
    expect(wide.theta).toBeCloseTo(0.42, 6)
    expect(wide.radius).toBeCloseTo(4.2, 6)

    // ★ 三档偏移必须**不全相同** —— 此前对所有档位都用宽屏的 0.52
    const offsets = [
      shelfFocusLookAtOffset({ width: 1600, height: 900 }),
      shelfFocusLookAtOffset({ width: 900, height: 600 }),
      shelfFocusLookAtOffset({ width: 390, height: 844 }),
    ]
    expect(new Set(offsets).size, '三档偏移被压成了同一个值').toBe(3)
  })

  it('跟拍档位参数必须真的被 setShelfCameraFocus 使用（不是定义了不用）', () => {
    // node 环境无 window，shelfFollowTier() 走横屏档 ⇒ theta 0.42 / radius 4.2
    setOrbitMode('emily')
    setShelfCameraFocus(true)
    expect(orbitCameraState.focus.theta).toBeCloseTo(0.42, 6)
    expect(orbitCameraState.focus.radius).toBeCloseTo(4.2, 6)
  })

  it('地形模式跟拍分档：与粒子档同采齐平档，仅拉近幅度减半', () => {
    setOrbitMode('topography')
    setShelfCameraFocus(true)
    expect(orbitCameraState.focus.type).toBe('shelf')
    expect(orbitCameraState.focus.theta).toBeCloseTo(0.42, 6)
    // 上游俯拍档：phi 与 lookAt.y 随桌面档取 −0.12 / −0.10
    expect(orbitCameraState.focus.phi).toBeCloseTo(-0.12, 6)
    expect(orbitCameraState.focus.lookAt.y).toBeCloseTo(-0.1, 6)
    // 拉近幅度减半（主相机 8.4 → 5.2，而非 4.2）
    expect(orbitCameraState.focus.radius).toBeCloseTo(5.2, 6)
    // 其余模式不受影响（仍为桌面档的 −0.12）
    setOrbitMode('emily')
    setShelfCameraFocus(true)
    expect(orbitCameraState.focus.phi).toBeCloseTo(-0.12, 6)
    expect(orbitCameraState.focus.radius).toBeCloseTo(4.2, 6)
  })

  /**
   * 跟拍档的投影契约：跟拍姿态下整列卡片在垂直方向的落位。
   *
   * 这里把投影公式（与 CameraRig 一致：position = lookAt +
   * radius*(cosφ·sinθ, sinφ, cosφ·cosθ)）内联，钉住**上游俯拍档本身的
   * 数值结果** —— 即"忠实复刻后列落在哪里"。
   *
   * ★ 曾经的用例断言"上下间隙对称（|列中心| < 0.005）"，那是 2026-09-21
   *   **齐平档**（phi 0 / lookAt.y 0）的自洽性质。用户 2026-10-17 决策恢复
   *   上游俯拍档后该前提已撤销：俯拍下
   *     桌面档   列中心 +0.0204、上下差 1.2989
   *     地形档   列中心 +0.0141、上下差 1.0830（半径 5.2）
 *     竖屏档   列中心 −0.0716、上下差 0.9247
   *   这正是上游的观感（卡片列略偏离画面中线、下方留白更多），
   *   因此改为钉数值而不是钉对称性。
   */
  it('上游俯拍档下歌单架列的垂直落位（桌面 +0.0204）', () => {
    const fov = 45
    const project = (
      look: { x: number; y: number; z: number },
      theta: number,
      phi: number,
      radius: number,
      y: number,
    ) => {
      const cy = Math.cos(phi)
      const sy = Math.sin(phi)
      const cam = {
        x: look.x + radius * cy * Math.sin(theta),
        y: look.y + radius * sy,
        z: look.z + radius * cy * Math.cos(theta),
      }
      // 前向 + 右向 + 上向基（相机朝 lookAt）
      const f = { x: look.x - cam.x, y: look.y - cam.y, z: look.z - cam.z }
      const fn = Math.hypot(f.x, f.y, f.z)
      const fw = { x: f.x / fn, y: f.y / fn, z: f.z / fn }
      const s = { x: fw.z, y: 0, z: -fw.x }
      const sn = Math.hypot(s.x, s.y, s.z) || 1
      const sw = { x: s.x / sn, y: 0, z: s.z / sn }
      const u = {
        x: sw.y * fw.z - sw.z * fw.y,
        y: sw.z * fw.x - sw.x * fw.z,
        z: sw.x * fw.y - sw.y * fw.x,
      }
      const d = { x: 0 - cam.x, y: y - cam.y, z: 0.86 - cam.z }
      const zc = d.x * fw.x + d.y * fw.y + d.z * fw.z
      const yc = d.x * u.x + d.y * u.y + d.z * u.z
      return yc / zc / Math.tan((fov * Math.PI) / 180 / 2)
    }

    // 桌面档（node 环境无 window ⇒ 横屏档）：列中心 +0.0204、上下差 1.2989。
    // 注意地形档半径是 5.2（拉近减半），投影落位不同，见下一个用例。
    setOrbitMode('emily')
    setShelfCameraFocus(true)
    {
      const { theta, phi, radius, lookAt } = orbitCameraState.focus
      // 卡片 y = -delta * stepY（横屏 stepY = 0.68），取 ±2 档
      const top = project(lookAt, theta, phi, radius, 2 * 0.68)
      const bottom = project(lookAt, theta, phi, radius, -2 * 0.68)
      expect((top + bottom) / 2).toBeCloseTo(0.0204, 3)
      // 俯拍档下方留白更多：上下间隙差 ≈1.30（上游观感）
      expect(top - bottom).toBeCloseTo(-1.2989, 3)
    }
  })

  /**
   * 地形档：半径取 5.2（第二十二轮"拉近幅度减半"），与粒子档同一原则但
   * 投影落位不同 —— 列中心 +0.0141、上下差 1.0830。
   */
  it('地形档跟拍下歌单架列的垂直落位（列中心 +0.0141 / 上下差 1.0830）', () => {
    setOrbitMode('topography')
    setShelfCameraFocus(true)
    const { theta, phi, radius, lookAt } = orbitCameraState.focus
    const fov = 45
    const project = (
      look: { x: number; y: number; z: number },
      th: number,
      ph: number,
      r: number,
      y: number,
    ) => {
      const cy = Math.cos(ph)
      const sy = Math.sin(ph)
      const cam = {
        x: look.x + r * cy * Math.sin(th),
        y: look.y + r * sy,
        z: look.z + r * cy * Math.cos(th),
      }
      const f = { x: look.x - cam.x, y: look.y - cam.y, z: look.z - cam.z }
      const fn = Math.hypot(f.x, f.y, f.z)
      const fw = { x: f.x / fn, y: f.y / fn, z: f.z / fn }
      const s = { x: fw.z, y: 0, z: -fw.x }
      const sn = Math.hypot(s.x, s.y, s.z) || 1
      const sw = { x: s.x / sn, y: 0, z: s.z / sn }
      const u = {
        x: sw.y * fw.z - sw.z * fw.y,
        y: sw.z * fw.x - sw.x * fw.z,
        z: sw.x * fw.y - sw.y * fw.x,
      }
      const d = { x: 0 - cam.x, y: y - cam.y, z: 0.86 - cam.z }
      const zc = d.x * fw.x + d.y * fw.y + d.z * fw.z
      const yc = d.x * u.x + d.y * u.y + d.z * u.z
      return yc / zc / Math.tan((fov * Math.PI) / 180 / 2)
    }
    const top = project(lookAt, theta, phi, radius, 2 * 0.68)
    const bottom = project(lookAt, theta, phi, radius, -2 * 0.68)
    expect((top + bottom) / 2).toBeCloseTo(0.0141, 3)
    expect(top - bottom).toBeCloseTo(-1.083, 3)
  })

  /**
   * 竖屏档的投影落位（上游 `shelfProfile.portrait` 分支：theta 0.24 /
   * phi −0.06 / radius 5.28 / lookAt.y −0.18）。
   *
   * 与桌面档的差别来自档位本身，不是实现分叉 —— 桌面档的用例在 node 环境
   * （无 window）下恒走横屏档，因此竖屏档必须单独喂 viewport 验证。
   */
  it('竖屏俯拍档下歌单架列的垂直落位（列中心 −0.0716 / 上下差 0.9247）', () => {
    const tier = shelfFollowTier({ width: 390, height: 844 })
    expect(tier.phi).toBeCloseTo(-0.06, 6)
    expect(tier.lookAtY).toBeCloseTo(-0.18, 6)

    const fov = 45
    const project = (
      look: { x: number; y: number; z: number },
      theta: number,
      phi: number,
      radius: number,
      y: number,
    ) => {
      const cy = Math.cos(phi)
      const sy = Math.sin(phi)
      const cam = {
        x: look.x + radius * cy * Math.sin(theta),
        y: look.y + radius * sy,
        z: look.z + radius * cy * Math.cos(theta),
      }
      const f = { x: look.x - cam.x, y: look.y - cam.y, z: look.z - cam.z }
      const fn = Math.hypot(f.x, f.y, f.z)
      const fw = { x: f.x / fn, y: f.y / fn, z: f.z / fn }
      const s = { x: fw.z, y: 0, z: -fw.x }
      const sn = Math.hypot(s.x, s.y, s.z) || 1
      const sw = { x: s.x / sn, y: 0, z: s.z / sn }
      const u = {
        x: sw.y * fw.z - sw.z * fw.y,
        y: sw.z * fw.x - sw.x * fw.z,
        z: sw.x * fw.y - sw.y * fw.x,
      }
      const d = { x: 0 - cam.x, y: y - cam.y, z: 0.86 - cam.z }
      const zc = d.x * fw.x + d.y * fw.y + d.z * fw.z
      const yc = d.x * u.x + d.y * u.y + d.z * u.z
      return yc / zc / Math.tan((fov * Math.PI) / 180 / 2)
    }

    const look = { x: 1.08, y: tier.lookAtY, z: 0.72 }
    // 竖屏 stepY = 0.52，取 ±2 档
    const top = project(look, tier.theta, tier.phi, tier.radius, 2 * 0.52)
    const bottom = project(look, tier.theta, tier.phi, tier.radius, -2 * 0.52)
    expect((top + bottom) / 2).toBeCloseTo(-0.0716, 3)
    expect(top - bottom).toBeCloseTo(-0.9247, 3)
  })

  it('退出跟拍只关 active；type 保留到相机收敛（上游 exitTimer+收敛语义）', () => {
    setShelfCameraFocus(true)
    setShelfCameraFocus(false)
    expect(orbitCameraState.focus.active).toBe(false)
    // ★ type 不立即清空：上游退出跟拍后保留 focus.type='shelf'，由
    //   updateCamera 的收敛判定（tickShelfFocusExitSettled）清空 ——
    //   期间退出限速（shelfCameraExitSpeed）持续生效，相机缓缓滑回。
    //   立即清 type 会让退出帧掉回全速 ease，表现为相机抽搐。
    expect(orbitCameraState.focus.type).toBe('shelf')
    // 收敛判定在姿态已到位（差值全为 0）时应返回 true
    expect(
      tickShelfFocusExitSettled(
        orbitCameraState.focus.theta,
        orbitCameraState.focus.phi,
        orbitCameraState.focus.radius,
        orbitCameraState.focus.theta,
        orbitCameraState.focus.phi,
        orbitCameraState.focus.radius,
        0,
        0,
        0,
      ),
    ).toBe(true)
    // lookAt 偏差超过阈值（0.03）时不得落定
    expect(
      tickShelfFocusExitSettled(
        orbitCameraState.focus.theta,
        orbitCameraState.focus.phi,
        orbitCameraState.focus.radius,
        orbitCameraState.focus.theta,
        orbitCameraState.focus.phi,
        orbitCameraState.focus.radius,
        0.2,
        0,
        0,
      ),
    ).toBe(false)
  })

  /**
   * 回归：`camPunch` 是模块级状态，必须能被显式清零。
   *
   * 真实缺陷：它与 `orbitCameraState` 同属模块级可变状态，但此前**只有
   * 后者**在 `CameraRig` 卸载时被复位。在镜头前推脉冲未衰减完时切走舞台，
   * 残留值会带进下次进入视觉模式（表现为"刚进模式镜头猛地一推"），
   * 且卸载期间无人调用 `tickCameraPunch`，它**不会自行衰减**。
   */
  it('resetCameraPunch 清零模块级 camPunch（卸载清理义务）', () => {
    boostCameraPunch(0.5)
    expect(tickCameraPunch()).toBeGreaterThan(0)
    resetCameraPunch()
    // 清零后再衰减一次应仍为 0（而不是残留值 × 0.86）
    expect(tickCameraPunch()).toBe(0)
  })

  /**
   * 回归：拖拽/滚轮必须**取消进行中的回正**。
   *
   * 上游 `00-pointer-cover-particles.js:135`（拖拽）与 `:173`（滚轮）都做
   * `if (orbit.recentering) orbit.recentering = false`。此前本项目只在
   * `recenterCamera()` 里置 true、从不取消，于是双击回正后立刻拖动时，
   * 回正分支每帧仍把 userTheta/Phi/Radius 往基准拉，与拖拽互相角力 ——
   * 表现为"回正过程中拖不动/缩放被吞掉"。
   *
   * 这里用源码断言钉住结构（该逻辑在 CameraRig 的原生事件处理器里，
   * 无法在不挂载 R3F 的情况下直接驱动）。
   */
  it('拖拽与滚轮都会取消回正（源码结构断言）', () => {
    const rig = readFileSync(join(__dirname, 'CameraRig.tsx'), 'utf8')
    // 取消语句必须存在，且至少出现两处（拖拽处理器 + 滚轮处理器）
    const cancels = (rig.match(/if \(state\.recentering\) state\.recentering = false/g) ?? []).length
    expect(cancels).toBeGreaterThanOrEqual(2)
  })

  it('普通曲目不累积 theta 冲击（上游仅在 DJ 模式累加）', () => {
    // 上游 02-beat-camera-runtime.js:998-1002：thetaKick 仅在 leadEvent.dj 时累加，
    // dj 来自 djMode.active，出厂 false（03-beat-dj-state.js:87）。
    const rig = readFileSync(join(__dirname, 'CameraRig.tsx'), 'utf8')
    expect(rig).not.toMatch(/kick\.theta \+= 0\.0022/)
  })

  it('clearShelfFocus 无条件清除跟拍', () => {
    setShelfCameraFocus(true)
    clearShelfFocus()
    expect(orbitCameraState.focus.active).toBe(false)
    expect(orbitCameraState.focus.type).toBe(null)
  })

  it('shortestAngleDelta 走最短路（跨 ±π 不绕远）', () => {
    expect(shortestAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6)
    // 从 3.0 到 -3.0 应走 +0.28 而不是 -6.0
    expect(shortestAngleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6.0, 5)
    expect(Math.abs(shortestAngleDelta(0, 5))).toBeLessThanOrEqual(Math.PI + 1e-9)
  })
})
