import type { RenderPolicy } from '../shared/RenderPolicy'

/**
 * 「声波地形」的规模与响应参数。
 *
 * 数值取自 Mineradio `public/sonic-topography-preset.js` 与 OpenMusic 的
 * `topographyGroundEq` / `topographySceneDefaults`：
 *
 * - `TERRAIN_BASE_SIZE = 168`、`TERRAIN_MIN_GRID_SIZE = 96`、`TERRAIN_MAX_GRID_SIZE = 224`
 * - 画质档网格上限 `QUALITY_GRID_CAP`：eco 112 / balanced 160 / high 192 / ultra 224
 *   （ultra 与 TERRAIN_MAX_GRID_SIZE 一样是上游枚举/显存上限，见 topographyQualityFor —— 当前映射下不可达）
 * - 世界锚定按 range/lower/depth 出厂值推导：
 *   `TOPOGRAPHY_WORLD_SCALE ≈ 0.15504 / Y ≈ -6.362 / Z ≈ -7.61`
 */

export const TERRAIN_BASE_SIZE = 168
export const TERRAIN_MIN_GRID_SIZE = 96
export const TERRAIN_MAX_GRID_SIZE = 224

/** 上游 performanceQuality 的网格上限。 */
export const QUALITY_GRID_CAP = {
  eco: 112,
  balanced: 160,
  high: 192,
  ultra: 224,
} as const

export type TopographyQuality = keyof typeof QUALITY_GRID_CAP

/**
 * 地形世界锚定。
 *
 * 168 单位的地形整体缩进主场景，相机沿用轨道相机，因此推拉会同时作用在
 * 地形与其它舞台元素上。若不做这次收缩，地形会撑满整个视锥、把歌词和
 * 3D 卡片顶出画面。
 *
 * 上游 `deriveGroundLayoutSettings`（sonic-topography-preset.js:194-203）
 * 由三个滑杆推导，出厂默认 range=82 / lower=68 / depth=62：
 *
 *   scale = 0.096 + range * 0.00072   →  0.096 + 82*0.00072  = 0.15504
 *   y     = -4.05 - lower * 0.034     → -4.05 - 68*0.034    = -6.362
 *   z     = -4.20 - depth * 0.055     → -4.20 - 62*0.055    = -7.61
 */
const GROUND_RANGE_DEFAULT = 82
const GROUND_LOWER_DEFAULT = 68
const GROUND_DEPTH_DEFAULT = 62

export const TOPOGRAPHY_WORLD_SCALE = 0.096 + GROUND_RANGE_DEFAULT * 0.00072
export const TOPOGRAPHY_WORLD_Y = -4.05 - GROUND_LOWER_DEFAULT * 0.034
export const TOPOGRAPHY_WORLD_Z = -4.2 - GROUND_DEPTH_DEFAULT * 0.055

/** 悬浮方块数量（上游 DEFAULT_FLOATING_BLOCK_COUNT）。 */
export const DEFAULT_FLOATING_BLOCK_COUNT = 80

/** 涟漪寿命（秒），上游 `RIPPLE_LIFETIME`（sonic-topography-preset.js:11）。 */
export const RIPPLE_LIFETIME = 4.8
/** 涟漪软淡出起点（秒），上游 `RIPPLE_SOFT_FADE_START`。 */
export const RIPPLE_SOFT_FADE_START = 2.1

/**
 * GLSL `smoothstep(0,1,x)` 的 CPU 等价实现（含夹取）。
 *
 * 上游 JS 侧 `smoothstep01` 用它做涟漪的软淡出，必须与着色器里的
 * `1.0 - smoothstep(2.10, 4.80, timeSince)` 同步，否则 JS 与 GPU
 * 会各淡出一次，涟漪寿命看起来减半。
 */
export function smoothstep01(x: number): number {
  const t = clamp(Number.isFinite(x) ? x : 0, 0, 1)
  return t * t * (3 - 2 * t)
}

export interface TerrainGridSettings {
  gridSize: number
  spacing: number
  boxWidth: number
  instanceCount: number
}

/**
 * 由地形密度与画质档推导网格。
 *
 * 密度取 [0,100]（上游滑杆语义），映射到 [96, 224] 的网格边长，
 * 再被画质档上限夹取，最后按 168 的基准尺寸换算方块间距。
 */
export function deriveTerrainGridSettings(
  density: number,
  quality: TopographyQuality,
): TerrainGridSettings {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(density) ? density : 46))
  const target =
    TERRAIN_MIN_GRID_SIZE + (TERRAIN_MAX_GRID_SIZE - TERRAIN_MIN_GRID_SIZE) * (clamped / 100)
  const cap = QUALITY_GRID_CAP[quality] ?? QUALITY_GRID_CAP.balanced
  // 上游先把原始网格吸附到 4 的整数倍，再夹到 [96, 画质上限]
  // （sonic-topography-preset.js:226）。
  const gridSize = Math.max(
    TERRAIN_MIN_GRID_SIZE,
    Math.min(cap, Math.round(target / 4) * 4),
  )
  const spacing = TERRAIN_BASE_SIZE / gridSize
  // 方块略窄于间距，留出缝隙让地形保持"柱阵"而非连续平面。
  // 上游用 spacing * (0.9 / 1.05) ≈ 0.857·spacing（不是 0.82）。
  const boxWidth = spacing * (0.9 / 1.05)
  return {
    gridSize,
    spacing,
    boxWidth,
    instanceCount: gridSize * gridSize,
  }
}

