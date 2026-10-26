/**
 * tempo 网格与相位校正 —— 上游 `03-beat/00-tempo-worker-cache-prefetch.js:1-90`
 * 与 `01-scene/02-beat-camera-runtime.js:115-130` 的忠实移植。
 *
 * 这里全是纯函数：输入拍点时间数组，输出网格步长 / 归一化序列 / 相位偏移。
 * 不碰 AudioContext、不碰 Worker，因此可以完整单测钉住数值。
 */

import {
  DEFAULT_ANALYSIS_PROFILE,
  type BeatMapEvent,
  type CinemaAnalysisProfile,
} from './beatAnalysisTypes'

/**
 * 区间内 gap 的中位数 —— 上游 `medianGap`（`:2-11`）。
 *
 * 上游取 `gaps[floor(len * 0.5)]`（偏上中位，偶数长度时取右侧），
 * 这里逐字照抄，不改成算术中位 —— 它参与 `gridStep` 与多处阈值比较。
 */
export function medianGap(times: number[] | null | undefined, minGap: number, maxGap: number): number {
  if (!times || times.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap >= minGap && gap <= maxGap) gaps.push(gap)
  }
  gaps.sort((a, b) => a - b)
  return gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0
}

/**
 * music-tempo 原始拍点的归一化 —— 上游 `normalizeMusicTempoBeats`（`:13-31`）。
 *
 * 做两件事：
 *   ① 丢掉首尾 50ms 内与非有限值；
 *   ② **按最小主拍间隔抽稀** —— music-tempo 在快歌上会给出半拍/八分音符
 *      密度的序列，直接当主拍用会让运镜每拍都踢一脚。上游的处理是：
 *      先取 0.20–1.20s 区间的中位 gap，若它 < 0.42s（即密过主拍），
 *      把最小间隔抬到 `min(0.44, gap × 1.65)`，否则用 0.36s。
 */
export function normalizeMusicTempoBeats(times: number[] | null | undefined, duration?: number): number[] {
  if (!times || !times.length) return []
  const sorted = times
    .filter((t) => Number.isFinite(t) && t >= 0.05 && (!duration || t < duration - 0.05))
    .sort((a, b) => a - b)
  if (sorted.length < 4) return sorted
  const gap = medianGap(sorted, 0.2, 1.2)
  const minMainGap = gap && gap < 0.42 ? Math.min(0.44, gap * 1.65) : 0.36
  const out: number[] = []
  let last = -10
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] - last >= minMainGap) {
      out.push(sorted[i])
      last = sorted[i]
    }
  }
  return out
}

/**
 * tempo 网格的相位校正 —— 上游 `estimateTempoPhaseOffset`（`:33-90`）。
 *
 * ## 为什么需要它
 *
 * music-tempo 给出的是**周期正确但相位可能整体偏移**的网格：它由自相关
 * 推 BPM，锚点取决于 onset 检测的第一个强点，而那个点未必落在真正的主拍上。
 * 偏移半个 16 分音符（~60ms）人眼就能看出"镜头比鼓点早/晚一点"。
 *
 * ## 做法
 *
 * 用**本地 onset 候选**（`beatCandidates`，已带 strength/low/camera 标记）
 * 给网格投票：每个够格的候选找到最近的网格点，把 `候选时间 − 网格点时间`
 * 丢进 25ms 的直方图桶，加权累计。权重来自 strength²、primary、camera、mass
 * ——即"越像真鼓点的候选，话越有分量"。
 *
 * 取票数最高的桶（含左右邻桶各 72% 的溢出），若它不足总权重的 26% 就
 * 判定为"没有一致相位"返回 0（宁可不校正，也不要跟着噪声跑偏）。
 * 否则在最优桶 ±1 范围内做加权平均得到亚桶精度的偏移。
 *
 * 最后两道闸：
 *   · `|offset| < 0.045` ⇒ 返回 0（本来就对得准，不动）
 *   · 钳到 `±maxOffset`，`maxOffset = clamp(step × 0.58, 0.12, 0.26)`
 *     （最多挪半拍多一点，不允许把网格挪到隔壁拍上去）
 */
