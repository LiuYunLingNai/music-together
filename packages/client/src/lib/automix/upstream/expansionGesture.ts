import { curveOf } from './stemGesture'

// 上游 `expansionGesture.ts` 的排布与渲染部分。决策强度在 shared 层，
// 这里把 build-up 铺在鼓组换手之前，并直接渲染成样本：
// 一次性 source 无法按快照网格重触发，播放速率渐变又会破坏与媒体元素的时间对齐。

/** 短于这个长度是掉音，不是手势。 */
const MIN_SPAN_SEC = 0.35
/** 每次重复两端的淡入淡出，避免循环接缝咔哒。 */
const EDGE_SEC = 0.002
const SPINBACK_TOP_RATE = 2.6
const SPINBACK_DECAY = 0.35
/** 最浅的切分是半拍；再长会被听成倒带而不是滚奏。 */
const SHALLOWEST_DIVISION = 2

const STEPS = [
  { at: 0.25, beats: 2, levels: 1, topRate: 1.02, spinbackBeats: 0 },
  { at: 0.5, beats: 4, levels: 2, topRate: 1.06, spinbackBeats: 0 },
  { at: 0.75, beats: 8, levels: 3, topRate: 1.12, spinbackBeats: 0.5 },
  { at: 1, beats: 12, levels: 3, topRate: 1.2, spinbackBeats: 1 },
] as const

export type ExpansionStem = 'drums' | 'other'

/** 贝斯与人声从不参与：切碎的贝斯是糊，切碎的人声是故障。 */
export const expansionStems = (intensity: number): ExpansionStem[] =>
  intensity >= 0.75 ? ['drums', 'other'] : ['drums']

export interface ExpansionRepeat {
  at: number
  length: number
  sourceAt: number
  sourceLength: number
  rate: number
}

