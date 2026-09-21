/**
 * 歌词显示配置：运动风格、显示模式、译词模式。
 *
 * 取值与语义参照 Mineradio 的 `08-lyrics-display-modes.js`。
 */

/** 6 种运动风格。 */
export type LyricMotionStyle = 'float' | 'smooth' | 'glass' | 'quick' | 'shine' | 'glitch'

export const LYRIC_MOTION_STYLES: readonly LyricMotionStyle[] = [
  'float',
  'smooth',
  'glass',
  'quick',
  'shine',
  'glitch',
] as const

export const LYRIC_MOTION_LABELS: Record<LyricMotionStyle, string> = {
  float: '漂浮',
  smooth: '平滑',
  glass: '玻璃',
  quick: '轻快',
  shine: '流光',
  glitch: '故障',
}

/**
 * 每种风格对应一组着色器参数。
 *
 * ★ 数值逐条取自上游 `08-lyrics-display-modes.js:131-171` 的 `lyricMotionProfile()`：
 *
 *   | style  | sweep | shimmer | edgeBoost | glowLift | floatAmp |
 *   | ---    | ---:  | ---:    | ---:      | ---:     | ---:     |
 *   | 默认/glass | 0.62 | 0.24 | 1.00 | 1.00 | 1.00 |
 *   | smooth | 0.18 | 0.05 | 0.62 | 0.74 | 0.55 |
 *   | float  | 0.36 | 0.14 | 1.04 | 1.16 | 1.45 |
 *   | shine  | 1.22 | 0.34 | 1.42 | 1.30 | 0.82 |
 *   | glitch | 0.54 | 0.28 | 1.18 | 1.08 | 0.70 |
 *   | quick  | 0.28 | 0.10 | 0.70 | 0.86 | 0.62 |
 *
 * ★ 此前这组值是自拟的，与上游对不上，其中最要命的是 `float` 的
 *   `sweep: 0` —— 而 `float` 正是**出厂默认风格**（上游
 *   `04-fx-defaults.js:33 lyricMotionStyle: 'float'`）。`uSweep` 为 0
 *   会把着色器的扫光项整个乘没（`lyricShaders.ts:107` 的
 *   `color += uSolarColor * sweepLine * uSweep * ...`），
 *   上游默认风格明明有一条可见的流动光带。同时 `uEdgeBoost` 在
 *   `LyricStage` 里被写死成 1，完全没有跟随风格 —— 一并改为查表。
 *
 * `breathe` 不在上游参数里（本项目网格浮动/呼吸的自有幅度），保持原值。
 */
export interface LyricMotionProfile {
  sweep: number
  shimmer: number
  /** 描边/边缘高亮强度（上游 motionProfile.edgeBoost） */
  edgeBoost: number
  glitch: number
  glitchSlice: number
  glitchChroma: number
  glitchRate: number
  /** 网格浮动幅度（世界单位） */
  floatAmp: number
  /** 呼吸缩放幅度 */
  breathe: number
}

const MOTION_PROFILES: Record<LyricMotionStyle, LyricMotionProfile> = {
  float: { sweep: 0.36, shimmer: 0.14, edgeBoost: 1.04, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, floatAmp: 1.45, breathe: 1 },
  smooth: { sweep: 0.18, shimmer: 0.05, edgeBoost: 0.62, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, floatAmp: 0.55, breathe: 0.6 },
  // glass 走上游的 else 分支（未单列的风格）
  glass: { sweep: 0.72, shimmer: 0.22, edgeBoost: 1.18, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, floatAmp: 1.0, breathe: 1.0 },
  quick: { sweep: 0.28, shimmer: 0.10, edgeBoost: 0.70, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, floatAmp: 0.62, breathe: 1.4 },
  shine: { sweep: 1.22, shimmer: 0.34, edgeBoost: 1.42, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, floatAmp: 0.82, breathe: 0.8 },
  glitch: { sweep: 0.54, shimmer: 0.28, edgeBoost: 1.18, glitch: 1.0, glitchSlice: 1.0, glitchChroma: 1.0, glitchRate: 1.4, floatAmp: 0.70, breathe: 1.0 },
}

export function getMotionProfile(style: LyricMotionStyle): LyricMotionProfile {
  return MOTION_PROFILES[style] ?? MOTION_PROFILES.float
}

/** 6 种显示模式。 */
export type LyricDisplayMode = 'single' | 'dual' | 'triple' | 'cinema' | 'custom'

