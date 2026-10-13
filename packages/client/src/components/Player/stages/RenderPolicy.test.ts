import { describe, expect, it } from 'vitest'
import {
  PAUSED_TARGET_FPS,
  detectDefaultQuality,
  getRenderPolicy,
  particleGridForResolution,
  resolveFrameloop,
} from './RenderPolicy'

/**
 * 回归测试：帧循环策略。
 *
 * ============================ 两次事故，方向相反 ============================
 *
 * **第一次（变黑）**：`resolveFrameloop` 曾在 `isPlaying === false` 时返回
 * `'demand'`，但整个舞台的动态（uniform 推进、涟漪、节拍相机、星河流）都写在
 * `useFrame` 里，而代码**从不调用 `invalidate()`**。于是房间没有歌曲时：
 *   - 渲染循环整帧不跑 → drawArrays / clear 长期为 0
 *   - 画布停留在初始状态 → 用户看到的是一块**纯黑舞台**
 *
 * **第二次（空转）**：为修上面那条，改成了"只要页面可见就 `always`"，
 * 首个参数写成 `_isPlaying` —— **根本没用**。于是暂停时仍按 vsync 满帧渲染，
 * GPU/CPU 持续满载。上游明确按播放态降频（`11-main-loop.js:262-277`：
 * 非播放返回 **24**，播放 60，交互 120）。
 *
 * **现在的契约（两件事必须成对）**：
 *   · 播放且可见 → `always`（vsync）
 *   · 暂停且可见 → `demand` + **调用方必须挂 `PausedFramePump`**
 *   · 页面不可见 → `demand`（且 rAF 本就被浏览器停摆，无需帧泵）
 *
 * `PausedFramePump` 的存在性由 `pausedFramePump.contract.test.ts` 单独钉住 ——
 * 单测钉不住 DOM，但能钉住"源码里确实有这一对"。
 */
describe('resolveFrameloop', () => {
  it('★ 暂停时不得再按 vsync 满帧渲染（降频到 demand + 帧泵）', () => {
    expect(resolveFrameloop(false, true)).toBe('demand')
  })

  it('播放且可见时连续渲染（跟随 vsync）', () => {
    expect(resolveFrameloop(true, true)).toBe('always')
  })

  it('页面不可见时降级为 demand，避免后台空转', () => {
    expect(resolveFrameloop(true, false)).toBe('demand')
    expect(resolveFrameloop(false, false)).toBe('demand')
  })

  it('★ 播放状态必须影响可见页面的帧循环（否则暂停时仍在满帧空转）', () => {
    expect(resolveFrameloop(true, true)).not.toBe(resolveFrameloop(false, true))
  })

  it('暂停目标帧率是上游非播放档的 24', () => {
    expect(PAUSED_TARGET_FPS).toBe(24)
    // 必须显著低于 vsync，否则"降频"没有意义
    expect(PAUSED_TARGET_FPS).toBeLessThan(60)
  })
})

/**
 * 回归测试：粒子网格公式。
 *
 * 对应 Mineradio 的 `coverParticleGridForResolution`：
 *   grid = round(118 * resolution)，夹在 88..183，且必须取奇数。
 * 取奇数是硬要求：保证存在正中一行/一列，封面构图才对称可辨。
 */
describe('particleGridForResolution', () => {
  it('始终返回奇数', () => {
    for (const res of [0.5, 0.75, 1, 1.25, 1.5, 1.55, 2]) {
      expect(particleGridForResolution(res) % 2).toBe(1)
    }
  })

  it('夹在 88..183 之间', () => {
    for (const res of [0, 0.1, 1, 1.5, 5, 100]) {
      const grid = particleGridForResolution(res)
      expect(grid).toBeGreaterThanOrEqual(88)
      expect(grid).toBeLessThanOrEqual(183)
    }
  })

  it('分辨率越高网格越密', () => {
    expect(particleGridForResolution(0.75)).toBeLessThan(particleGridForResolution(1.5))
  })
})

/**
 * 回归测试：画质档位（第二十六轮改为上游四档）。
 *
 * ★ 上游语义（`01-scene/00-renderer-quality.js` + `00-state/08-desktop-render-power.js`）：
 *   画质档**只**控制 DPR / 音频分析量 / 主循环帧率，
 *   **不**控制粒子网格（那是 `fx.coverResolution`）、泛光（`fx.bloom`）、
 *   星河（`fx.backgroundStarRiver`）、运镜（`fx.cinema`）。
 *   本轮据此把这几项从画质档解耦 —— 本组测试钉住这个结构。
 */
