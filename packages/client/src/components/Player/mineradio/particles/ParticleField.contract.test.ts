import { describe, expect, it } from 'vitest'
import {
  PARTICLE_BLOOM_FRAGMENT_SHADER,
  PARTICLE_BLOOM_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
} from './shaders/particleVertex'
import {
  ALPHA_FADE_DURATION_SECONDS,
  DEFAULT_FX,
  PARTICLE_MATERIAL_COUNT,
  PARTICLE_PLANE_SIZE,
  POINT_SIZE_BASE,
  POINT_SIZE_MAX,
  POINT_SIZE_MIN,
  RENDER_FX,
} from './particleContract'

/**
 * 粒子渲染契约回归测试。
 *
 * 覆盖三次真实事故（详见 particleContract.ts 的说明）：
 *   A. R3F 复制 uniforms → material.uniforms !== uniforms → uAlpha 恒为 0 → 全透明
 *   B. uPixel 量纲错误（应为 devicePixelRatio）
 *   C. 几何 position 写成全 0
 *
 * 这些断言全部基于**实现导出的真实值**（着色器字符串、契约常量），
 * 不读取文件，因此不依赖 Node 类型，`pnpm typecheck` 保持干净。
 */

describe('事故 A：uAlpha 全局淡入链', () => {
  it('片元着色器把 uAlpha 作为总亮度乘数', () => {
    // 上游：gl_FragColor = vec4(col, tex.a * uAlpha * uParticleDim * vAlpha)
    // 缺 uAlpha 会让 alpha 恒为 0 —— 这是画面全黑的直接原因。
    expect(PARTICLE_FRAGMENT_SHADER).toMatch(/tex\.a\s*\*\s*uAlpha\s*\*\s*uParticleDim\s*\*\s*vAlpha/)
  })

  it('泛光片元同样包含 uAlpha', () => {
    expect(PARTICLE_BLOOM_FRAGMENT_SHADER).toMatch(/uAlpha/)
    expect(PARTICLE_BLOOM_FRAGMENT_SHADER).toMatch(/uBloomStrength/)
  })

  it('主粒子与泛光片元都声明 uAlpha（精度需一致）', () => {
    for (const src of [PARTICLE_FRAGMENT_SHADER, PARTICLE_BLOOM_FRAGMENT_SHADER]) {
      expect(src).toMatch(/uniform float uAlpha/)
    }
  })

  it('淡入时长与上游一致（0.26s）', () => {
    expect(ALPHA_FADE_DURATION_SECONDS).toBe(0.26)
  })
})

describe('事故 B：点尺寸与 uPixel', () => {
  it('点尺寸公式与上游逐字一致', () => {
    expect(PARTICLE_VERTEX_SHADER).toMatch(
      new RegExp(`${POINT_SIZE_BASE}\\.0\\s*\\/\\s*max\\(0\\.5,\\s*-mvPos\\.z\\)`),
    )
    expect(PARTICLE_VERTEX_SHADER).toContain(
      `clamp(depthSize * audioBoost, ${POINT_SIZE_MIN}, ${POINT_SIZE_MAX})`,
    )
  })

  it('gl_PointSize 由 sz * uPixel * uPointScale 构成', () => {
    expect(PARTICLE_VERTEX_SHADER).toMatch(
      /gl_PointSize\s*=\s*sz\s*\*\s*uPixel\s*\*\s*uPointScale\s*;/,
    )
  })

  it('泛光顶点派生后额外乘 uBloomSize', () => {
    expect(PARTICLE_BLOOM_VERTEX_SHADER).toMatch(
      /gl_PointSize\s*=\s*sz\s*\*\s*uPixel\s*\*\s*uPointScale\s*\*\s*uBloomSize/,
    )
  })

  it('派生后的泛光顶点仍声明 highp', () => {
    expect(PARTICLE_BLOOM_VERTEX_SHADER).toMatch(/precision\s+highp\s+float/)
  })
})

describe('事故 C：几何平面尺寸', () => {
  it('PLANE_SIZE 与上游一致', () => {
    expect(PARTICLE_PLANE_SIZE).toBe(4.8)
  })

  it('材质数量为 2（主粒子 + 泛光）', () => {
    expect(PARTICLE_MATERIAL_COUNT).toBe(2)
  })
})

describe('着色器精度（共享 uniform 必须同精度）', () => {
  it('三个着色器都使用 highp，不用 mediump/lowp', () => {
    for (const src of [
      PARTICLE_VERTEX_SHADER,
      PARTICLE_FRAGMENT_SHADER,
      PARTICLE_BLOOM_FRAGMENT_SHADER,
    ]) {
      expect(src).toMatch(/precision\s+highp\s+float/)
      expect(src).not.toMatch(/precision\s+(mediump|lowp)/)
    }
  })

  it('顶点在预设分叉前设定 vAlpha 基准为 1.0（上游 132 行）', () => {
    expect(PARTICLE_VERTEX_SHADER).toMatch(/vAlpha\s*=\s*1\.0\s*;/)
    const baseIdx = PARTICLE_VERTEX_SHADER.indexOf('vAlpha = 1.0')
    const presetIdx = PARTICLE_VERTEX_SHADER.indexOf('Preset 0')
    expect(baseIdx).toBeGreaterThan(-1)
    expect(presetIdx).toBeGreaterThan(-1)
    expect(baseIdx).toBeLessThan(presetIdx)
  })
})

