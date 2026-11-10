import { CROSSFADE_DEFAULT_SEC, clampCrossfadeSeconds, planCrossfade } from './crossfadePlanner.js'
import { chooseExpansionIntensity } from './expansionGesture.js'
import { planTransition, type TransitionPlan, type TransitionTrack } from './transitionPlanner.js'

// 上游 `transitionStrategy.ts` 的移植：两种策略产出同一个 TransitionPlan，这里只负责选哪一个。

export type TransitionMode = 'crossfade' | 'automix'

export interface TransitionSettings {
  mode: TransitionMode
  /** 固定交叉淡化的上限（秒）；automix 模式忽略。 */
  crossfadeMaxSec: number
  /** 让混音被听见：build-up 冲进鼓组换手，而不是悄悄到达。 */
  performance: boolean
}

export const DEFAULT_TRANSITION_SETTINGS: TransitionSettings = {
  mode: 'automix',
  crossfadeMaxSec: CROSSFADE_DEFAULT_SEC,
  performance: false,
}

export const isTransitionMode = (value: unknown): value is TransitionMode =>
  value === 'crossfade' || value === 'automix'

/** crossfade 不读拍网格，分析时也就不该为它白跑模型。 */
export const modeNeedsBeatGrid = (mode: TransitionMode): boolean => mode === 'automix'

/** 当前环境能否做离线分析（OfflineAudioContext）。 */
export const canAnalyseTracks = (): boolean => {
  if (typeof window === 'undefined') return false
  const offline =
    window.OfflineAudioContext ||
    (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  return typeof offline === 'function'
}

const hasEvidence = (from: TransitionTrack, to: TransitionTrack, bpm: number | null): boolean =>
  Boolean(
    from.profile ||
      to.profile ||
      (bpm !== null && Number.isFinite(bpm) && bpm > 0) ||
      from.lines?.length,
  )

/**
 * 有证据时走测量版 planner；完全没有证据时，automix 本来也只能得到一次
 * 固定长度的等功率淡化，交给 crossfade planner 处理同一条实测结束线。
 */
export const planForMode = (
  settings: TransitionSettings,
  from: TransitionTrack,
  to: TransitionTrack,
  bpm: number | null = null,
  at = 0,
): TransitionPlan => {
  if (settings.mode === 'crossfade') {
    return planCrossfade(from, to, clampCrossfadeSeconds(settings.crossfadeMaxSec), at)
  }
  if (hasEvidence(from, to, bpm)) {
    const plan = planTransition(from, to, bpm, at)
    if (!settings.performance) return plan
    return {
      ...plan,
      expansion: chooseExpansionIntensity({
        tailDb: from.profile?.tailDb,
        headDb: to.profile?.headDb,
        startsHot: to.profile?.startsHot,
      }),
    }
  }

  const plan = planCrossfade(from, to, CROSSFADE_DEFAULT_SEC, at)
  return { ...plan, reason: `automix has no evidence here, ${plan.reason} instead` }
}
