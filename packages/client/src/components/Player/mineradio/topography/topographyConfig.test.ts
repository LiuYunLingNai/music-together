import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLOATING_BLOCK_COUNT,
  DEFAULT_GROUND_BANDS,
  DEFAULT_TERRAIN_DENSITY,
  QUALITY_GRID_CAP,
  RIPPLE_LIFETIME,
  RIPPLE_SOFT_FADE_START,
  TERRAIN_MAX_GRID_SIZE,
  TERRAIN_MIN_GRID_SIZE,
  applyGroundEqBandValue,
  clampAnimationBlend,
  deriveKickFollowLowBands,
  deriveTerrainGridSettings,
  smoothstep01,
  topographyQualityFor,
} from './topographyConfig'

describe('声波地形 · 网格推导', () => {
  it('网格始终夹在各画质档的上限之内', () => {
    for (const quality of ['eco', 'balanced', 'high', 'ultra'] as const) {
      for (const density of [0, 25, 46, 50, 62, 100]) {
        const { gridSize } = deriveTerrainGridSettings(density, quality)
        expect(gridSize).toBeLessThanOrEqual(QUALITY_GRID_CAP[quality])
        expect(gridSize).toBeGreaterThanOrEqual(16)
      }
    }
  })

  it('密度单调递增（更高密度不会产出更小的网格）', () => {
    let previous = 0
    for (const density of [0, 20, 40, 60, 80, 100]) {
      const { gridSize } = deriveTerrainGridSettings(density, 'ultra')
      expect(gridSize).toBeGreaterThanOrEqual(previous)
      previous = gridSize
    }
  })

  it('密度区间覆盖 96..224 的网格范围', () => {
    expect(deriveTerrainGridSettings(0, 'ultra').gridSize).toBe(TERRAIN_MIN_GRID_SIZE)
    expect(deriveTerrainGridSettings(100, 'ultra').gridSize).toBe(TERRAIN_MAX_GRID_SIZE)
  })

  it('间距与实例数自洽：间距 × 网格 = 168 基准尺寸', () => {
    const grid = deriveTerrainGridSettings(50, 'balanced')
    expect(grid.spacing * grid.gridSize).toBeCloseTo(168, 5)
    expect(grid.instanceCount).toBe(grid.gridSize * grid.gridSize)
    // 方块必须窄于间距，否则地形会糊成连续平面
    expect(grid.boxWidth).toBeLessThan(grid.spacing)
  })

  it('非有限密度回退到安全默认值而不是产生 NaN 网格', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { gridSize, spacing, boxWidth } = deriveTerrainGridSettings(bad, 'balanced')
      expect(Number.isFinite(gridSize)).toBe(true)
      expect(Number.isFinite(spacing)).toBe(true)
      expect(Number.isFinite(boxWidth)).toBe(true)
      expect(gridSize).toBeGreaterThan(0)
    }
  })

  it('直接使用用户画质档限制地形网格', () => {
    for (const quality of ['eco', 'balanced', 'high', 'ultra'] as const) {
      expect(topographyQualityFor({ quality })).toBe(quality)
    }

    expect(deriveTerrainGridSettings(DEFAULT_TERRAIN_DENSITY, 'eco').gridSize).toBe(112)
    expect(deriveTerrainGridSettings(DEFAULT_TERRAIN_DENSITY, 'balanced').gridSize).toBe(156)
    expect(deriveTerrainGridSettings(DEFAULT_TERRAIN_DENSITY, 'high').gridSize).toBe(156)
    expect(deriveTerrainGridSettings(DEFAULT_TERRAIN_DENSITY, 'ultra').gridSize).toBe(156)
  })
})

