import { describe, expect, it } from 'vitest'
import { detectDefaultQuality, getRenderPolicy, particleGridForResolution, resolveFrameloop } from './RenderPolicy'

/**
 * 回归测试：帧循环策略。
 *
 * 背景（真实事故）：
 *
 * `resolveFrameloop` 曾在 `isPlaying === false` 时返回 `'demand'`。
 * 但整个舞台的动态（uniform 推进、涟漪、节拍相机、星河流）都写在
 * `useFrame` 里，而代码**从不调用 `invalidate()`**。于是房间没有歌曲时：
 *
 *   - 渲染循环整帧不跑 → drawArrays / clear 长期为 0
 *   - 画布停留在初始状态 → 用户看到的是一块**纯黑舞台**
 *
 * 实测证据（无头 CDP 探针）：
 *   修复前：clear=0,  drawArrays=0        —— 一帧都没渲染
 *   修复后：clear=69, drawArrays=207      —— 持续渲染
 *
 * 因此只要页面可见，就必须连续渲染；只有页面不可见（后台标签页）
 * 才用 demand 停摆省电。
 */
describe('resolveFrameloop', () => {
  it('暂停时仍然连续渲染（页面可见）—— 否则舞台全黑', () => {
    expect(resolveFrameloop(false, true)).toBe('always')
  })

  it('播放且可见时连续渲染', () => {
    expect(resolveFrameloop(true, true)).toBe('always')
  })

  it('页面不可见时降级为 demand，避免后台空转', () => {
    expect(resolveFrameloop(true, false)).toBe('demand')
    expect(resolveFrameloop(false, false)).toBe('demand')
  })

  it('播放状态不应影响可见页面的帧循环（暂停也必须继续画）', () => {
    expect(resolveFrameloop(true, true)).toBe(resolveFrameloop(false, true))
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
    expect(getRenderPolicy('high', PROFILE, { lowPower: false, bloomEnabled: true, edgeEnabled: false }).bloom).toBe(true)
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
})

describe('detectDefaultQuality', () => {
  it('上游出厂即 eco（忠实移植）', () => {
    expect(detectDefaultQuality()).toBe('eco')
  })
})