export const LYRIC_DISPLAY_MODES: readonly LyricDisplayMode[] = [
  'single',
  'dual',
  'triple',
  'cinema',
  'custom',
] as const

export const LYRIC_DISPLAY_LABELS: Record<LyricDisplayMode, string> = {
  single: '单行',
  dual: '双行',
  triple: '三行',
  cinema: '影院（5 行）',
  custom: '自定义',
}

/**
 * 模式 → 显示行数。
 *
 * 与 Mineradio 的 `lyricDisplayLineCountForMode` 一致：
 * single 1 / dual 2 / triple 3 / cinema 5 / custom 1-10
 */
export function lyricLineCountForMode(mode: LyricDisplayMode, customCount = 5): number {
  if (mode === 'single') return 1
  if (mode === 'dual') return 2
  if (mode === 'triple') return 3
  if (mode === 'cinema') return 5
  return Math.max(1, Math.min(10, Math.round(customCount)))
}

/**
 * 各显示槽位相对当前行的偏移。
 *
 * 与上游一致：single `[0]`，dual `[0,1]`，其余以激活行为中心对称展开。
 */
export function lyricSlotOffsets(mode: LyricDisplayMode, customCount = 5): number[] {
  if (mode === 'single') return [0]
  if (mode === 'dual') return [0, 1]

  const count = lyricLineCountForMode(mode, customCount)
  const activeSlot = Math.floor(count / 2)
  const offsets: number[] = []
  for (let i = 0; i < count; i++) offsets.push(i - activeSlot)
  return offsets
}

/** 4 种译词模式。 */
export type LyricTranslationMode = 'off' | 'current' | 'dual' | 'multi'

export const LYRIC_TRANSLATION_MODES: readonly LyricTranslationMode[] = ['off', 'current', 'dual', 'multi'] as const

export const LYRIC_TRANSLATION_LABELS: Record<LyricTranslationMode, string> = {
  off: '不显示',
  current: '仅当前行',
  dual: '当前 + 下一行',
  multi: '全部上下文',
}

/**
 * 译词「自适应缩回」—— 显示行数过多时按梯级降档。
 *
 * ============================ 设计说明 ============================
 *
 * ★ 首先澄清一个事实：**AMLL core 0.5.2 没有这个功能**。把该包（含
 *   source map 里的原始 TS/CSS）grep `自适应/缩回/retract/adaptive/
 *   hideSubLine/subLineVisible` 全部零命中；它只有 `em` 比例缩放（随视口
 *   字号整体缩放）与按播放位置的**整行**淡出，都不是"按空间收缩译词"。
 *   因此这是**新增设计**，不是移植 —— 按用户明确要求实现。
 *
 * ★ 为什么不按"视口高度"判：3D 舞台里歌词平面的可见高度由相机 FOV 与
 *   到平面的距离决定（emily 档 ≈4.26 world），**与窗口像素高度无关** ——
 *   窗口变矮只会让整幅画面等比变小，歌词占画面的比例不变。所以
 *   "窗口太矮就收译词"在几何上不成立。
 *
 * ★ 真正的约束是**歌词堆叠自身占可见高度的比例**：行数 × 每行槽位。
 *   超过阈值时堆叠会挤满画面、上下文行被推到视口外。梯级按此推导：
 *
 *     档位      行数 8    行数 9    行数 10
 *     multi     62.3%     70.1%     77.9%   ← 过宽
 *     dual      52.8%     59.2%     65.6%
 *     current   52.8%     59.2%     65.6%
 *     off       51.4%     57.7%     64.3%
 *
 *   阈值 **0.70**（按"最窄档也不会被误伤"标定）：
 *     · 行数 ≤8 保持用户所选档（multi 最高 62.3%）
 *     · 9 行起 multi 降到 dual
 *     · `current` 在任何行数下都 ≤65.6% < 0.70 —— **永远不会被降档**，
 *       即用户明确要的"仅当前行译词"不会被自适应拿走。
 *
 *   若阈值取 0.62，10 行时连 `current` 都会被降到 `off`，把用户明确
 *   要求的译词整个藏掉 —— 这是设计缺陷，已由单元测试钉住。
 *
 *   用户选 `off`/`current` 时**不升档**，只在选了较宽档且空间不足时向下收。
 */