describe('getRenderPolicy：上游四档', () => {
  const PROFILE = {
    cores: 8,
    deviceMemoryGB: 8,
    devicePixelRatio: 2,
    cssPixels: 1920 * 1080,
    renderPixels: 1920 * 1080 * 4,
    lowSpec: false,
    balancedSpec: false,
  }
  const NORMAL = { lowPower: false, bloomEnabled: false, edgeEnabled: false }
  const LOW_POWER = { lowPower: true, bloomEnabled: true, edgeEnabled: true }

  it('四档的 DPR 单调不减（eco < balanced < high < ultra）', () => {
    const ratios = (['eco', 'balanced', 'high', 'ultra'] as const).map(
      (q) => getRenderPolicy(q, PROFILE, NORMAL).pixelRatio,
    )
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1])
    }
  })

  it('DPR 受像素预算约束（大屏自动降）', () => {
    const small = getRenderPolicy('ultra', { ...PROFILE, cssPixels: 800 * 600 }, NORMAL)
    const large = getRenderPolicy('ultra', { ...PROFILE, cssPixels: 3840 * 2160 }, NORMAL)
    expect(large.pixelRatio).toBeLessThan(small.pixelRatio)
  })

  it('DPR 不低于该档的下限', () => {
    // eco 的 min 是 0.52
    const p = getRenderPolicy('eco', { ...PROFILE, devicePixelRatio: 0.1 }, NORMAL)
    expect(p.pixelRatio).toBeGreaterThanOrEqual(0.52)
  })

  it('粒子网格**不**随画质档变化（上游归 coverResolution）', () => {
    const grids = (['eco', 'balanced', 'high', 'ultra'] as const).map(
      (q) => getRenderPolicy(q, PROFILE, NORMAL).particleGrid,
    )
    expect(new Set(grids).size).toBe(1)
    // 出厂 coverResolution 1.55 → 183（上游出厂密度）
    expect(grids[0]).toBe(183)
  })

  it('低功耗上下文降低粒子网格（本项目对 Web 移动端的补充）', () => {
    const normal = getRenderPolicy('eco', PROFILE, NORMAL)
    const low = getRenderPolicy('eco', PROFILE, LOW_POWER)
    expect(low.particleGrid).toBeLessThan(normal.particleGrid)
    expect(low.starRiver).toBe(false)
    expect(low.beatCamera).toBe(false)
  })

  /**
   * 回归：`lowPower` 必须与 `perfLevel` **解耦**，且必须被透出。
   *
   * 真实事故：消费者需要判断"低功耗"时拿不到这个标志（它只活在
   * `detectPowerContext()` 内部），于是用 `perfLevel <= 0` 当替身。
   * 而 `perfLevel` 是**画质档**派生值，出厂 `eco` 恒为 0 ——
   * 结果是**默认配置下所有用户**都被当成低功耗：
   * `AmbientBackdrop` 跳过上游 Mineradio 的 `#album-bg` 封面模糊铺底，
   * 舞台只剩基色渐变。上游对 `#album-bg` 无任何画质档门控。
   *
   * 本用例钉住两点：① 标志被透出；② 它与画质档无关（任何档位、任何硬件
   * 都只由 `PowerContext` 决定）。若有人改回 `perfLevel <= 0` 的替身写法，
   * 第二条会立刻失败。
   */
  it('lowPower 必须透出，且与画质档/perfLevel 无关', () => {
    // ① 标志存在且跟随 PowerContext
    expect(getRenderPolicy('eco', PROFILE, NORMAL).lowPower).toBe(false)
    expect(getRenderPolicy('eco', PROFILE, LOW_POWER).lowPower).toBe(true)

    // ② 出厂默认档（eco，perfLevel 恒 0）**不得**被判成低功耗 —— 这正是事故点
    for (const q of ['eco', 'balanced', 'high', 'ultra'] as const) {
      const p = getRenderPolicy(q, PROFILE, NORMAL)
      expect(p.lowPower, `${q} 档在正常上下文下不应是低功耗`).toBe(false)
    }
    // 低端硬件同样只是压低 perfLevel，不等于低功耗上下文
    const lowSpec = { ...PROFILE, lowSpec: true, balancedSpec: true }
    expect(getRenderPolicy('eco', lowSpec, NORMAL).lowPower).toBe(false)
    expect(getRenderPolicy('high', lowSpec, NORMAL).perfLevel).toBe(0)
  })

  it('粒子总数与网格自洽且为奇数边长', () => {
    for (const q of ['eco', 'balanced', 'high', 'ultra'] as const) {
      const p = getRenderPolicy(q, PROFILE, NORMAL)
      expect(p.particleCount).toBe(p.particleGrid * p.particleGrid)
      expect(p.particleGrid % 2).toBe(1)
    }
  })

  it('性能预算等级随画质档单调不减', () => {
    const levels = (['eco', 'balanced', 'high', 'ultra'] as const).map(
      (q) => getRenderPolicy(q, PROFILE, NORMAL).perfLevel,
    )
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1])
    }
  })

  it('低端硬件会把预算等级压到 0', () => {
    const lowSpec = { ...PROFILE, lowSpec: true, balancedSpec: true }
    expect(getRenderPolicy('high', lowSpec, NORMAL).perfLevel).toBe(0)
  })

  it('粒子溢光跟随用户设置（上游 fx.bloom 出厂 false）', () => {
    // 默认（未开启）→ 关闭，与上游出厂一致
    expect(getRenderPolicy('high', PROFILE, NORMAL).bloom).toBe(false)
    // 用户开启 → 打开
    expect(getRenderPolicy('high', PROFILE, { lowPower: false, bloomEnabled: true, edgeEnabled: false }).bloom).toBe(
      true,
    )
    // 低功耗档强制关闭（第二遍渲染在移动 GPU 上代价最大）
    expect(getRenderPolicy('high', PROFILE, LOW_POWER).bloom).toBe(false)
  })

  it('轮廓高亮跟随用户设置（上游 fx.edge 出厂 false）', () => {
    // 出厂关闭 —— 此前移植在建出边缘纹理时就强制开启，导致所有粒子偏亮
    expect(getRenderPolicy('high', PROFILE, NORMAL).edgeEnabled).toBe(false)
    // 用户开启 → 打开
    expect(
      getRenderPolicy('high', PROFILE, { lowPower: false, bloomEnabled: false, edgeEnabled: true }).edgeEnabled,
    ).toBe(true)
  })

  it('分析步长随预算等级收紧（eco 步长 > ultra 步长）', () => {
    const eco = getRenderPolicy('eco', PROFILE, NORMAL)
    const ultra = getRenderPolicy('ultra', PROFILE, NORMAL)
    expect(eco.analysisStrideWideBand).toBeGreaterThan(ultra.analysisStrideWideBand)
  })

  /**
   * 回归：dt 钳制必须是上游的**固定 0.05**，且**与画质档无关**。
   *
   * 真实事故：曾按 `1 / (90 × perfScale)` 推导 dt 上限（high 11.1ms、
   * eco 15.4ms），全都小于 60Hz 的 16.7ms 帧时长 —— 于是 60Hz 屏上粒子层
   * 每个时钟（uTime、唱片自旋、burst 衰减、预设切换脉冲、手势惯性）都被
   * 按 0.62~0.92 倍缩放，表现为**整体慢放**；而地形层用 1/20，两层时钟
   * 不一致（同一首歌切模式会看到速度跳变）。
   *
   * 上游 `11-main-loop.js:309` 是 `Math.min(dt, 0.05)`：固定值，不看画质档。
   * 开销由帧率**门控**（`capMainLoopFpsForBudget`）控制，而那个门控在播放中
   * （vsync 模式）返回 0 = 不限制。
   */
  it('dt 上限是上游固定 0.05，且不随画质档变化', () => {
    for (const q of ['eco', 'balanced', 'high', 'ultra'] as const) {
      expect(getRenderPolicy(q, PROFILE, NORMAL).maxDeltaSeconds, `${q} 档 dt 上限`).toBeCloseTo(0.05, 6)
    }
    // 低端硬件 / 低功耗同样不改变它（上游是固定值）
    const lowSpec = { ...PROFILE, lowSpec: true, balancedSpec: true }
    expect(getRenderPolicy('eco', lowSpec, NORMAL).maxDeltaSeconds).toBeCloseTo(0.05, 6)
    expect(getRenderPolicy('ultra', PROFILE, LOW_POWER).maxDeltaSeconds).toBeCloseTo(0.05, 6)
  })

  it('dt 上限必须 >= 60Hz 帧时长（否则 60Hz 屏上动画慢放）', () => {
    // 60Hz → 16.7ms；dt 上限若小于它，每帧都被压缩 => 慢放
    expect(getRenderPolicy('eco', PROFILE, NORMAL).maxDeltaSeconds).toBeGreaterThanOrEqual(1 / 60)
  })
})

describe('detectDefaultQuality', () => {
  it('上游出厂即 eco（忠实移植）', () => {
    expect(detectDefaultQuality()).toBe('eco')
  })
})
