import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyFloatingSongCardPose,
  createCardPulse,
  pulseCard,
  stepCardPulse,
  SHELF_CARD_PULSE_DURATION,
  type ShelfCardPoseInput,
} from './floatingSongCard'

/**
 * 回归：侧栏卡片姿态的**上游包络**（`placeCard` side 分支）。
 *
 * ============================ 本轮补齐的五个缺口 ============================
 *
 * 上游 `01-manager-core.js:415-512` 的 side 分支一共读了六组量，本项目此前
 * 只实现了"指针 hover 直接当偏移"，缺了：
 *
 *   ① `fxPulse` 撞击脉冲 —— 进缩放（`+pulse*0.056`）与不透明度思路
 *      （`+pulse*0.10*reveal`，在 `FloatingSongShelf` 里）
 *   ② `reveal`/`entry` 的**位姿**分量 —— 只在不透明度里用过 reveal
 *   ③ `hoverBreath` 门控 = `shelfVisibility`（此前是常数 1）
 *   ④ `lift`/`floatMix` 双速抬升（此前与指针 hover 混为一谈）
 *   ⑤ `sideEntryX` 入场横移量（此前整个没移植）
 *
 * 本文件用数值复算钉住这五项，而不是钉源码文本。
 *
 * ★ `paneEase` 恒 0（本项目无"歌单页"切换），故不参与断言。
 */

/** 一个空包络：所有量都在上游的"稳态已打开"位置。 */
const STABLE: ShelfCardPoseInput = {
  visibility: 1,
  lift: 0,
  reveal: 1,
  pulse: 0,
  parX: 0,
  parY: 0,
}

/** 建一个与 `createFloatingSongCardMesh` 同规格的 plane（这里只关心变换）。 */
function makeMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.025), new THREE.MeshBasicMaterial())
}

/** 跑一帧姿态，返回 pose 结果。 */
function pose(input: Partial<ShelfCardPoseInput>, cardIndex: number, center = 0) {
  const mesh = makeMesh()
  const distance = applyFloatingSongCardPose(mesh, 10, cardIndex, center, { ...STABLE, ...input })
  return { mesh, distance }
}