/** 梯级（从宽到窄）。用户档位只会沿此方向下调。 */
const RETRACT_LADDER: readonly LyricTranslationMode[] = ['multi', 'dual', 'current', 'off']

/**
 * 堆叠占可见高度超过此比例就降一档。
 *
 * ★ 标定依据（两组硬约束，缺一不可）：
 *   a. `current` 在**任何**行数下都不得被降档 —— 它是用户明确要的
 *      "仅当前行译词"，自适应不该把它拿走。10 行时 current = 0.715，
 *      因此阈值必须 **≥ 0.715**。
 *   b. multi 要**可被观察到**地收缩。出厂默认显示模式 cinema = 5 行时
 *      multi = 0.682（应保持），6 行起 0.818 起跳 —— 阈值取 0.72 时
 *      "5 行保持、6 行收缩"，边界正好落在默认档与相邻档之间。
 *   取 0.72：满足 a（0.715 < 0.72），且 multi 在 6 行起收缩。
 *
 *   此前取 0.70 不满足 a（10 行会把 current 降到 off，把用户要的译词藏掉）。
 *   取 0.62 更糟。这两个缺陷都已被单元测试钉住。
 */
const RETRACT_STACK_LIMIT = 0.72

/**
 * 译词行相对主行的槽位步长（与 LyricStage 的 `SLOT_WITH_TRANS` 同源）。
 *
 * ★ 第二十五轮修正：此前写 `0.301 + 0.911`（沿用了那次量纲错误的产物），
 *   现在与 `LyricStage` 一致取上游出厂总量 2.1214 —— 间距在译词两侧均分
 *   后总量不变，因此这里的槽位占用也不变。
 */
const SLOT_PLAIN = 1
const SLOT_WITH_TRANS = 2.1214
/** 相机到歌词平面的可见高度（emily 档 FOV45 / radius6.6 / planeZ1.46）。 */
const VISIBLE_HEIGHT_WORLD = 4.258
/** 槽位 → 世界步长 × 歌词组避让缩放（LyricStage 的 0.38 × 0.72）。 */
const SLOT_WORLD = 0.38 * 0.72

/** 某档位下 n 行歌词占用的槽位总数。 */
function translationStackSlots(lineCount: number, mode: LyricTranslationMode): number {
  if (mode === 'off') return lineCount * SLOT_PLAIN
  // multi 每行都带译词；dual / current 只有当前行（±下一行）带
  if (mode === 'multi') return lineCount * SLOT_WITH_TRANS
  return (lineCount - 1) * SLOT_PLAIN + SLOT_WITH_TRANS
}

/** 该档位下堆叠占可见高度的比例（0..1+）。 */
export function translationStackFraction(lineCount: number, mode: LyricTranslationMode): number {
  return (translationStackSlots(lineCount, mode) * SLOT_WORLD) / VISIBLE_HEIGHT_WORLD
}

/**
 * 按显示行数自适应收缩译词档位。
 *
 * @param requested 用户设置的档位（不会被升档）
 * @param lineCount 当前显示模式的歌词行数
 * @returns 实际生效的档位
 */
export function retractTranslationMode(
  requested: LyricTranslationMode,
  lineCount: number,
): LyricTranslationMode {
  if (requested === 'off') return 'off'
  const start = RETRACT_LADDER.indexOf(requested)
  if (start < 0) return requested
  for (let i = start; i < RETRACT_LADDER.length; i++) {
    const candidate = RETRACT_LADDER[i]
    if (translationStackFraction(lineCount, candidate) <= RETRACT_STACK_LIMIT) return candidate
  }
  return 'off'
}

/**
 * 上下文行的透明度与缩放。
 *
 * 参照 Mineradio 的 `stageLyricContextEntry`：
 * cinema 模式下近/远行的层次略有不同。
 */
export interface LyricContextStyle {
  nearAlpha: number
  farAlpha: number
  nearScale: number
  farScale: number
}

export function getContextStyle(mode: LyricDisplayMode, contextOpacity = 0.54): LyricContextStyle {
  const opacity = Math.max(0.25, Math.min(1, contextOpacity))
  if (mode === 'cinema') {
    return { nearAlpha: opacity, farAlpha: opacity * 0.64, nearScale: 0.9, farScale: 0.82 }
  }
  return { nearAlpha: opacity * 0.92, farAlpha: opacity * 0.52, nearScale: 0.88, farScale: 0.78 }
}
