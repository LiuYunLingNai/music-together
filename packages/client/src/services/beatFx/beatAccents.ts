import type { BeatMap, BeatMapEvent } from './offlineBeatAnalysis'

/**
 * 拍点重音（accents）—— 上游 `src/services/analysis/beatAccents.ts` 的**等价实现**。
 *
 * 上游用 beat_this 的梅尔频谱逐拍量出「有多重、低/中/高各占多少、这一小节有没有节奏」，
 * 再算整首歌的动感系数。本仓的拍点来自 `offlineBeatAnalysis`（本地 onset + music-tempo
 * 网格），它已经把同样的信息算进了每个拍点事件：
 *
 *   · `impact`  —— 网格化时的合成冲击强度（0..1）
 *   · `low / body / snap` —— 低 / 中 / 高频能量占比
 *   · `camera / pulse` —— 这一拍是否真的落在有节奏的小节里
 *
 * 因此这里只做**口径换算**（见 `resolveBeatAccents`），不重复做频谱分析。
 * 换算后 `clock.ts` 的 `resolveBeatFxAccentGain`、各模式的 `resolve*BeatFxAccent`
 * 与上游逐字一致，视觉表现随重音变化的规则不需要改。
 */
export interface BeatAccents {
  v: number
  /** 每个网格拍一条，顺序与传入的拍点一致。 */
  impact: number[]
  low: number[]
  mid: number[]
  high: number[]
  /** 1 = 这一拍所在小节有节奏；0 = 纯持续音（这些拍不放效果）。 */
  rhythmic: number[]
  /** 1 = 真的被感觉到的拍；0 = 模型在中间数出来的（复拍子的八分音符）。 */
  pulse: number[]
  /** 整首歌的动感系数（0.45..1）；无重音时为 1。 */
  trackScale: number
}

/** 本模块产出的重音版本号，随口径变化递增（上游同样带一个 `v`）。 */
export const BEAT_ACCENTS_VERSION = 1

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** 一条拍点事件的三段占比：上游的 low / mid / high；缺字段时按等分回退。 */
const resolveTone = (event: BeatMapEvent): { low: number; mid: number; high: number } => {
  const low = clamp01(event.low ?? 0)
  const mid = clamp01(event.body ?? 0)
  const high = clamp01(event.snap ?? 0)
  const sum = low + mid + high
  if (sum <= 0) return { low: 1 / 3, mid: 1 / 3, high: 1 / 3 }
  return { low: low / sum, mid: mid / sum, high: high / sum }
}

/**
 * 从一张拍点图算出重音表。
 *
 * 只取 `cameraBeats`：它就是运镜与冲击脉冲共同认可的那条拍线（本地 onset 与
 * music-tempo 网格二选一），与 `pulseBeats` 同源但字段更全。
 */
export const resolveBeatAccents = (map: Pick<BeatMap, 'cameraBeats'>): BeatAccents | undefined => {
  const beats = map.cameraBeats
  if (beats.length < 2) return undefined

  const impacts: number[] = []
  const low: number[] = []
  const mid: number[] = []
  const high: number[] = []
  const rhythmic: number[] = []
  const pulse: number[] = []

  for (const event of beats) {
    const tone = resolveTone(event)
    low.push(tone.low)
    mid.push(tone.mid)
    high.push(tone.high)
    /**
     * ★ 不伪造 impact。
     *
     * 上游的 impact 是 beat_this 逐拍量出的「这一拍有多重」（0..1，中位数偏高）；本仓
     * `offlineBeatAnalysis` 的 `impact` 是**运镜合成强度**，中位数只有 0.4 左右。
     * 直接拿来当重音会把每一拍都判成弱拍：`resolveBeatFxAccentGain` 从 1 掉到
     * 0.5~0.7，所有拍点效果（推镜、开花大小）整体减弱一半 —— 实测就是这个现象。
     * 没有真实重音时按上游「无重音」分支走，增益恒为 trackScale。
     */
    impacts.push(Number.NaN)
    // 没进脉冲序列的拍就是「这一小节没有节奏」——上游的 rhythmic 0。
    rhythmic.push(event.pulse === false ? 0 : 1)
    // 网格拍本身就是被感觉到的拍；本地 onset 分支没设 pulse 字段，视作 1（与上游一致）。
    pulse.push(event.pulse === false ? 0 : 1)
  }

  return {
    v: BEAT_ACCENTS_VERSION,
    impact: impacts,
    low,
    mid,
    high,
    rhythmic,
    pulse,
    // 没有真实重音 ⇒ 动感系数 1（上游「没有 accents」时的值）。
    trackScale: 1,
  }
}

/** 一张拍点图的拍点时间（合并后的拍线）。 */
export const beatTimesOf = (map: Pick<BeatMap, 'cameraBeats'>): number[] => map.cameraBeats.map((beat) => beat.time)

/** 一张拍点图的重拍时间（`combo === 'downbeat'`，即网格四循环的第 0 拍）。 */
export const downbeatTimesOf = (map: Pick<BeatMap, 'cameraBeats'>): number[] =>
  map.cameraBeats.filter((beat) => beat.combo === 'downbeat').map((beat) => beat.time)