/** 把本项目的画质档映射到上游的 performanceQuality。
 *
 *  本项目粒子画质最高为 high（183×183 → 'high' 档），因此 `ultra`（224）
 *  仅作为上游 performanceQuality 的完整枚举保留，当前映射不可达；
 *  `TERRAIN_MAX_GRID_SIZE = 224` 同理是显存压缩上限而非可达档位。 */
export function topographyQualityFor(policy: RenderPolicy): TopographyQuality {
  if (policy.particleGrid >= 149) return 'high'
  if (policy.particleGrid >= 100) return 'balanced'
  return 'eco'
}

/**
 * 逐频段 EQ 的出厂档位（上游 `DEFAULT_GROUND_BANDS`，`01-fx-defaults.js`）。
 *
 * 8 个值对应 subBass/bass/lowMid/mid/highMid/presence/brilliance/air，
 * `50` 为中性。注意低端被刻意抬高（90/92）—— 这让鼓点的抬升量几乎翻倍，
 * 是本项目此前**完全缺失**的一环（表现为地形低端"抬不起来"）。
 */
export const DEFAULT_GROUND_BANDS = [90, 92, 50, 50, 50, 50, 25, 48] as const

/**
 * 单频段 EQ 整形（上游 `applyGroundEqBandValue`，preset:213-220）。
 *
 * 滑杆 50 = ×1.0；>=50 时线性增益最高 ×2.8；<50 时先减 `dullness*0.35`
 * 再乘 `(1-dullness*0.35)`，即衰减比单纯缩放更"闷"。
 */
export function applyGroundEqBandValue(
  value: number,
  bands: readonly number[],
  index: number,
  max = 1,
): number {
  const eq = Number.isFinite(bands[index]) ? bands[index] : 50
  const delta = (eq - 50) / 50
  const safe = Number.isFinite(value) ? value : 0
  if (delta >= 0) return clamp(safe * (1 + delta * 1.8), 0, max)
  const dullness = Math.abs(delta)
  return clamp(Math.max(0, safe - dullness * 0.35) * (1 - dullness * 0.35), 0, max)
}

/** 低频踢鼓的地形形变量上限（上游 MAX_KICK_DEFORM）。 */
const MAX_KICK_DEFORM = 0.75
const MAX_SHADER_SUB_BASS = 1.2
const MAX_SHADER_BASS = 1.15
const KICK_SUB_BASS_GAIN = 1.28
const KICK_BASS_GAIN = 1.15
const BASE_SUB_BASS_GAIN = 0.22
const BASE_BASS_GAIN = 0.2

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** 把动画混合系数压到 [0,1]，非有限值当 0 处理。 */
export function clampAnimationBlend(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1)
}

/**
 * 踢鼓跟随的低频提升。
 *
 * 上游把「踢鼓包络」与「实测低频能量」按固定增益合成，**再过逐频段 EQ**
 * （band 0/1 出厂 90/92 → ×2.44/×2.51，`sonic-topography-preset.js:286-293`
 * 在本函数内部调用 `applyGroundEqBandValue`），最后夹到着色器上限，
 * 使鼓点既能把地形整体抬起，又不会因为 subBass 已经很高而爆掉。
 *
 * ★ EQ 必须在这一步施加：它正是「地形低频呼吸」的主要增益来源。
 *   此前本项目只做裸 clamp，低端响应比上游矮约一半。
 */
export function deriveKickFollowLowBands({
  kickEnvelope,
  subBassEnergy,
  bassEnergy,
  eqBands = DEFAULT_GROUND_BANDS,
}: {
  kickEnvelope: number
  subBassEnergy: number
  bassEnergy: number
  /** 逐频段 EQ 档位；默认取出厂 `DEFAULT_GROUND_BANDS`。 */
  eqBands?: readonly number[]
}): { subBass: number; bass: number } {
  const safeKick = clamp(Number.isFinite(kickEnvelope) ? kickEnvelope : 0, 0, MAX_KICK_DEFORM)
  const normalizedKick = safeKick / MAX_KICK_DEFORM
  const safeSubBass = clamp(Number.isFinite(subBassEnergy) ? subBassEnergy : 0, 0, 1)
  const safeBass = clamp(Number.isFinite(bassEnergy) ? bassEnergy : 0, 0, 1)

  const subBassInput = safeSubBass * BASE_SUB_BASS_GAIN + normalizedKick * KICK_SUB_BASS_GAIN
  const bassInput = safeBass * BASE_BASS_GAIN + normalizedKick * KICK_BASS_GAIN

  return {
    subBass: applyGroundEqBandValue(subBassInput, eqBands, 0, MAX_SHADER_SUB_BASS),
    bass: applyGroundEqBandValue(bassInput, eqBands, 1, MAX_SHADER_BASS),
  }
}

/**
 * 踢鼓包络的上游常量（快攻 42/s、慢放 11.5/s）在本项目由
 * `shared/SonicAudioMonitor.ts` 的 `stepKickEnvelope` 统一实现 ——
 * 地形直接消费引擎产出的 `kickEnvelope`，不再在本地重复跑一遍。
 */

