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
 * 出厂 bloomStrength=0.62（`04-fx-defaults.js:16`）→ 约 1.64。
 * 与封面色板无关 —— 此前本项目在有色板时写死 0.2，地形比上游暗得多。
 */
const UPSTREAM_GROUND_GLOW = 68
const UPSTREAM_BLOOM_STRENGTH = 0.62
const TOPOGRAPHY_GLOW_INTENSITY = Math.max(
  0.45,
  Math.min(2.2, 0.55 + UPSTREAM_GROUND_GLOW * 0.014 + UPSTREAM_BLOOM_STRENGTH * 0.22),
)

/**
 * 解析当前应当使用的主题。
 *
 * 有封面调色板时按封面主色推导：底色压到阴影色的 20%（保住地形的暗部
 * 对比），冷/暖两极分别取 primary / secondary，涟漪取 highlight。
 * 这与上游 `resolveTopographyTheme` 的映射一致。
 */
export function resolveTopographyTheme(palette: CoverPalette | null, accent: string | null): TopographyThemeColors {
  const theme = cloneTheme(NOCTURNAL)

  if (palette) {
    const primary = safeColor(palette.primary, '#e8f4ff')
    const secondary = safeColor(palette.secondary, '#9db8cf')
    const highlight = safeColor(palette.highlight, '#ffffff')
    // shadow 是 rgba 字符串，无法直接解析；用基色的 20% 作为暗部等价物
    const shadow = new THREE.Color(0.01, 0.02, 0.04)

    theme.uBaseColor1.copy(shadow).multiplyScalar(0.2)
    theme.uFogColor.copy(theme.uBaseColor1)
    theme.uBaseColor2.copy(shadow).lerp(primary, 0.22)
    theme.uCoolCore.copy(primary)
    theme.uCoolEdge.copy(primary).lerp(highlight, 0.35)
    theme.uWarmCore.copy(secondary)
    theme.uWarmEdge.copy(secondary).lerp(highlight, 0.28)
    theme.uRippleColor.copy(highlight)
    theme.uGlowIntensity = TOPOGRAPHY_GLOW_INTENSITY
    return theme
  }

  if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
    const color = new THREE.Color(accent)
    theme.uRippleColor.copy(color)
    theme.uCoolCore.copy(color)
    theme.uCoolEdge.copy(color).lerp(new THREE.Color('#ffffff'), 0.35)
  }

  return theme
}
