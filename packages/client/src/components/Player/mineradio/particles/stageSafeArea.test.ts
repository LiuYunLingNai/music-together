import { beforeEach, describe, expect, it } from 'vitest'
import { SHELF_CENTER, shelfSideX } from './floatingSongCard'
import {
  projectStageContentExtent,
  STAGE_PAN_DURATION_MS,
  clearStageSafeArea,
  publishStagePanFraction,
  resolveStagePanFraction,
  setStagePanDuration,
  stagePanEase,
  stageSafeArea,
  stageProjectionShiftX,
  stepStageSafeArea,
} from './stageSafeArea'

/**
 * 回归：侧栏展开时的舞台退让（HANDOFF §2 D12）。
 *
 * 这块最容易写错的是**方向**、**"让开就够"**与**换算机制**三点：
 *
 *   ① 构图不以相机轴线为中心（内容 29.96%..86.86%，中心 58.4%），
 *      所以"居中"式规则会把内容整幅右移 —— 实测左栏展开（桌面默认开着）
 *      时歌单架被从 86.9% 推到 97.2%，**反而**更容易被聊天面板盖住。
 *   ② 面板展开不一定要动：左栏展开时内容本来就落在可用区内。
 *   ③ 换算必须走**离轴投影**。相机平移是世界空间的，而透视按深度缩放 ——
 *      同一世界位移在近处（歌曲架 z≈0.98）与远处（歌词 z≈2.24）的**屏幕**
 *      位移不等，挑任何单一深度换算都会留残差（实测挑 lookAt 深度时 1366
 *      上残差 1.05%）。离轴投影所有深度平移量严格相同。
 */

/** 与 RoomPage 同源：PANEL_EDGE_INSET = clamp(12px, 2vw, 24px)。 */
function edgeInset(width: number): number {
  return Math.min(24, Math.max(12, width * 0.02))
}
const HOT_SONGS_PANEL_WIDTH = 288
const CHAT_PANEL_WIDTH = 320
const PANEL_CONTENT_GAP = 16

function insets(width: number, hotSongs: boolean, chat: boolean): { left: number; right: number } {
  const edge = edgeInset(width)
  return {
    left: hotSongs ? edge + HOT_SONGS_PANEL_WIDTH + PANEL_CONTENT_GAP : 0,
    right: chat ? edge + CHAT_PANEL_WIDTH + PANEL_CONTENT_GAP : 0,
  }
}

/**
 * 把世界点投影到屏幕比例 —— 复刻 CameraRig 的合成：
 * 相机姿态（emily 档 radius 6.6 / phi 0.08 / theta 0，看向歌词锚点）
 * + 离轴投影偏移。
 */
function screenX(width: number, height: number, panFraction: number, worldX: number, worldY = 0, worldZ = 0): number {
  const radius = 6.6
  const phi = 0.08
  const lookAt = { x: 0, y: -0.18, z: 1.55 }
  const cam = {
    x: lookAt.x,
    y: lookAt.y + radius * Math.sin(phi),
    z: lookAt.z + radius * Math.cos(phi),
  }
  // theta = 0 ⇒ 看向 -z；右轴即世界 +x，上轴近似世界 +y（phi 很小）
  const forward = { x: lookAt.x - cam.x, y: lookAt.y - cam.y, z: lookAt.z - cam.z }
  const fl = Math.hypot(forward.x, forward.y, forward.z)
  const f = { x: forward.x / fl, y: forward.y / fl, z: forward.z / fl }
  const up = { x: 0, y: 1, z: 0 }
  let right = {
    x: f.y * up.z - f.z * up.y,
    y: f.z * up.x - f.x * up.z,
    z: f.x * up.y - f.y * up.x,
  }
  const rl = Math.hypot(right.x, right.y, right.z)
  right = { x: right.x / rl, y: right.y / rl, z: right.z / rl }
  const d = { x: worldX - cam.x, y: worldY - cam.y, z: worldZ - cam.z }
  const camZ = d.x * f.x + d.y * f.y + d.z * f.z
  const camX = d.x * right.x + d.y * right.y + d.z * right.z
  const tanHalf = Math.tan((45 * Math.PI) / 360)
  const halfW = camZ * tanHalf * (width / height)
  // NDC 再叠加离轴偏移：three.js 里 `ndc.x = 正常 ndc.x − elements[8]`
  // （`clip.x = e0·x + e8·z`，`clip.w = −z` ⇒ e8 项贡献 −e8），故取**减**。
  const ndcX = camX / halfW - stageProjectionShiftX(panFraction)
  return (ndcX + 1) / 2
}

