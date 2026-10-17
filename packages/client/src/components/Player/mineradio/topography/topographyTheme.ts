import * as THREE from 'three'
import type { CoverPalette } from '../lyrics/coverPalette'

/**
 * 「声波地形」的配色主题。
 *
 * 移植自 Mineradio `public/sonic-topography-preset.js` 的内置主题
 * （其视觉算法源自 yin-yizhen/sonic-topography），并在本项目里补上
 * 「跟随封面调色板」这条既有舞台的统一约定：与本项目其它模式一致，
 * 主题色应当由封面主色驱动，而不是钉死在上游的 Nocturnal。
 */
export interface TopographyThemeColors {
  uBaseColor1: THREE.Color
  uBaseColor2: THREE.Color
  uFogColor: THREE.Color
  uCoolCore: THREE.Color
  uCoolEdge: THREE.Color
  uWarmCore: THREE.Color
  uWarmEdge: THREE.Color
  uRippleColor: THREE.Color
  uGlowIntensity: number
}

/** 上游 Nocturnal 主题的原始配色（无封面主色时的兜底）。 */
const NOCTURNAL: TopographyThemeColors = {
  uBaseColor1: new THREE.Color(0.01, 0.02, 0.04),
  uBaseColor2: new THREE.Color(0.03, 0.05, 0.09),
  uFogColor: new THREE.Color(0.01, 0.02, 0.04),
  uCoolCore: new THREE.Color(0.0, 0.3, 1.0),
  uCoolEdge: new THREE.Color(0.6, 0.2, 1.0),
  uWarmCore: new THREE.Color(1.0, 0.2, 0.1),
  uWarmEdge: new THREE.Color(1.0, 0.6, 0.0),
  uRippleColor: new THREE.Color(0.2, 0.9, 1.0),
  uGlowIntensity: 1.0,
}

function cloneTheme(base: TopographyThemeColors): TopographyThemeColors {
  return {
    uBaseColor1: base.uBaseColor1.clone(),
    uBaseColor2: base.uBaseColor2.clone(),
    uFogColor: base.uFogColor.clone(),
    uCoolCore: base.uCoolCore.clone(),
    uCoolEdge: base.uCoolEdge.clone(),
    uWarmCore: base.uWarmCore.clone(),
    uWarmEdge: base.uWarmEdge.clone(),
    uRippleColor: base.uRippleColor.clone(),
    uGlowIntensity: base.uGlowIntensity,
  }
}

/**
 * 安全地把调色板里的颜色字符串转成 THREE.Color。
 *
 * `CoverPalette.shadow` / `glow` 是 `rgba(...)` 形式，THREE.Color 无法解析
 * 会抛错或产出黑色，因此这里只接受 `#rrggbb`，其余回退到调用方给的值。
 */
function safeColor(value: string | undefined, fallback: string): THREE.Color {
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return new THREE.Color(value)
  return new THREE.Color(fallback)
}

/**
 * 上游辉光强度公式（`sonic-topography-preset.js:757-758`）：
 *
 *   glow = sonicNumber(fx, 'sonicGroundGlow', DEFAULT_GROUND_GLOW=68, 0, 100)
 *   uGlowIntensity = clamp(0.55 + glow*0.014 + bloomStrength*0.22, 0.45, 2.2)
 *
 * ★★ `sonicNumber` 的第三个参数是**兜底值**，只在 `fx` 里没有该键时生效。
 *    而 `fx` 出厂就带 `sonicGroundGlow: 20`（`00-state/04-fx-defaults.js:110`），
 *    所以上游实际跑的是 **20**，不是预设文件里那个 68。
 *
 *      glow=20 → clamp(0.55 + 0.28 + 0.1364) = 0.9664   ← 上游真实值
 *      glow=68 → clamp(0.55 + 0.952 + 0.1364) = 1.6384  ← 错取 fallback
 *
 *    此前本项目取了 68，再乘 `TOPOGRAPHY_GLOW_TRIM 0.78` = 1.278，
 *    **比上游亮 32%**。这正是 `ALIGNMENT-topography.md` §B15 为逐频段 EQ
 *    正确警告过的同一个坑（"preset 文件内那个是未被采用的 fallback"），
 *    辉光上重犯了一遍。
 */
const UPSTREAM_GROUND_GLOW = 20
const UPSTREAM_BLOOM_STRENGTH = 0.62
const TOPOGRAPHY_GLOW_INTENSITY = Math.max(
  0.45,
  Math.min(2.2, 0.55 + UPSTREAM_GROUND_GLOW * 0.014 + UPSTREAM_BLOOM_STRENGTH * 0.22),
)

/** 上游 `DEFAULT_GROUND_BASE_COLOR`（`sonic-topography-preset.js:26`）。 */
const GROUND_BASE_COLOR = '#05070c'
/** 上游 `DEFAULT_GROUND_COOL_COLOR`（同文件 :27），`palette.secondary` 的兜底。 */
const GROUND_COOL_COLOR = '#0066ff'
/** 上游 `DEFAULT_GROUND_ACCENT_COLOR`（同文件 :29），`palette.highlight` 的兜底。 */
const GROUND_ACCENT_COLOR = '#33e6ff'
/** 上游 `fx.visualTintColor` 出厂值（`04-fx-defaults.js:58`），`palette.primary` 的兜底。 */
const VISUAL_TINT_COLOR = '#9db8cf'

/**
 * 上游 `sonicPaletteHex(value, fallback)` → `lyricPaletteColorToHex(…, 0.42)`
 * → `lyricThreeColor(…, minLum = 0.42)`（`07-lyrics-palette-text-utils.js:565-576`）。
 *
 * 亮度地板：`lum = 0.299r + 0.587g + 0.114b`，低于 0.42 时三通道**各加**
 * `floor - lum`（不是乘法缩放），再钳到 1。暗封面因此被抬亮而不是变灰。
 */
