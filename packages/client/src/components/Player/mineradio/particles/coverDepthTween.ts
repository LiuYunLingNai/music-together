/**
 * 封面深度状态补间 —— 上游 `setCoverDepthState`
 * （`02-visual/15-ripples-cover-depth.js:486-514`）。
 *
 * ============================ 上游状态机 ============================
 *
 *   function setCoverDepthState(depthTo, aiTo, durationMs) {
 *     depthTo = clamp01(depthTo); aiTo = clamp01(aiTo);
 *     if (coverDepthTween) cancelAnimationFrame(coverDepthTween.raf);
 *     durationMs = max(1, durationMs || 1);
 *     depthFrom = uniforms.uHasDepth.value || 0;
 *     aiFrom    = uniforms.uAiBoost.value || 0;
 *     if (durationMs <= 1
 *         || (abs(depthFrom - depthTo) < 0.001 && abs(aiFrom - aiTo) < 0.001)) {
 *       uniforms.uHasDepth.value = depthTo;   ← 硬落位
 *       uniforms.uAiBoost.value  = aiTo;
 *       return;
 *     }
 *     rAF: 两个值一起按 visualEase 补间
 *   }
 *
 * 四个调用点（全部在 `15-ripples-cover-depth.js`）：
 *
 *   :306  setCoverDepthState(1, 1.0, 360)    AI 深度后台增强完成
 *   :588  setCoverDepthState(1, ai?1.0:0.55, deferHeavy?180:120)
 *                                          ★ 命中深度缓存（切歌最常见路径）
 *   :591  setCoverDepthState(0, 0, deferHeavy?96:1)   无缓存 → 中性边缘
 *   :629  setCoverDepthState(1, 0.55, deferHeavy?260:180)   重算完成
 *
 * 另有 `03-beat/05-cover-loading-crop.js:26,36,67` 三处
 *   `uniforms.uHasCover.value = 0; setCoverDepthState(0, 0, 1);`
 * —— 封面加载/裁剪期间**立即**清掉深度（durationMs = 1 命中硬落位分支）。
 *
 * ============================ 为什么必须移植 ============================
 *
 * `uHasDepth` 不是装饰 uniform，它在着色器里**改变构图**：
 *
 *   float depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth;
 *                                                              ^^^^^^^^^ 门控
 *   if (uHasDepth > 0.5 && uPreset < 0.5) {
 *     float bgMul = mix(1.0, 0.55, uBgFade * (1.0 - fgMask));   ← 背景压暗
 *     vBright *= bgMul;
 *   }
 *
 * 本项目此前把 `uHasDepth` 写成 `edgeTexture ? 1 : 0`（**瞬变**），
 * 而上游是 120~360ms 的 smoothstep 补间。后果：
 *
 *   · 切歌时深度位移与背景压暗**整帧跳变** —— 封面从"平面"突然"有纵深"，
 *     同时背景暗一下。上游是渐变进来的。
 *   · `deferHeavy` 那一档（180/260ms）表示"重活延后做"，本项目无从表达。
 *
 * ★ 与上游的差异（刻意，且只此一处）：上游 `uHasDepth` 与 `uAiBoost`
 *   **成对**补间（同一个函数、同一条 rAF、同一个 visualEase 系数）。
 *   本项目此前只补间了 `uAiBoost`、且用的是固定速率 `dt * 4`
 *   （等价时长随帧率漂移）。现在按上游把两者合成一个补间。
 */

import { visualEase } from './loadingState'

/** 上游 `abs(x - y) < 0.001` 的"已到位"判据（:496）。 */
export const DEPTH_SETTLED_EPSILON = 0.001

/**
 * 上游四个调用点的时长（毫秒）。
 *
 * `deferHeavy` 是上游"重活延后"档（封面刚加载、还有交互在进行），
 * 本项目没有该档位（封面处理是同步的一次性启发式计算），
 * 因此恒取**非 deferHeavy** 值 —— 那是上游的正常路径。
 */
export const COVER_DEPTH_TWEEN_MS = {
  /** :306 AI 深度增强完成（本项目无 AI 深度，保留备查） */
  aiEnhanced: 360,
  /** :588 命中深度缓存 */
  cached: 120,
  /** :591 无缓存 → 中性边缘 */
  neutral: 1,
  /** :629 重新计算完成 */
  recomputed: 180,
} as const

/** 深度档位：`uHasDepth` 与 `uAiBoost` 的目标对。 */
export interface CoverDepthTarget {
  depth: number
  ai: number
}

/**
 * 封面深度补间状态。
 *
 * `target === null` 表示无补间在飞（上游 `coverDepthTween === null`）。
 */
export interface CoverDepthTweenState {
  target: CoverDepthTarget | null
  startedAt: number
  fromDepth: number
  fromAi: number
  durationMs: number
}

export function createCoverDepthTween(): CoverDepthTweenState {
  return { target: null, startedAt: 0, fromDepth: 0, fromAi: 0, durationMs: 0 }
}

/** 上游 `clamp01`（:487-488）。 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

/**
 * 上游 `setCoverDepthState` 的**装配**部分（:486-502）。
 *
 * 与 `loadingState.tweenLoading` 同一处理：上游用独立 rAF，本项目改由
 * 渲染循环推进（`stepCoverDepth`），算术逐项相同。
 *
 * @param current 当前两个 uniform 的值
 * @param to      目标对
 * @param durationMs 时长；≤1 或已到位时**直接返回硬落位标记**
 * @returns 是否需要补间（false = 调用方应立即写入目标值）
 */
export function beginCoverDepthTween(
  state: CoverDepthTweenState,
  current: { depth: number; ai: number },
  to: CoverDepthTarget,
  durationMs: number,
): boolean {
  const depthTo = clamp01(to.depth)
  const aiTo = clamp01(to.ai)
  const ms = Math.max(1, durationMs || 1)
  const fromDepth = current.depth || 0
  const fromAi = current.ai || 0

  // 上游 :495-501 的短路：时长 ≤1ms，或两个值都已到位 ⇒ 硬落位。
  if (ms <= 1 || (Math.abs(fromDepth - depthTo) < DEPTH_SETTLED_EPSILON && Math.abs(fromAi - aiTo) < DEPTH_SETTLED_EPSILON)) {
    state.target = null
    return false
  }

  state.fromDepth = fromDepth
  state.fromAi = fromAi
  state.target = { depth: depthTo, ai: aiTo }
  state.startedAt = performance.now()
  state.durationMs = ms
  return true
}

/**
 * 上游补间的 rAF 回调体（:503-513）—— 两个值共用同一个 `eased`。
 *
 * @returns 补间后的 `{ depth, ai }`；`done` 为真时调用方应清空 tween。
 */
export function stepCoverDepth(
  state: CoverDepthTweenState,
  now: number,
  current: { depth: number; ai: number },
): { depth: number; ai: number; done: boolean } {
  if (!state.target) return { depth: current.depth, ai: current.ai, done: true }
  const raw = Math.min(1, (now - state.startedAt) / state.durationMs)
  const eased = visualEase(raw)
  if (raw < 1) {
    return {
      depth: state.fromDepth + (state.target.depth - state.fromDepth) * eased,
      ai: state.fromAi + (state.target.ai - state.fromAi) * eased,
      done: false,
    }
  }
  // 上游 `t >= 1` 的 else 支：硬落位并清空补间
  return { depth: state.target.depth, ai: state.target.ai, done: true }
}