const COVER_R = 2.4 // emily(SILK) 方盘，最坏情况
// ★ 卡片列中心必须**从真实来源推导**，不能硬编码（第三十四轮修，§5.4 C3）。
//
//   此前写死 `2.84` —— 那是 `3.18 − 0.34`，即 **D13 之前**的列中心。
//   当前 `SHELF_CENTER.x = 0`（§2 D13），列中心是 `shelfSideX() + 0`。
//   硬编码的后果：整套回归**验证的是一个已不存在的列位置**，于是常量取错
//   （C2：`STAGE_CONTENT_RIGHT` 仍是 x=+0.20 时代的 0.9147）也照样全绿。
const SHELF_COLUMN_X = shelfSideX() + SHELF_CENTER.x
const SHELF_HALF = ((2.05 * (1.12 * 0.92)) / 2) * Math.cos(0.28 - (11 * Math.PI) / 180)
const SHELF_LEFT_WORLD = SHELF_COLUMN_X - SHELF_HALF
const SHELF_RIGHT_WORLD = SHELF_COLUMN_X + SHELF_HALF
const SHELF_Z = 0.98 // applyFloatingSongCardPose：0.86 + SHELF_CENTER.z 0.12
const SHELF_Y = -0.2

describe('侧栏退让 · 位移规则', () => {
  it('无面板时恒不动', () => {
    expect(resolveStagePanFraction(0, 0, 1600)).toBe(0)
  })

  it('左栏展开（桌面默认）**不**移动 —— 左栏盖不到右侧的歌单架', () => {
    const { left, right } = insets(1600, true, false)
    expect(resolveStagePanFraction(left, right, 1600)).toBe(0)
  })

  it('右栏展开必须**左移**内容（让开聊天面板）', () => {
    const { left, right } = insets(1600, false, true)
    expect(resolveStagePanFraction(left, right, 1600), '右栏展开却不退让').toBeLessThan(0)
  })

  it('★ 左栏展开时不得右移 —— 回归"居中"式错法（方向反了）', () => {
    // 桌面默认就是左栏开着。居中式规则给出**正**值 → 把内容推向右侧的
    // 聊天面板区域，反而更容易被盖住；正确行为是**不动**。
    for (const width of [1366, 1600, 1920, 2560]) {
      const { left, right } = insets(width, true, false)
      const centering = (left - right) / (2 * width)
      expect(centering, `${width}: 居中式应给出正值才能证明本回归有效`).toBeGreaterThan(0)
      expect(resolveStagePanFraction(left, right, width), `${width}: 左栏展开时不应移动`).toBe(0)
    }
  })

  it('★ 右栏展开时方向与居中式一致，但幅度不绑定它（只求"让开"）', () => {
    for (const width of [1366, 1600, 1920]) {
      const { left, right } = insets(width, false, true)
      const pan = resolveStagePanFraction(left, right, width)
      const centering = (left - right) / (2 * width)
      // 同号（都左移）——这是"方向不能反"的核心
      expect(Math.sign(pan)).toBe(Math.sign(centering))
      // 幅度由「让开就够」推出，与居中式不必相等（窄屏上会略大，
      // 因为构图右重、右端比左端更早触界）。
      expect(pan).toBeLessThan(0)
    }
  })

  it('右栏展开的位移量随视口变宽而单调减小（面板占比变小）', () => {
    const widths = [1366, 1600, 1920, 2560]
    const pans = widths.map((w) => {
      const { left, right } = insets(w, false, true)
      return resolveStagePanFraction(left, right, w)
    })
    for (let i = 1; i < pans.length; i++) {
      expect(Math.abs(pans[i]), `${widths[i]} 的位移应小于 ${widths[i - 1]}`).toBeLessThan(Math.abs(pans[i - 1]))
    }
  })

  it('两栏都开时也得给中间留出空间', () => {
    const { left, right } = insets(1600, true, true)
    expect(resolveStagePanFraction(left, right, 1600)).toBeLessThan(0)
  })

  it('位移量是**最小**的：刚好让开，不多移', () => {
    const width = 1600
    const { left, right } = insets(width, false, true)
    const pan = resolveStagePanFraction(left, right, width)
    const availRight = 1 - right / width
    // ★ 用**实算**的构图范围，不用写死的常量（§5.4 C1/C2）
    const extent = projectStageContentExtent(16 / 9, SHELF_COLUMN_X)
    const contentRight = extent.right + pan
    const contentLeft = extent.left + pan
    expect(contentRight).toBeGreaterThan(availRight - 1e-9)
    expect(contentRight).toBeLessThan(availRight + 1e-9)
    expect(contentLeft).toBeGreaterThanOrEqual(left / width - 1e-9)
  })

  it('极端视口下也必须有限且不越界（NaN/Infinity 防护）', () => {
    for (const args of [
      [0, 0, 0],
      [Number.NaN, 100, 1200],
      [100, Number.NaN, 1200],
      [100, 100, Number.NaN],
      [-50, -50, 1200],
      [5000, 5000, 800],
    ] as const) {
      const pan = resolveStagePanFraction(args[0], args[1], args[2])
      expect(Number.isFinite(pan), `resolveStagePanFraction(${args.join(',')}) = ${pan}`).toBe(true)
      expect(Math.abs(pan)).toBeLessThanOrEqual(1)
    }
  })
})