describe('applyFloatingSongCardPose · reveal/entry 位姿分量', () => {
  /**
   * 上游 :462-464：
   *   px = sideX + absD*sideXStep + entry*sideEntryX
   *   py = sideY - delta*sideYStep + (1-reveal)*(delta<0 ? -0.18 : 0.18)*slide
   *   pz = sideZ - absD*sideZStep - (1-reveal)*0.20*slide
   *   entry = (1-reveal)*(0.82 + absD*0.075*stagger)*slide
   *
   * 横屏档 sideXStep 0.04 / sideEntryX 0.82 / slide 1.9。
   */
  it('reveal = 0（刚触发揭示）时卡片整体外移，且 absD 越大移得越远', () => {
    // 中心卡：absD = 0 ⇒ entry = 0.82 * 1.9 = 1.558，再乘 sideEntryX 0.82
    const center0 = pose({ reveal: 0 }, 0, 0)
    // sideX = 3.18 - 0.34 = 2.84；absD = 0 ⇒ px = 2.84 + 1.558*0.82 = 4.11756
    expect(center0.mesh.position.x).toBeCloseTo(2.84 + 0.82 * 1.9 * 0.82, 6)
    // py：delta = 0 ⇒ 上下项取 +0.18（上游 `delta < 0 ? -0.18 : 0.18`），
    // 再加中心卡的呼吸项（parWeight = 1）
    expect(center0.mesh.position.y).toBeCloseTo(-0.2 + 0.18 * 1.9 + Math.sin(10 * 0.92) * 0.052, 6)
    // pz：0.86 + 0.12 - 0 - 0.20*1.9 = 0.98 - 0.38 = 0.60（+ 呼吸 z 项）
    expect(center0.mesh.position.z).toBeCloseTo(0.98 - 0.2 * 1.9 + Math.cos(10 * 0.78) * 0.03, 6)

    // 第 3 格卡：absD = 3 ⇒ entry = (0.82 + 0.225) * 1.9 = 1.9855，再乘 0.82
    const far = pose({ reveal: 0 }, 3, 0)
    expect(far.mesh.position.x).toBeCloseTo(2.84 + 3 * 0.04 + (0.82 + 3 * 0.075) * 1.9 * 0.82, 6)
    // 下方卡（delta > 0）⇒ py 的上下项为 **+**0.18（absD = 3 ⇒ parWeight 0.52）
    expect(far.mesh.position.y).toBeCloseTo(
      -0.2 - 3 * 0.68 + 0.18 * 1.9 + Math.sin(10 * 0.92 + 3 * 0.64) * 0.052 * 0.52,
      6,
    )
    // pz 与 absD 有关，与 delta 方向无关
    expect(far.mesh.position.z).toBeCloseTo(
      0.98 - 3 * 0.17 - 0.2 * 1.9 + Math.cos(10 * 0.78 + 3 * 0.52) * 0.03 * 0.52,
      6,
    )
  })

  it('reveal = 1（揭示完成）时入场量全部归零', () => {
    const mesh0 = pose({ reveal: 1 }, 0, 0).mesh
    // 注意 y/z 仍有呼吸摆幅（visibility = 1），这里 t = 10 ⇒ 摆幅非零
    expect(mesh0.position.x).toBeCloseTo(2.84, 6)
    expect(mesh0.position.y).toBeCloseTo(-0.2 + Math.sin(10 * 0.92 + 0 * 0.64) * 0.052, 6)
    expect(mesh0.position.z).toBeCloseTo(0.98 + Math.cos(10 * 0.78 + 0 * 0.52) * 0.03, 6)
  })

  it('★ 上方卡（delta < 0）的上下入场项取 −0.18，与下方相反', () => {
    const above = pose({ reveal: 0 }, -2, 0)
    // delta = -2 ⇒ py = sideY - (-2)*0.68 + (-0.18)*1.9（+ 呼吸项）
    expect(above.mesh.position.y).toBeCloseTo(
      -0.2 + 2 * 0.68 - 0.18 * 1.9 + Math.sin(10 * 0.92 + -2 * 0.64) * 0.052 * 0.68,
      6,
    )
    const below = pose({ reveal: 0 }, 2, 0)
    expect(below.mesh.position.y).toBeCloseTo(
      -0.2 - 2 * 0.68 + 0.18 * 1.9 + Math.sin(10 * 0.92 + 2 * 0.64) * 0.052 * 0.68,
      6,
    )
    // 两者必须真的分开 —— 上游靠这一项让整列从中心向两侧"展开"。
    //
    // above - below = (2*stepY - (-0.18*1.9)) - (-2*stepY + 0.18*1.9) + 呼吸差
    //              = 4*stepY - 0.36*1.9 + 呼吸差
    // 呼吸项对 ±2 是**同频同幅**（cardIndex 的相位不同，故不能指望抵消），
    // 因此把它显式算进来，而不是假装它会抵消。
    const pw = 1 - 2 * 0.16
    const breath =
      Math.sin(10 * 0.92 - 2 * 0.64) * 0.052 * pw - Math.sin(10 * 0.92 + 2 * 0.64) * 0.052 * pw
    expect(above.mesh.position.y - below.mesh.position.y).toBeCloseTo(4 * 0.68 - 0.36 * 1.9 + breath, 6)
  })

  it('revealScale 进缩放：reveal = 0 时卡片小 12%', () => {
    // 上游 :493：`revealScale = 1 - (1 - reveal) * 0.12 * summon.scale`（scale 出厂 1）
    const half = pose({ reveal: 0.5 }, 0, 0).mesh.scale.x
    const full = pose({ reveal: 1 }, 0, 0).mesh.scale.x
    // 中心卡基础 1.12，reveal 0.5 ⇒ 1.12 * (1 - 0.06) = 1.0528；
    // 再乘 (1 + breathPulse*0.026)（t = 10, idx = 0）与 sideScale 0.92
    const bp = 0.5 + 0.5 * Math.sin(10 * 1.22)
    expect(half).toBeCloseTo(1.12 * (1 - 0.5 * 0.12) * (1 + bp * 0.026) * 0.92, 6)
    expect(full).toBeCloseTo(1.12 * (1 + bp * 0.026) * 0.92, 6)
  })

  it('rotY 含 (1-reveal)*0.16*slide 的入场旋转（非壁纸安全档）', () => {
    // 上游 :490：`rotation.y = sideRotY + (1-reveal)*safeEntryRotY*slide + parX*0.038*parWeight`
    // 横屏 sideRotY = 0.28，shelfAngleY = -11° ⇒ 基础 0.28 - 0.19199
    const base = 0.28 - (11 * Math.PI) / 180
    const closed = pose({ reveal: 0 }, 0, 0).mesh.rotation.y
    const open = pose({ reveal: 1 }, 0, 0).mesh.rotation.y
    expect(closed).toBeCloseTo(base + 0.16 * 1.9, 6)
    expect(open).toBeCloseTo(base, 6)
  })
})

