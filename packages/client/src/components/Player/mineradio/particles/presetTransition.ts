/**
 * 预设切换脉冲。
 *
 * 严格对照 Mineradio `07-fx/04-preset-grid-uniforms.js` 的
 * `triggerPresetParticleTransition` + `tickPresetTransition`。
 *
 * ============================ 为什么需要这个 ============================
 *
 * 此前切换视觉模式是**硬切**：uPreset 直接从旧值跳到新值，粒子瞬间
 * 重排，没有任何过渡。Mineradio 在切换瞬间会：
 *
 *   1. 抬高 uScatter（粒子离散）
 *   2. 抬高 uBurstAmt（亮度与点尺寸加成）
 *   3. 放大 uPointScale
 *   4. 触发 3 道随机涟漪
 *
 * 并在 0.24s（星河 0.30s）内用 `sin(t * PI)` 的半周波形回落，
 * 因此是「炸开再收拢」而不是跳变。
 *
 * ============================ 星河为什么不同 ============================
 *
 * 上游对 `preset === 5`（星河/WALLPAPER）单独给了一组**极小**的系数
 * （scatter 0.008 对比常规 0.12，差 15 倍）。原因是星河的粒子本就分布
 * 在 ±45 世界单位的纵深里，常规幅度的 scatter 会让整片星河散架。
 *
 * 同理 `preset >= 4`（唱片、星河）属于上游注释里的 `newVisual`，
 * 幅度整体小于 0-3 的封面类预设 —— 那几个预设的粒子是贴在
 * 4.8×4.8 平面上的，炸开才有观感。
 */

/** 常规预设的过渡时长（秒） */
export const PRESET_TRANSITION_DURATION = 0.24
/** 星河预设的过渡时长（秒）—— 上游单独放宽 */
export const PRESET_TRANSITION_DURATION_WALLPAPER = 0.3
/** 星河预设的着色器编号 */
const WALLPAPER_PRESET = 5
/** 上游 `newVisual` 的判定阈值：4 以上是唱片/星河这类非平面预设 */
const NEW_VISUAL_MIN_PRESET = 4

export interface PresetPulse {
  /** 叠加到 uScatter 上的增量 */
  scatter: number
  /** 叠加到 uBurstAmt 上的增量 */
  burst: number
  /** uPointScale 的乘数 */
  pointScaleMul: number
}

/** 无过渡时的中性值。 */
export const NEUTRAL_PULSE: PresetPulse = { scatter: 0, burst: 0, pointScaleMul: 1 }

/** 该预设的过渡时长。 */
export function presetTransitionDuration(toPreset: number): number {
  return toPreset === WALLPAPER_PRESET
    ? PRESET_TRANSITION_DURATION_WALLPAPER
    : PRESET_TRANSITION_DURATION
}

/**
 * 切换瞬间的起始脉冲 —— 上游 `triggerPresetParticleTransition`。
 *
 * 上游是 `Math.max(当前值, 基准 + 增量)`，因此这里只返回**增量**，
 * 由调用方与当前 uniform 取 max，语义保持一致。
 */
export function presetTransitionKick(toPreset: number): PresetPulse {
  const wallpaperFlow = toPreset === WALLPAPER_PRESET
  const newVisual = toPreset >= NEW_VISUAL_MIN_PRESET
  return {
    scatter: newVisual ? (wallpaperFlow ? 0.008 : 0.024) : 0.12,
    burst: wallpaperFlow ? 0.05 : 0.15,
    pointScaleMul: 1,
  }
}

/**
 * 过渡进行中的逐帧脉冲 —— 上游 `tickPresetTransition`。
 *
 * @param progress 归一化进度；<0 或 >1 视为过渡结束
 */
export function presetTransitionPulse(toPreset: number, progress: number): PresetPulse {
  if (!(progress >= 0) || progress > 1) return NEUTRAL_PULSE

  const wallpaperFlow = toPreset === WALLPAPER_PRESET
  const newVisual = toPreset >= NEW_VISUAL_MIN_PRESET
  // 上游用 sin(t * PI)：0 → 1 → 0 的半周，天然「炸开再收拢」
  const wave = Math.sin(progress * Math.PI)

  return {
    scatter: wave * (newVisual ? (wallpaperFlow ? 0.008 : 0.026) : 0.16),
    burst: wave * (wallpaperFlow ? 0.045 : newVisual ? 0.12 : 0.15),
    pointScaleMul: 1 + wave * (wallpaperFlow ? 0.016 : 0.048),
  }
}

/** 切换时触发的涟漪数量与位置范围（上游：3 道，±1.7 世界单位）。 */
export const PRESET_TRANSITION_RIPPLE_COUNT = 3
export const PRESET_TRANSITION_RIPPLE_SPREAD = 3.4

/** 过渡状态：只记录目标预设与起始时刻，进度由调用方按当前时间推导。 */
export interface PresetTransitionState {
  active: boolean
  toPreset: number
  startAt: number
}

export function createPresetTransition(): PresetTransitionState {
  return { active: false, toPreset: 0, startAt: 0 }
}

/** 开始一次过渡（上游 `triggerPresetParticleTransition` 的状态部分）。 */
export function beginPresetTransition(
  state: PresetTransitionState,
  toPreset: number,
  now: number,
): PresetPulse {
  state.active = true
  state.toPreset = toPreset
  state.startAt = now
  return presetTransitionKick(toPreset)
}

/**
 * 推进过渡并返回本帧脉冲；过渡结束返回 `null`。
 *
 * 上游 `tickPresetTransition` 在 `raw >= 1` 时清标志位并调用
 * `syncFxUniforms()` 把 uniform 复位，这里等价于返回 null 后
 * 由调用方保留基准值。
 */
export function tickPresetTransition(
  state: PresetTransitionState,
  now: number,
): PresetPulse | null {
  if (!state.active) return null

  const raw = (now - state.startAt) / presetTransitionDuration(state.toPreset)
  if (raw >= 1) {
    state.active = false
    return null
  }

  return presetTransitionPulse(state.toPreset, Math.max(0, Math.min(1, raw)))
}