export interface ExpansionPlan {
  intensity: number
  from: number
  to: number
  stems: ExpansionStem[]
  repeats: ExpansionRepeat[]
  spinbackSec: number
  reason: string
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** 逐级减半：大部分时间停在舒服的切分，只在末尾加速。 */
const levelShare = (level: number, levels: number) =>
  1 / 2 ** level / (2 - 1 / 2 ** (levels - 1))

const nearestStep = (intensity: number) =>
  STEPS.reduce((best, candidate) =>
    Math.abs(candidate.at - intensity) < Math.abs(best.at - intensity) ? candidate : best,
  )

/**
 * 把 build 铺在出歌自己的网格上，并让它正好结束在鼓组换手点。
 * 前方空间不足时缩短 build，而不是移动 drop。
 */
export const planExpansion = (
  intensity: number,
  swapAt: number,
  barSec: number | null,
  windowSec: number,
  beatsPerBar = 4,
): ExpansionPlan | null => {
  const step = nearestStep(intensity)
  const bar = barSec && barSec > 0 ? barSec : windowSec / 4
  const beat = bar / Math.max(1, beatsPerBar)
  const asked = step.beats * beat
  const span = Math.min(asked, swapAt)
  if (!Number.isFinite(span) || span < MIN_SPAN_SEC) return null

  const from = swapAt - span
  const divisionAt = (level: number) => beat / (SHALLOWEST_DIVISION * 2 ** level)
  let levels = step.levels
  while (levels > 1 && span * levelShare(levels - 1, levels) < divisionAt(levels - 1) * 2) {
    levels -= 1
  }

  const repeats: ExpansionRepeat[] = []
  let levelStart = 0
  for (let level = 0; level < levels; level += 1) {
    const levelSpan = span * levelShare(level, levels)
    const division = divisionAt(level)
    const count = Math.max(1, Math.round(levelSpan / division))
    const length = levelSpan / count
    // 素材起点吸附到换手点所在的拍网格，避免循环到两拍之间的衰减里。
    const wanted = from + levelStart
    const snapped = swapAt - Math.round((swapAt - wanted) / beat) * beat
    const sourceAt = Math.max(0, Math.min(snapped, swapAt - length))
    for (let i = 0; i < count; i += 1) {
      repeats.push({
        at: levelStart + i * length,
        length,
        sourceAt,
        sourceLength: length,
        rate: 1,
      })
    }
    levelStart += levelSpan
  }
  const last = Math.max(1, repeats.length - 1)
  for (let i = 0; i < repeats.length; i += 1) {
    repeats[i].rate = 1 + (step.topRate - 1) * (i / last)
  }

  const spinbackSec = Math.min(step.spinbackBeats * beat, span / 3)
  const shortened = span < asked - 1e-6

  return {
    intensity: step.at,
    from,
    to: swapAt,
    stems: expansionStems(step.at),
    repeats,
    spinbackSec,
    reason:
      `${Math.round(step.at * 100)}% build, ${span.toFixed(2)}s` +
      ` (${levels} level${levels === 1 ? '' : 's'}, ${repeats.length} repeats` +
      `${spinbackSec > 0 ? `, ${spinbackSec.toFixed(2)}s spinback` : ''})` +
      `${shortened ? `, shortened from ${asked.toFixed(2)}s` : ''}`,
  }
}

/**
 * 把 build 渲染成样本，覆盖 `[plan.from, plan.to)`。
 * 读取在切片内回绕，因此升速后的重复不会跑到空白里。
 */
export const renderExpansion = (
  channels: readonly Float32Array[],
  plan: ExpansionPlan,
  sampleRate: number,
): Float32Array[] => {
  const total = Math.max(1, Math.round((plan.to - plan.from) * sampleRate))
  const out = channels.map(() => new Float32Array(total))
  const edge = Math.max(1, Math.round(EDGE_SEC * sampleRate))
  const spinFrom =
    plan.spinbackSec > 0 ? Math.max(0, total - Math.round(plan.spinbackSec * sampleRate)) : total

  for (const repeat of plan.repeats) {
    const start = Math.round(repeat.at * sampleRate)
    const stop = Math.min(total, spinFrom, start + Math.round(repeat.length * sampleRate))
    if (stop <= start) continue
    const sliceAt = Math.round(repeat.sourceAt * sampleRate)
    const sliceLength = Math.max(1, Math.round(repeat.sourceLength * sampleRate))
    const run = stop - start
    const fade = Math.max(1, Math.min(edge, Math.floor(run / 2)))
    for (let channel = 0; channel < channels.length; channel += 1) {
      const source = channels[channel]!
      const target = out[channel]!
      for (let i = 0; i < run; i += 1) {
        const phase = (i * repeat.rate) % sliceLength
        const read = sliceAt + Math.floor(phase)
        const sample = read >= 0 && read < source.length ? source[read]! : 0
        // 回绕点也要淡，否则每个重复中间都有一次反向跳变。
        const toWrap = Math.min(phase, sliceLength - phase) / repeat.rate
        const shape = Math.min(1, toWrap / fade, (run - 1 - i) / fade)
        target[start + i] = sample * Math.max(0, shape)
      }
    }
  }

  if (spinFrom < total) {
    const run = total - spinFrom
    const origin = Math.round(plan.to * sampleRate)
    const decay = Math.max(1, Math.round(run * SPINBACK_DECAY))
    for (let channel = 0; channel < channels.length; channel += 1) {
      const source = channels[channel]!
      const target = out[channel]!
      let read = origin
      for (let i = 0; i < run; i += 1) {
        read -= 1 + (SPINBACK_TOP_RATE - 1) * (i / run)
        const at = Math.floor(read)
        const sample = at >= 0 && at < source.length ? source[at]! : 0
        const left = run - 1 - i
        target[spinFrom + i] = sample * (left < decay ? left / decay : 1)
      }
    }
  }
  return out
}

/** 出歌中被接管的 stem 在 `[from, to)` 内静音：渲染缓冲正在替代它们。 */
export const expansionMask = (windowSec: number, plan: ExpansionPlan): Float32Array =>
  curveOf(windowSec, (at) => (at >= plan.from && at < plan.to ? 0 : 1))

/** 供调用方判断强度是否落在有效档位内。 */
export const isExpansionIntensity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1

export const clampExpansionIntensity = (value: unknown): number | null =>
  isExpansionIntensity(value) ? clamp(value, 0.25, 1) : null