function groundPaletteColor(value: string | undefined, fallback: string): THREE.Color {
  const c = safeColor(value, fallback)
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114
  if (lum < 0.42) {
    const lift = 0.42 - lum
    c.r = Math.min(1, c.r + lift)
    c.g = Math.min(1, c.g + lift)
    c.b = Math.min(1, c.b + lift)
  }
  return c
}

/**
 * 解析当前应当使用的主题 —— 上游 `sonicCoverGroundTheme`（:160-177）
 * 与 `syncTheme` 的边缘派生（:744-748）逐行同构。
 *
 * ```
 * primary   = sonicPaletteHex(palette.primary,   fx.visualTintColor '#9db8cf')
 * secondary = sonicPaletteHex(palette.secondary, '#0066ff')
 * highlight = sonicPaletteHex(palette.highlight, '#33e6ff')
 *
 * base1    = primary.lerp('#05070c', 0.84)      ← 底色**跟随封面主色**
 * base2    = base1.lerp(highlight, 0.14)
 * coolCore = primary.lerp('#ffffff', 0.08)
 * warmCore = secondary.lerp('#ffb15a', 0.18)    ← 暖极带橙色倾向
 * ripple   = highlight.lerp('#ffffff', 0.10)
 *
 * coolEdge = coolCore.lerp(base1, 0.34)         ← 边缘**趋向暗底**
 * warmEdge = warmCore.lerp(base1, 0.26)
 * fogColor = base1
 * ```
 *
 * ★★ 此前本项目这一段是**重写**而不是移植，两处方向性错误：
 *
 *   1. `base1` 被钉成固定近黑 `Color(0.01,0.02,0.04)*0.2`，完全忽略
 *      `primary` —— 底色与雾色不再跟随封面。
 *   2. `coolEdge`/`warmEdge` 朝 `highlight` 插值（趋亮），而上游朝 `base1`
 *      插值（趋暗）。着色器里
 *      `targetGlow = mix(zoneCore, zoneEdge, fract(rnd*11.0))`
 *      （`topographyShader.ts:259`）因此从"核→暗"反转成"核→亮"，
 *      整块地形的渐变方向是反的。
 *
 *   另外 `warmCore` 丢了 `#ffb15a` 的 0.18 橙色混入，暖极偏冷。
 */
export function resolveTopographyTheme(palette: CoverPalette | null, accent: string | null): TopographyThemeColors {
  const theme = cloneTheme(NOCTURNAL)

  if (palette) {
    const primary = groundPaletteColor(palette.primary, VISUAL_TINT_COLOR)
    const secondary = groundPaletteColor(palette.secondary, GROUND_COOL_COLOR)
    const highlight = groundPaletteColor(palette.highlight, GROUND_ACCENT_COLOR)

    const base1 = primary.clone().lerp(new THREE.Color(GROUND_BASE_COLOR), 0.84)
    const base2 = base1.clone().lerp(highlight, 0.14)
    const coolCore = primary.clone().lerp(new THREE.Color('#ffffff'), 0.08)
    const warmCore = secondary.clone().lerp(new THREE.Color('#ffb15a'), 0.18)
    const ripple = highlight.clone().lerp(new THREE.Color('#ffffff'), 0.1)

    theme.uBaseColor1.copy(base1)
    theme.uBaseColor2.copy(base2)
    theme.uFogColor.copy(base1)
    theme.uCoolCore.copy(coolCore)
    // 边缘派生（上游 syncTheme:745,747）：朝 base1 收，不是朝 highlight 开
    theme.uCoolEdge.copy(coolCore).lerp(base1, 0.34)
    theme.uWarmCore.copy(warmCore)
    theme.uWarmEdge.copy(warmCore).lerp(base1, 0.26)
    theme.uRippleColor.copy(ripple)
    theme.uGlowIntensity = TOPOGRAPHY_GLOW_INTENSITY
    return theme
  }

  // 无封面调色板：上游走 `sonicCoverGroundTheme` 的兜底链（palette 全空
  // ⇒ primary=visualTintColor、secondary='#0066ff'、highlight='#33e6ff'），
  // 而不是原封不动的 Nocturnal。accent 若有效则顶替 primary 的位置。
  const primary = groundPaletteColor(
    accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : undefined,
    VISUAL_TINT_COLOR,
  )
  const secondary = groundPaletteColor(undefined, GROUND_COOL_COLOR)
  const highlight = groundPaletteColor(undefined, GROUND_ACCENT_COLOR)

  const base1 = primary.clone().lerp(new THREE.Color(GROUND_BASE_COLOR), 0.84)
  theme.uBaseColor1.copy(base1)
  theme.uBaseColor2.copy(base1.clone().lerp(highlight, 0.14))
  theme.uFogColor.copy(base1)
  const coolCore = primary.clone().lerp(new THREE.Color('#ffffff'), 0.08)
  const warmCore = secondary.clone().lerp(new THREE.Color('#ffb15a'), 0.18)
  theme.uCoolCore.copy(coolCore)
  theme.uCoolEdge.copy(coolCore).lerp(base1, 0.34)
  theme.uWarmCore.copy(warmCore)
  theme.uWarmEdge.copy(warmCore).lerp(base1, 0.26)
  theme.uRippleColor.copy(highlight.clone().lerp(new THREE.Color('#ffffff'), 0.1))
  theme.uGlowIntensity = TOPOGRAPHY_GLOW_INTENSITY

  return theme
}