describe('applyFloatingSongCardPose · hoverBreath 门控', () => {
  /**
   * 上游 :441：`hoverBreath = (!shelfPinnedOpen && !detailOpenSide) ? shelfVisibility : 0`
   * ⇒ 本项目的门控就是 `visibility`。
   *
   * ★ 此前这里是**常数 1**：理由写"本项目卡片常驻无 shelfVisibility 淡入淡出"，
   *   而该前提在召唤包络移植后已不成立（静止态 visibility = 0）。
   */
  it('visibility = 0 时呼吸摆幅为零（卡片不可见也不许动）', () => {
    const mesh = makeMesh()
    applyFloatingSongCardPose(mesh, 3.7, 1, 0, { ...STABLE, visibility: 0 })
    // 只留基准位姿：sideX + 1*stepX，y = sideY - 1*stepY（reveal = 1 ⇒ 无入场项）
    expect(mesh.position.y).toBeCloseTo(-0.2 - 0.68, 6)
    expect(mesh.position.z).toBeCloseTo(0.98 - 0.17, 6)
    // x 侧同理：sideX + 1*stepX，无入场横移
    expect(mesh.position.x).toBeCloseTo(2.84 + 0.04, 6)
  })

  it('visibility = 1 时呼吸摆幅就是上游的 sin/cos 系数', () => {
    // 上游 :470-471：
    //   py += sin(nowT*0.92 + idx*0.64) * 0.052 * hoverBreath * max(0.20, parWeight)
    //   pz += cos(nowT*0.78 + idx*0.52) * 0.030 * hoverBreath * parWeight
    // absD = 1 ⇒ parWeight = max(0, 1 - 0.16) = 0.84
    const t = 3.7
    const idx = 1
    const mesh = makeMesh()
    applyFloatingSongCardPose(mesh, t, idx, 0, { ...STABLE, visibility: 1 })
    const parWeight = 1 - 1 * 0.16
    expect(mesh.position.y).toBeCloseTo(-0.2 - 0.68 + Math.sin(t * 0.92 + idx * 0.64) * 0.052 * Math.max(0.2, parWeight), 6)
    expect(mesh.position.z).toBeCloseTo(
      0.98 - 0.17 + Math.cos(t * 0.78 + idx * 0.52) * 0.03 * parWeight,
      6,
    )
  })

  it('★ 呼吸量随 visibility 线性缩放（不是 0/1 硬切）', () => {
    const t = 2.2
    const idx = 0
    const half = makeMesh()
    applyFloatingSongCardPose(half, t, idx, 0, { ...STABLE, visibility: 0.5 })
    const full = makeMesh()
    applyFloatingSongCardPose(full, t, idx, 0, { ...STABLE, visibility: 1 })
    // 中心卡 parWeight = 1 ⇒ 摆幅与 visibility 严格成正比
    expect(half.position.y - -0.2).toBeCloseTo((full.position.y - -0.2) * 0.5, 6)
    expect(half.position.z - 0.98).toBeCloseTo((full.position.z - 0.98) * 0.5, 6)
  })
})

describe('applyFloatingSongCardPose · lift 选中抬升', () => {
  /**
   * 上游 :475-480：
   *   px -= lift * (portrait ? 0.065 : 0.145)
   *   py += lift * (portrait ? 0.075 : 0.105)
   *   pz += lift * 0.220
   */
  it('lift 只对横屏档的这一组系数生效', () => {
    const lifted = pose({ lift: 1 }, 0, 0).mesh
    const base = pose({ lift: 0 }, 0, 0).mesh
    expect(lifted.position.x - base.position.x).toBeCloseTo(-0.145, 6)
    expect(lifted.position.y - base.position.y).toBeCloseTo(0.105, 6)
    expect(lifted.position.z - base.position.z).toBeCloseTo(0.22, 6)
  })

  it('lift 同时进缩放（+lift*0.075）与指针悬停无关', () => {
    const bp = 0.5 + 0.5 * Math.sin(10 * 1.22)
    const lifted = pose({ lift: 1 }, 0, 0).mesh.scale.x
    expect(lifted).toBeCloseTo(1.12 * (1 + 0.075 + bp * 0.026) * 0.92, 6)
  })
})