describe('声波地形 · 逐频段 EQ 出厂档位', () => {
  /**
   * 频段顺序必须严格等于上游 `GROUND_BAND_KEYS`
   * （`sonic-topography-preset.js:41-50`），取值必须等于上游**活路径**
   * `readBands(fx)` 的结果 —— 即 `fx` 里的值，而不是 preset 文件里那个
   * 从未被采用的 fallback 数组。
   */
  it('顺序与取值对齐上游 readBands(fx)', () => {
    // 出厂 fx（00-state/04-fx-defaults.js:111-118），按 GROUND_BAND_KEYS 顺序：
    // subBass/bass/lowMid/mid/highMid/presence/brilliance/air
    const upstreamFxBands = [90, 92, 50, 50, 50, 25, 50, 48]
    expect([...DEFAULT_GROUND_BANDS]).toEqual(upstreamFxBands)
  })

  it('presence 是被压低的频段、brilliance 是中性（不得互换）', () => {
    const PRESENCE_INDEX = 5
    const BRILLIANCE_INDEX = 6
    expect(DEFAULT_GROUND_BANDS[PRESENCE_INDEX]).toBe(25)
    expect(DEFAULT_GROUND_BANDS[BRILLIANCE_INDEX]).toBe(50)

    // 方向性断言：同样的输入，presence 必须被衰减、brilliance 必须原样通过。
    // 这两项一旦互换，下面的不等式立刻失败 —— 正是此前漏掉的回归。
    const input = 0.5
    expect(applyGroundEqBandValue(input, DEFAULT_GROUND_BANDS, PRESENCE_INDEX)).toBeLessThan(input)
    expect(applyGroundEqBandValue(input, DEFAULT_GROUND_BANDS, BRILLIANCE_INDEX)).toBeCloseTo(input, 6)
  })

  it('EQ 公式与上游 applyGroundEqBandValue 一致（50 中性 / >=50 增益 / <50 变闷）', () => {
    const bands = [0, 25, 50, 75, 100]
    // 50 = 中性
    expect(applyGroundEqBandValue(0.6, bands, 2)).toBeCloseTo(0.6, 6)
    // >=50：value * (1 + delta * 1.8)，delta = (eq-50)/50
    // （max 默认 1，因此高增益档要放宽 max 才能观察到未夹取的乘积）
    expect(applyGroundEqBandValue(0.5, bands, 3, 2)).toBeCloseTo(0.5 * (1 + 0.5 * 1.8), 6)
    expect(applyGroundEqBandValue(0.5, bands, 4, 2)).toBeCloseTo(0.5 * (1 + 1.0 * 1.8), 6)
    // 默认 max=1 时，×2.8 的结果被夹到 1
    expect(applyGroundEqBandValue(0.5, bands, 4)).toBe(1)
    // <50：先减 dullness*0.35 再乘 (1-dullness*0.35)
    const dullness = 0.5
    expect(applyGroundEqBandValue(0.5, bands, 1)).toBeCloseTo(
      Math.max(0, 0.5 - dullness * 0.35) * (1 - dullness * 0.35),
      6,
    )
    // 夹到 max
    expect(applyGroundEqBandValue(0.9, [100, 0, 0, 0, 0], 0, 1)).toBe(1)
  })
})

describe('声波地形 · 踢鼓低频响应', () => {
  it('静默时两个低频都接近 0', () => {
    const { subBass, bass } = deriveKickFollowLowBands({
      kickEnvelope: 0,
      subBassEnergy: 0,
      bassEnergy: 0,
    })
    expect(subBass).toBe(0)
    expect(bass).toBe(0)
  })

  it('低频输入越高，抬升越大（单调）', () => {
    let previous = -1
    for (const sub of [0, 0.25, 0.5, 0.75, 1]) {
      const { subBass } = deriveKickFollowLowBands({
        kickEnvelope: 0,
        subBassEnergy: sub,
        bassEnergy: 0,
      })
      expect(subBass).toBeGreaterThanOrEqual(previous)
      previous = subBass
    }
  })

  it('永远不越过着色器的上限（避免地形爆掉）', () => {
    const { subBass, bass } = deriveKickFollowLowBands({
      kickEnvelope: 1,
      subBassEnergy: 1,
      bassEnergy: 1,
    })
    expect(subBass).toBeLessThanOrEqual(1.2)
    expect(bass).toBeLessThanOrEqual(1.15)
  })

  it('踢鼓包络为负或 NaN 时按 0 处理，不产生负抬升', () => {
    for (const bad of [-5, Number.NaN]) {
      const { subBass, bass } = deriveKickFollowLowBands({
        kickEnvelope: bad,
        subBassEnergy: 0.5,
        bassEnergy: 0.5,
      })
      expect(subBass).toBeGreaterThanOrEqual(0)
      expect(bass).toBeGreaterThanOrEqual(0)
    }
  })

  /**
   * 第九轮回归：上游在本函数内部施加逐频段 EQ
   * （band 0/1 出厂 90/92 → ×2.44/×2.51）。此前本项目漏掉这一步，
   * 地形低频呼吸比上游矮约一半 —— 它正是鼓点抬升的主要增益来源。
   */
  it('低频经过出厂 EQ 增益（band0 ×2.44 / band1 ×2.51，上游 preset:286-293）', () => {
    // kickEnvelope=0、subBass=1 → input = 0.22 → ×2.44 = 0.5368
    const { subBass, bass } = deriveKickFollowLowBands({
      kickEnvelope: 0,
      subBassEnergy: 1,
      bassEnergy: 1,
    })
    // 精确公式：eq=90 → delta=0.8 → ×(1+0.8*1.8)=×2.44；eq=92 → ×2.512
    expect(subBass).toBeCloseTo(0.22 * 2.44, 5)
    expect(bass).toBeCloseTo(0.2 * 2.512, 5)
    // EQ 参数可透传（中性档 50 → ×1）
    const neutral = deriveKickFollowLowBands({
      kickEnvelope: 0,
      subBassEnergy: 1,
      bassEnergy: 1,
      eqBands: [50, 50, 50, 50, 50, 50, 50, 50],
    })
    expect(neutral.subBass).toBeCloseTo(0.22, 5)
    expect(neutral.bass).toBeCloseTo(0.2, 5)
  })
})