describe('侧栏退让 · 构图范围必须按宽高比实算（§5.4 C1/C2）', () => {
  /**
   * 核心不变量：three 的 `PerspectiveCamera.fov` 是**垂直** FOV，
   * 因此固定世界坐标的**水平**屏幕占比**必然随宽高比变化**。
   *
   * 第三十三轮把范围写死成一对单次实测的常量（0.2996 / 0.9147），于是
   * 在非 16:9 窗口下要么让不够、要么让过头。这里钉住"确实随宽高比变化" ——
   * 若有人改回常量，本用例立刻失败。
   */
  it('★ 同一世界点在不同宽高比下的水平占比必须不同（写死常量即失败）', () => {
    const narrow = projectStageContentExtent(1.3, SHELF_COLUMN_X)
    const wide = projectStageContentExtent(2.6, SHELF_COLUMN_X)
    expect(narrow.right, '窄画布上卡片列应更靠右').toBeGreaterThan(wide.right)
    // 差距必须显著（不是浮点噪声）——实测 1.3 vs 2.6 相差 30pp 以上
    expect(narrow.right - wide.right).toBeGreaterThan(0.2)
  })

  it('右缘随宽高比单调递减', () => {
    const aspects = [1.2, 1.5, 1.78, 2.0, 2.4, 2.8]
    const rights = aspects.map((a) => projectStageContentExtent(a, SHELF_COLUMN_X).right)
    for (let i = 1; i < rights.length; i++) {
      expect(rights[i], `aspect ${aspects[i]} 的右缘应小于 ${aspects[i - 1]}`).toBeLessThan(rights[i - 1])
    }
  })

  it('★ 窄画布上必须让得**更多**（写死常量会让不够）', () => {
    const width = 1600
    const { left, right } = insets(width, false, true)
    const panWide = resolveStagePanFraction(left, right, width, 2.4, SHELF_COLUMN_X)
    const panNarrow = resolveStagePanFraction(left, right, width, 1.4, SHELF_COLUMN_X)
    expect(panNarrow, '窄画布应比宽画布让得更多（更负）').toBeLessThan(panWide)
  })

  it('★ 超宽画布不应过度退让（写死常量会退过头）', () => {
    const width = 1600
    const { left, right } = insets(width, false, true)
    const pan = resolveStagePanFraction(left, right, width, 2.8, SHELF_COLUMN_X)
    expect(pan, '超宽画布不应大幅左移').toBeGreaterThan(-0.05)
  })

  it('相机基线按模式参与估算（地形档更远 ⇒ 卡片更靠中心）', () => {
    const emily = projectStageContentExtent(16 / 9, SHELF_COLUMN_X, 'emily')
    const topo = projectStageContentExtent(16 / 9, SHELF_COLUMN_X, 'topography')
    expect(topo.right, '地形档 radius 8.4 更远，卡片列应更靠内').toBeLessThan(emily.right)
  })

  it('非法宽高比回退而非产生 NaN', () => {
    for (const a of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const e = projectStageContentExtent(a, SHELF_COLUMN_X)
      expect(Number.isFinite(e.left), `aspect=${a} 的 left`).toBe(true)
      expect(Number.isFinite(e.right), `aspect=${a} 的 right`).toBe(true)
    }
  })

  it('无面板时恒不动（与宽高比无关）', () => {
    for (const a of [1.2, 1.78, 2.4]) {
      expect(resolveStagePanFraction(0, 0, 1600, a, SHELF_COLUMN_X)).toBe(0)
    }
  })
})