describe('applyFloatingSongCardPose · fxPulse 撞击脉冲', () => {
  /**
   * 上游 :478：`scale *= (1 + pulse*0.056 + breathPulse*0.026 + lift*0.075)`
   */
  it('pulse 只进缩放（+pulse*0.056），不进位置', () => {
    const bp = 0.5 + 0.5 * Math.sin(10 * 1.22)
    const pulsed = pose({ pulse: 1 }, 0, 0).mesh
    const base = pose({ pulse: 0 }, 0, 0).mesh
    expect(pulsed.scale.x).toBeCloseTo(1.12 * (1 + 0.056 + bp * 0.026) * 0.92, 6)
    expect(base.scale.x).toBeCloseTo(1.12 * (1 + bp * 0.026) * 0.92, 6)
    expect(pulsed.position.x).toBeCloseTo(base.position.x, 12)
    expect(pulsed.position.y).toBeCloseTo(base.position.y, 12)
    expect(pulsed.position.z).toBeCloseTo(base.position.z, 12)
  })

  it('pulse 与 lift/breathPulse 是**相加**关系，不互相覆盖', () => {
    const both = pose({ pulse: 1, lift: 1 }, 0, 0).mesh.scale.x
    // breathPulse = visibility * (0.5 + 0.5*sin(t*1.22 + idx*0.74))，t=10, idx=0
    const breathPulse = 1 * (0.5 + 0.5 * Math.sin(10 * 1.22 + 0 * 0.74))
    expect(both).toBeCloseTo(1.12 * (1 + 0.056 + breathPulse * 0.026 + 0.075) * 0.92, 6)
  })
})

describe('CardPulse · 上游 pulseObjectValue / pulseCard', () => {
  /** 上游 `power3.out` = 1 - (1-t)^3。 */
  const power3Out = (t: number) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3

  it('初值为 0', () => {
    const p = createCardPulse()
    expect(p.value).toBe(0)
    expect(p.from).toBe(0)
    expect(p.startedAt).toBe(0)
  })

  it('触发后立刻到达目标量', () => {
    const p = createCardPulse()
    pulseCard(p, 0.55, 1000)
    expect(p.value).toBeCloseTo(0.55, 12)
  })

  it('按 power3.out 从起点衰减到 0，时长 0.46s', () => {
    const p = createCardPulse()
    pulseCard(p, 1, 0)
    const quarter = stepCardPulse(p, SHELF_CARD_PULSE_DURATION * 1000 * 0.25)
    expect(quarter).toBeCloseTo(power3Out(0.25), 12)
    // 过半时 power3.out 已到 0.875 —— 前快后慢
    const half = stepCardPulse(p, SHELF_CARD_PULSE_DURATION * 1000 * 0.5)
    expect(half).toBeCloseTo(power3Out(0.5), 12)
    expect(half).toBeLessThan(0.88)
    // 走完归零
    expect(stepCardPulse(p, SHELF_CARD_PULSE_DURATION * 1000)).toBe(0)
  })

  it('★ 重触发取 max(剩余, amount) —— 更弱的请求不得压低正在衰减的强脉冲', () => {
    const p = createCardPulse()
    pulseCard(p, 1, 0)
    // 走 1/4：剩余 0.578
    stepCardPulse(p, SHELF_CARD_PULSE_DURATION * 1000 * 0.25)
    const remaining = p.value
    expect(remaining).toBeGreaterThan(0.5)
    // 上游 :3：`target[key] = Math.max(target[key] || 0, amount || 1)`
    pulseCard(p, 0.55, SHELF_CARD_PULSE_DURATION * 1000 * 0.25)
    expect(p.from).toBeCloseTo(remaining, 12)
    // 更强的请求照常接管
    pulseCard(p, 1.05, SHELF_CARD_PULSE_DURATION * 1000 * 0.25)
    expect(p.from).toBeCloseTo(1.05, 12)
  })

  it('衰减结束后 value 与 from 都归零（不是停在 1e-9）', () => {
    const p = createCardPulse()
    pulseCard(p, 1, 0)
    stepCardPulse(p, SHELF_CARD_PULSE_DURATION * 1000 + 1)
    expect(p.value).toBe(0)
    expect(p.from).toBe(0)
    // 再推进不应产生任何值
    expect(stepCardPulse(p, 10_000)).toBe(0)
  })

  it('amount 省略时按上游 `amount || 1` 取 1', () => {
    const p = createCardPulse()
    pulseCard(p, 0, 1000)
    expect(p.value).toBe(1)
  })
})