export function estimateTempoPhaseOffset(
  tempoBeats: number[] | null | undefined,
  beatCandidates: BeatMapEvent[] | null | undefined,
  step: number,
  duration?: number,
): number {
  if (!tempoBeats || tempoBeats.length < 8 || !beatCandidates || beatCandidates.length < 4 || !step) return 0
  const maxOffset = Math.min(0.26, Math.max(0.12, step * 0.58))
  const binSize = 0.025
  const bins: Record<number, number> = {}
  const samples: Array<{ offset: number; weight: number; key: number }> = []
  let totalWeight = 0
  let ti = 0
  for (let i = 0; i < beatCandidates.length; i++) {
    const b = beatCandidates[i]
    if (!b || !Number.isFinite(b.time)) continue
    if (duration && (b.time < 1.0 || b.time > duration - 0.5)) continue
    const strength = Math.max(0, Math.min(1, b.strength || 0))
    if (!b.camera && strength < 0.54) continue
    if (b.low != null && b.low < 0.18 && strength < 0.66) continue
    while (ti < tempoBeats.length - 1 && Math.abs(tempoBeats[ti + 1] - b.time) <= Math.abs(tempoBeats[ti] - b.time)) ti++
    const base = tempoBeats[ti]
    const offset = b.time - base
    if (!Number.isFinite(offset) || Math.abs(offset) > maxOffset) continue
    let weight = 0.2 + strength * strength * 1.35
    if (b.primary) weight *= 1.35
    if (b.camera) weight *= 1.18
    if (b.mass != null) weight *= 0.82 + Math.max(0, Math.min(1, b.mass)) * 0.42
    if (Math.abs(offset) < 0.025) weight *= 0.72
    const key = Math.round(offset / binSize)
    bins[key] = (bins[key] || 0) + weight
    samples.push({ offset, weight, key })
    totalWeight += weight
  }
  if (samples.length < 4 || totalWeight <= 0) return 0
  let bestKey: number | null = null
  let bestWeight = 0
  Object.keys(bins).forEach((k) => {
    const key = parseInt(k, 10)
    const w = (bins[key] || 0) + (bins[key - 1] || 0) * 0.72 + (bins[key + 1] || 0) * 0.72
    if (w > bestWeight) {
      bestWeight = w
      bestKey = key
    }
  })
  if (bestKey == null || bestWeight < totalWeight * 0.26) return 0
  let sum = 0
  let wsum = 0
  for (let si = 0; si < samples.length; si++) {
    const s = samples[si]
    if (Math.abs(s.key - bestKey) <= 1) {
      sum += s.offset * s.weight
      wsum += s.weight
    }
  }
  if (wsum <= 0) return 0
  const offsetOut = sum / wsum
  return Math.abs(offsetOut) >= 0.045 ? Math.max(-maxOffset, Math.min(maxOffset, offsetOut)) : 0
}

/**
 * 整曲分析剖面 —— 上游 `cinemaAnalysisProfileForSong`
 * （`01-scene/02-beat-camera-runtime.js:115-130`）**原样移植**。
 *
 * ★ 上游只对歌名/歌手匹配 `/日落大道|sunsetboulevard/` 的歌返回 softGroove
 *   剖面，其余一律 default。本项目照搬该判断，但 softGroove 开启后的
 *   四个特性（phaseScan / localRefine / sparseCamera / introPattern，约 280 行）
 *   未移植 —— 见目录 `index.ts` 的「softGroove：为何未移植」。
 *
 *   因此本函数返回 softGroove 剖面时，调用方只会用到 `id`（进
 *   `BeatMap.analysisProfile`），四个布尔位目前无消费者。保留它们是为了
 *   将来补移植时不必再回上游对照。
 */
export function cinemaAnalysisProfileForSong(song?: { name?: string; title?: string; artist?: string } | null): CinemaAnalysisProfile {
  const title = String((song && (song.name || song.title)) || '').toLowerCase().replace(/\s+/g, '')
  const artist = String((song && song.artist) || '').toLowerCase().replace(/\s+/g, '')
  const label = `${title} ${artist}`
  if (/日落大道|sunsetboulevard/.test(label)) {
    return {
      id: 'sunset-boulevard-soft-groove',
      softGroove: true,
      phaseScan: true,
      localRefine: true,
      sparseCamera: true,
      introPattern: true,
    }
  }
  return { ...DEFAULT_ANALYSIS_PROFILE }
}