describe('侧栏退让 · 离轴投影换算', () => {
  it('0 与非有限输入恒为 0', () => {
    expect(stageProjectionShiftX(0)).toBe(0)
    expect(stageProjectionShiftX(Number.NaN)).toBe(0)
    expect(stageProjectionShiftX(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('方向：内容要右移（正 pan）⇒ elements[8] 取负', () => {
    // elements[8] 增大会把画面推向左，与"内容右移"反向
    expect(stageProjectionShiftX(0.1)).toBeLessThan(0)
    expect(stageProjectionShiftX(-0.1)).toBeGreaterThan(0)
  })

  it('★ 屏幕位移与深度**严格无关** —— 这是选离轴投影而非平移机位的理由', () => {
    // 四个差异极大的深度（封面 z=0 / 歌曲架 z=0.98 / 歌词 z=2.235 / 更远）
    const samples: Array<[number, number]> = [
      [-2.4, 0],
      [SHELF_RIGHT_WORLD, SHELF_Z],
      [3.0, 2.235],
      [1.0, 1.55],
    ]
    const pan = -0.0936
    const deltas = samples.map(([x, z]) => screenX(1600, 900, pan, x, 0, z) - screenX(1600, 900, 0, x, 0, z))
    for (const delta of deltas) {
      expect(delta, '各深度的屏幕位移必须完全一致').toBeCloseTo(pan, 10)
    }
  })

  it('换算量恰为 −2×panFraction（NDC 增量 = 2Δ）', () => {
    expect(stageProjectionShiftX(-0.0936)).toBeCloseTo(0.1872, 12)
  })
})

describe('侧栏退让 · 端到端屏幕位置', () => {
  const shelfRightAt = (width: number, height: number, pan: number) =>
    screenX(width, height, pan, SHELF_RIGHT_WORLD, SHELF_Y, SHELF_Z)

  it('右栏展开后歌曲架不再被面板盖住（真正重叠的视口）', () => {
    for (const [width, height] of [
      [1366, 768],
      [1600, 900],
      [1920, 1080],
    ]) {
      const { left, right } = insets(width, false, true)
      const pan = resolveStagePanFraction(left, right, width)
      const availRight = 1 - right / width
      const noPan = shelfRightAt(width, height, 0)
      expect(noPan, `${width}: 让开前应当确实越界`).toBeGreaterThan(availRight)
      const shelfRight = shelfRightAt(width, height, pan)
      expect(shelfRight, `${width}: 让开后歌曲架仍被聊天面板盖住`).toBeLessThanOrEqual(availRight + 0.003)
    }
  })

  it('左栏展开（桌面默认）时位置完全不变 —— 不得引入无谓位移', () => {
    for (const [width, height] of [
      [1600, 900],
      [1920, 1080],
    ]) {
      const { left, right } = insets(width, true, false)
      const pan = resolveStagePanFraction(left, right, width)
      expect(pan).toBe(0)
      expect(screenX(width, height, pan, SHELF_LEFT_WORLD, SHELF_Y, SHELF_Z)).toBeCloseTo(
        screenX(width, height, 0, SHELF_LEFT_WORLD, SHELF_Y, SHELF_Z),
        12,
      )
    }
  })

  it('退让后封面盘仍留在可用区内（不得把左侧内容推出去）', () => {
    for (const [width, height] of [
      [1366, 768],
      [1600, 900],
      [1920, 1080],
      [2560, 1440],
    ]) {
      const { left, right } = insets(width, false, true)
      const pan = resolveStagePanFraction(left, right, width)
      const coverLeft = screenX(width, height, pan, -COVER_R)
      expect(coverLeft, `${width}: 退让把封面推到了左栏之下`).toBeGreaterThanOrEqual(left / width - 0.003)
    }
  })
})

/**
 * 回归：退让的**过渡**（第三十三轮补）。
 *
 * 最初只抄了"让开多少"的静态结果、没抄过渡 —— 开关面板时画面**瞬间跳变**，
 * 与经典播放器的 `transition: padding-inline 200ms ease-out` 一比就是硬切。
 * 这里钉住时长、曲线与插值语义。
 */
describe('侧栏退让 · 过渡缓动', () => {
  beforeEach(() => {
    clearStageSafeArea()
  })

  /** CSS ease-out = cubic-bezier(0, 0, 0.58, 1) 的参考值（独立算出）。 */
  function cssEaseOutRef(t: number): number {
    const axis = (u: number, p1: number, p2: number) => {
      const i = 1 - u
      return 3 * i * i * u * p1 + 3 * i * u * u * p2 + u * u * u
    }
    let lo = 0
    let hi = 1
    let u = t
    for (let k = 0; k < 60; k++) {
      if (axis(u, 0, 0.58) < t) lo = u
      else hi = u
      u = (lo + hi) / 2
    }
    return axis(u, 0, 1)
  }

  it('★ 缓动曲线必须等于 CSS ease-out（cubic-bezier(0,0,0.58,1)）', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(stagePanEase(t), `t=${t}`).toBeCloseTo(cssEaseOutRef(t), 4)
    }
    // 且**不是**线性 —— 线性看起来是机械匀速位移
    expect(stagePanEase(0.25)).toBeGreaterThan(0.25)
    expect(stagePanEase(0.5)).toBeGreaterThan(0.5)
  })

  it('端点与非法输入：0 → 0、1 → 1、越界夹取', () => {
    expect(stagePanEase(0)).toBe(0)
    expect(stagePanEase(1)).toBe(1)
    expect(stagePanEase(-1)).toBe(0)
    expect(stagePanEase(2)).toBe(1)
    expect(stagePanEase(Number.NaN)).toBe(0)
  })

  it('★ 200ms 内按帧推进：必须是**渐进**的，不能一帧到位', () => {
    setStagePanDuration(STAGE_PAN_DURATION_MS)
    publishStagePanFraction(-0.094)
    // 首帧（16.7ms = 全程的 8.3%）用 ease-out 只走约 13.5%（前端很陡但远未到位）
    const first = stepStageSafeArea(1 / 60)
    expect(first).toBeLessThan(0)
    expect(Math.abs(first), '首帧就跳到目标 —— 没有过渡').toBeLessThan(Math.abs(-0.094) * 0.5)
    // 逐帧累积，约 200ms 后到位
    for (let i = 0; i < 20; i++) stepStageSafeArea(1 / 60)
    expect(stageSafeArea.panFraction).toBeCloseTo(-0.094, 6)
  })

  it('过渡耗时约 200ms（±2 帧 @60fps）', () => {
    setStagePanDuration(STAGE_PAN_DURATION_MS)
    publishStagePanFraction(-0.1)
    let frames = 0
    while (stageSafeArea.progress < 1 && frames < 600) {
      stepStageSafeArea(1 / 60)
      frames++
    }
    const ms = frames * (1000 / 60)
    expect(ms).toBeGreaterThan(200 - 40)
    expect(ms).toBeLessThan(200 + 40)
  })

  it('★ 快速反向（连点开关）不会跳变：必须从**当前位置**继续', () => {
    setStagePanDuration(STAGE_PAN_DURATION_MS)
    publishStagePanFraction(-0.1)
    for (let i = 0; i < 5; i++) stepStageSafeArea(1 / 60)
    const mid = stageSafeArea.panFraction
    expect(mid, '中途应已走了一段').toBeLessThan(0)
    expect(mid).toBeGreaterThan(-0.1)
    // 反向：目标改为 0
    publishStagePanFraction(0)
    const afterSwitch = stepStageSafeArea(1 / 60)
    // 不得跳回 0（那是硬切），也不得继续往 -0.1 走
    expect(afterSwitch).toBeLessThanOrEqual(0)
    expect(afterSwitch, '反向时跳变了').toBeGreaterThanOrEqual(mid)
    expect(afterSwitch).toBeGreaterThan(-0.1)
  })

  it('同值重复 publish 不重启动画（ResizeObserver 每次回调都会调用它）', () => {
    setStagePanDuration(STAGE_PAN_DURATION_MS)
    publishStagePanFraction(-0.08)
    for (let i = 0; i < 4; i++) stepStageSafeArea(1 / 60)
    const before = stageSafeArea.panFraction
    const progressBefore = stageSafeArea.progress
    // 同一目标重复发布若干次
    for (let i = 0; i < 10; i++) publishStagePanFraction(-0.08)
    expect(stageSafeArea.progress, '重复发布把进度重置了 —— 动画会卡在开头').toBe(progressBefore)
    expect(stageSafeArea.panFraction).toBe(before)
  })

  it('减弱动效：时长为 0 时立即到位（对应 CSS 的 0.01ms）', () => {
    setStagePanDuration(0)
    publishStagePanFraction(-0.12)
    expect(stepStageSafeArea(1 / 60)).toBeCloseTo(-0.12, 9)
  })

  it('到位后保持目标值，不会因浮点尾巴持续变化', () => {
    setStagePanDuration(STAGE_PAN_DURATION_MS)
    publishStagePanFraction(-0.07)
    for (let i = 0; i < 60; i++) stepStageSafeArea(1 / 60)
    expect(stageSafeArea.panFraction).toBe(-0.07)
    const again = stepStageSafeArea(1 / 60)
    expect(again).toBe(-0.07)
  })

  it('clearStageSafeArea 复位全部过渡状态（红线 22）', () => {
    publishStagePanFraction(-0.05)
    stepStageSafeArea(1 / 60)
    clearStageSafeArea()
    expect(stageSafeArea.panFraction).toBe(0)
    expect(stageSafeArea.targetPanFraction).toBe(0)
    expect(stageSafeArea.progress).toBe(1)
    expect(stageSafeArea.durationMs).toBe(STAGE_PAN_DURATION_MS)
  })
})
