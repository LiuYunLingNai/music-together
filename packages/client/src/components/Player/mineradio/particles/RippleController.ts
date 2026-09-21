import * as THREE from 'three'

/**
 * 涟漪控制器（封面粒子）。
 *
 * 忠实移植 Mineradio 的 `02-visual/15-ripples-cover-depth.js`：
 *
 * - 触发条件（上游 `updateRipples`：24-45 行）：
 *   `bass > BASS_THRESHOLD(0.30)` 且**不是上升沿**（`!lastBassRising`，
 *   即 bass 从峰回落穿越阈值的沿），叠加 `RIPPLE_COOLDOWN(0.32s)` 冷却。
 *   ★ 上升沿布尔（kickOnset）不能直接当触发源：一拍内连续多帧为 true，
 *     会造成"多次不规律触发"。上游语义是"回落穿越 + 电平"。
 * - 每次触发 **2~3 道**涟漪（`count = 2 + (rand<0.5 ? 0 : 1)`），
 *   撒在上游的 3×3 区域网格上（`PLANE_SIZE*0.72` 跨度，±0.7 抖动），
 *   同一次触发内不重复选同一格（`used` 表 + 12 次重试）。
 * - 强度 `str = 0.65 + bass*1.4 + rand*0.25`，寿命 2.0s，低于 0.005 视为死槽。
 * - 槽位 `RIPPLE_MAX=12`，环形复用（`rippleIdx`）；着色器按 `uRippleCount`
 *   取前 N 个，因此**每次写入后要把活跃槽紧凑排列到数组前端**（上游把
 *   全部 12 个槽逐帧写进 DataTexture，靠 `ri >= uRippleCount` 截断；
 *   本项目等价实现：写 uniform 前压缩）。
 */

/** 同时存在的最大涟漪数（与着色器数组长度一致；上游 RIPPLE_MAX=12） */
export const RIPPLE_MAX = 12
/** 触发电平阈值（上游 `BASS_THRESHOLD`，作用于峰值归一化后的 bass） */
export const BASS_THRESHOLD = 0.3
/** 两次触发之间的最短间隔（秒，上游 `RIPPLE_COOLDOWN`） */
export const RIPPLE_COOLDOWN = 0.32
/** 单次涟漪的生命周期（秒，上游 `r.age > 2.0` 时置死） */
export const RIPPLE_LIFETIME = 2.0

/** 上游 3×3 触发区域的跨度系数（`PLANE_SIZE * 0.72`，PLANE_SIZE=4.8） */
const REGION_SPAN = 4.8 * 0.72
/** 单次触发 2~3 道的随机上限（上游 `count = 2 + (rand<0.5 ? 0 : 1)`） */
const RIPPLE_COUNT_PER_TRIGGER = 2

export interface RippleState {
  /** 中心 x（世界空间） */
  x: number
  /** 中心 y（世界空间） */
  y: number
  /** 年龄（秒） */
  age: number
  /** 强度；≤0.005 表示死槽 */
  str: number
}

export class RippleController {
  readonly ripples: RippleState[] = []
  /**
   * 传给着色器的紧凑数组 (x, y, age, str)，随写入同步压缩到前
   * activeCount 个。★ 4 分量（上游 DataTexture RGBA 语义，str 在 w 通道，
   * `15-ripples-cover-depth.js:44`：str = 0.65 + bass*1.4 + rand*0.25）——
   * 此前 3 分量把 str 丢弃、着色器硬编码 str=1，强弱拍涟漪无法区分。
   */
  readonly data: Float32Array
  private cursor = 0
  private activeCount = 0
  private lastTriggerAt = -Infinity
  /** 上游 `lastBassRising`：bass 是否处于阈值 75% 以上的爬升段 */
  private bassRising = false

  constructor() {
    for (let i = 0; i < RIPPLE_MAX; i++) {
      this.ripples.push({ x: 0, y: 0, age: -10, str: 0 })
    }
    this.data = new Float32Array(RIPPLE_MAX * 4)
  }