describe('声波地形 · 踢鼓包络（由 SonicAudioMonitor 统一驱动）', () => {
  it('地形消费引擎产出的 kickEnvelope，本地不再重复实现', async () => {
    // 静态钉住：引擎里有 stepKickEnvelope，topographyConfig 里没有
    const { stepKickEnvelope: engineStep } = await import('../shared/SonicAudioMonitor')
    expect(typeof engineStep).toBe('function')
    const configSource = await import('./topographyConfig')
    expect('stepKickEnvelope' in configSource).toBe(false)
    expect('createKickEnvelopeState' in configSource).toBe(false)
  })
})

describe('声波地形 · 动画混合', () => {
  it('clampAnimationBlend 把非有限值收敛到 0，并夹取越界值', () => {
    // 非有限值一律当 0：混合系数取不到有意义的值时「不推进」，
    // 比按 Infinity 猛推一帧要安全得多（上游同款语义）。
    expect(clampAnimationBlend(Number.NaN)).toBe(0)
    expect(clampAnimationBlend(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampAnimationBlend(Number.NEGATIVE_INFINITY)).toBe(0)
    // 有限越界值按区间夹取
    expect(clampAnimationBlend(-3)).toBe(0)
    expect(clampAnimationBlend(2)).toBe(1)
    expect(clampAnimationBlend(0.4)).toBeCloseTo(0.4, 6)
  })

  it('悬浮方块数量与上游默认值一致', () => {
    expect(DEFAULT_FLOATING_BLOCK_COUNT).toBe(80)
  })
})

describe('声波地形 · 涟漪寿命', () => {
  it('寿命与软淡出起点取自上游（4.8s / 2.1s）', () => {
    expect(RIPPLE_LIFETIME).toBe(4.8)
    expect(RIPPLE_SOFT_FADE_START).toBe(2.1)
    // 软淡出必须早于寿命结束，否则淡出窗口为负
    expect(RIPPLE_SOFT_FADE_START).toBeLessThan(RIPPLE_LIFETIME)
  })

  it('smoothstep01 与 GLSL 语义一致（端点 + 中点）', () => {
    expect(smoothstep01(0)).toBe(0)
    expect(smoothstep01(1)).toBe(1)
    expect(smoothstep01(0.5)).toBeCloseTo(0.5, 6)
    // 夹取：越界输入收敛到端点
    expect(smoothstep01(-1)).toBe(0)
    expect(smoothstep01(2)).toBe(1)
    expect(smoothstep01(Number.NaN)).toBe(0)
  })

  it('smoothstep01 单调不减', () => {
    let previous = -1
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const value = smoothstep01(x)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('JS 侧淡出曲线：2.1s 前不减，4.8s 时归零', () => {
    // 与着色器的 lifeFade = 1 - smoothstep(2.10, 4.80, t) 保持一致
    const fadeAt = (age: number) =>
      1 - smoothstep01((age - RIPPLE_SOFT_FADE_START) / (RIPPLE_LIFETIME - RIPPLE_SOFT_FADE_START))
    expect(fadeAt(0)).toBeCloseTo(1, 6)
    expect(fadeAt(RIPPLE_SOFT_FADE_START)).toBeCloseTo(1, 6)
    expect(fadeAt(RIPPLE_LIFETIME)).toBeCloseTo(0, 6)
    // 中间单调递减
    expect(fadeAt(3.5)).toBeGreaterThan(0)
    expect(fadeAt(3.5)).toBeLessThan(1)
  })
})