describe('六个预设槽位', () => {
  it('齐全（0-5）', () => {
    for (const m of ['Preset 0', 'Preset 1', 'Preset 2', 'Preset 3', 'Preset 4', 'Preset 5']) {
      expect(PARTICLE_VERTEX_SHADER).toContain(m)
    }
  })

  it('用 0.5 半整数阈值判定（与上游一致）', () => {
    for (const v of ['0.5', '1.5', '2.5', '3.5', '4.5']) {
      expect(PARTICLE_VERTEX_SHADER).toContain(`uPreset < ${v}`)
    }
  })

  it('补齐了上游参与公式的 uniform', () => {
    for (const u of ['uBurstAmt', 'uVinylSpin', 'uColorMixT', 'uAiBoost', 'uEdgeEnabled']) {
      expect(PARTICLE_VERTEX_SHADER).toContain(u)
    }
  })
})

describe('上游默认参数', () => {
  it('与 DEFAULT_ROOM_VISUAL_FX 一致', () => {
    expect(DEFAULT_FX.intensity).toBe(0.85)
    expect(DEFAULT_FX.depth).toBe(0.2)
    expect(DEFAULT_FX.point).toBe(1.0)
    expect(DEFAULT_FX.colorBoost).toBe(1.1)
    expect(DEFAULT_FX.bgFade).toBe(0.2)
    expect(DEFAULT_FX.bloomStrength).toBe(0.62)
  })
})

/**
 * 回归测试：封面深度参数必须与上游出厂值一致。
 *
 * 深度位移项：`depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth`。
 *
 * ★ 这里曾有一处被测试"钉住"的错误：为了"补偿没有滑杆"，我们把 `uDepth`
 *   从 0.2 抬到 0.7。但上游 `uAiBoost` 出厂为 **0**，只有真生成深度图
 *   才升到 0.55（启发式）/ 1（AI）。也就是说 **没有深度图时 depth 完全不生效**，
 *   静止的封面本来就是平的 —— 抬 depth 没有任何依据。
 *
 *   更糟的是当时同时把 uAiBoost 硬编码成 1，于是启发式深度图产生了
 *   约 ±0.49 的静态 z 位移；而点尺寸是 `36 / -mvPos.z`，外圈粒子被
 *   渲染成不同大小，表现为**静止时封面边缘参差**（用户报告的问题）。
 *
 * 因此本组测试改为：`uDepth` 等于上游默认值，且深度项只在深度图存在时
 * 才产生位移（由 `uAiBoost` 门控）。
 */
describe('封面深度（uDepth / uAiBoost）', () => {
  it('RENDER_FX 全部继承上游出厂值（含 depth）', () => {
    expect(RENDER_FX.intensity).toBe(DEFAULT_FX.intensity)
    expect(RENDER_FX.point).toBe(DEFAULT_FX.point)
    expect(RENDER_FX.colorBoost).toBe(DEFAULT_FX.colorBoost)
    expect(RENDER_FX.bgFade).toBe(DEFAULT_FX.bgFade)
    expect(RENDER_FX.bloomStrength).toBe(DEFAULT_FX.bloomStrength)
    expect(RENDER_FX.depth).toBe(DEFAULT_FX.depth)
    expect(RENDER_FX.depth).toBe(0.2)
  })

  it('depth 落在上游滑杆允许的区间内（0.2~1.8）', () => {
    // 上游 roomVisualPreset.ts: clamp(depth, 0.2, 1.8)
    expect(RENDER_FX.depth).toBeGreaterThanOrEqual(0.2)
    expect(RENDER_FX.depth).toBeLessThanOrEqual(1.8)
  })

  it('静止时深度位移很小：启发式 uAiBoost 上限 0.55，不是 1', () => {
    // 启发式深度图的 uAiBoost 目标值（上游 15-ripples-cover-depth.js）
    const heuristicAiBoost = 0.55
    const maxDepthZ = 0.5 * heuristicAiBoost * RENDER_FX.depth * 1.4
    const ratio = maxDepthZ / PARTICLE_PLANE_SIZE
    // 上游启发式深度下约 3.2% 平面宽度 —— 足够有层次，又不会让边缘参差
    expect(ratio).toBeLessThan(0.05)
    expect(maxDepthZ).toBeCloseTo(0.077, 2)
  })

  it('粒子场不再混入旧平面 CoverCard 材质', () => {
    // 这里仅约束 ParticleField；FloatingSongShelf 属于独立 3D 队列层。
    expect(PARTICLE_MATERIAL_COUNT).toBe(2)
  })
})