  /**
   * 推进涟漪状态。
   *
   * @param deltaSeconds 帧间隔（已钳制）
   * @param bass 本帧的 bass 电平（上游全局 `bass`，峰值归一化后）
   * @returns 当前活跃涟漪数量
   */
  update(deltaSeconds: number, bass: number): number {
    this.elapsedSeconds += deltaSeconds
    // 触发判定（上游 24-32 行）：回落沿 + 电平 + 冷却
    const isBassHit = bass > BASS_THRESHOLD && !this.bassRising
    this.bassRising = bass > BASS_THRESHOLD * 0.75

    if (isBassHit && this.elapsedSeconds - this.lastTriggerAt >= RIPPLE_COOLDOWN) {
      this.lastTriggerAt = this.elapsedSeconds
      this.triggerBurst(bass)
    }

    let active = 0
    for (const ripple of this.ripples) {
      if (ripple.str > 0.005) {
        ripple.age += deltaSeconds
        if (ripple.age > RIPPLE_LIFETIME) {
          ripple.str = 0
          ripple.age = -10
        }
      }
      if (ripple.str > 0.005) active++
    }
    this.activeCount = active
    this.write()
    return active
  }

  /** 单调累计时间（秒），上游用 `uniforms.uTime.value`。 */
  private elapsedSeconds = 0

  /** 在 3×3 区域网格上撒一次 2~3 道涟漪（上游 33-46 行）。 */
  private triggerBurst(bass: number): void {
    const count = RIPPLE_COUNT_PER_TRIGGER + (Math.random() < 0.5 ? 0 : 1)
    const used = new Set<number>()
    for (let k = 0; k < count; k++) {
      let idx = 0
      let tries = 0
      do {
        idx = Math.floor(Math.random() * 9)
        tries++
      } while (used.has(idx) && tries < 12)
      used.add(idx)
      const ry = Math.floor(idx / 3)
      const rx = idx % 3
      const regionX = (rx / 2 - 0.5) * REGION_SPAN
      const regionY = (ry / 2 - 0.5) * REGION_SPAN
      const jx = regionX + (Math.random() - 0.5) * 0.7
      const jy = regionY + (Math.random() - 0.5) * 0.7
      const str = 0.65 + Math.max(0, bass) * 1.4 + Math.random() * 0.25
      this.trigger(jx, jy, str)
    }
  }

  /** 在指定位置触发一次涟漪（预设切换等外部入口仍可用）。 */
  trigger(x?: number, y?: number, strength?: number): void {
    const ripple = this.ripples[this.cursor]
    this.cursor = (this.cursor + 1) % RIPPLE_MAX
    ripple.x = x ?? (Math.random() - 0.5) * REGION_SPAN
    ripple.y = y ?? (Math.random() - 0.5) * REGION_SPAN
    ripple.age = 0
    ripple.str = strength ?? 1
    this.write()
  }

  /**
   * 把活跃涟漪压缩写入着色器数组前 `activeCount` 个槽。
   *
   * 上游着色器按插入顺序读前 `uRippleCount` 个（`ri >= uRippleCount` break），
   * 本项目槽位是环形复用的 —— 若不压缩，前 N 个槽可能含死槽而活跃槽被截断。
   * 这就是此前"前后涟漪状态冲突"的根源。
   */
  private write(): void {
    let out = 0
    for (let i = 0; i < RIPPLE_MAX && out < this.activeCount; i++) {
      const ripple = this.ripples[i]
      if (ripple.str <= 0.005) continue
      const base = out * 4
      this.data[base] = ripple.x
      this.data[base + 1] = ripple.y
      this.data[base + 2] = Math.max(0, ripple.age)
      this.data[base + 3] = ripple.str
      out++
    }
    // 死槽区清零（str 语义由 uRippleCount 截断兜底）
    for (let i = out; i < RIPPLE_MAX; i++) {
      const base = i * 4
      this.data[base] = 0
      this.data[base + 1] = 0
      this.data[base + 2] = 0
      this.data[base + 3] = 0
    }
  }

  /** 清空所有涟漪（切歌时调用）。 */
  reset(): void {
    for (const ripple of this.ripples) {
      ripple.str = 0
      ripple.age = -10
    }
    this.cursor = 0
    this.activeCount = 0
    this.lastTriggerAt = -Infinity
    this.bassRising = false
    this.write()
  }

  /** 转为 three.js 可用的 uniform 值（w 通道 = str，上游 DataTexture 语义）。 */
  toUniformValue(): THREE.Vector4[] {
    const out: THREE.Vector4[] = []
    for (let i = 0; i < RIPPLE_MAX; i++) {
      const base = i * 4
      out.push(new THREE.Vector4(this.data[base], this.data[base + 1], this.data[base + 2], this.data[base + 3]))
    }
    return out
  }
}
