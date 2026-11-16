import type { BeatCombo, BeatMap, BeatMapEvent, PulseBeat } from '../beatFx/offlineBeatAnalysis/beatAnalysisTypes'
import type { BeatThisAnalysis } from './beatThisAnalysis'

/**
 * beat_this 的拍点与重音 → 宿主 `BeatMap`。
 *
 * 语义对应上游 beatFx：
 *   · `primary` = 该小节有节奏（HPSS 打击门），持续音铺底的小节不出屏幕特效；
 *   · `pulse`   = 模型判定的“被感受到的拍”；
 *   · `camera`  = 两者都成立；
 *   · `strength/impact` = beatAccents 的 impact，`low/body/snap` = 三段能量；
 *   · `confidence` 用全曲 p10→0 / p90→1 归一，保持宿主相机 0.62/0.68 阈值可用。
 */

const percentile = (sorted: readonly number[], fraction: number): number => {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
  return sorted[index]
}

const medianInterval = (beats: readonly number[]): number => {
  if (beats.length < 2) return 0
  const gaps: number[] = []
  for (let index = 1; index < beats.length; index += 1) gaps.push(beats[index] - beats[index - 1])
  gaps.sort((a, b) => a - b)
  const middle = gaps.length >> 1
  return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2
}

const COMBO_SLOTS: BeatCombo[] = ['downbeat', 'push', 'drop', 'rebound']

export const beatMapFromBeatThis = (analysis: BeatThisAnalysis, analysisProfile: string): BeatMap => {
  const { beats, downbeats, accents, confidence } = analysis
  const sortedConfidence = [...confidence].sort((a, b) => a - b)
  const low = percentile(sortedConfidence, 0.1)
  const high = percentile(sortedConfidence, 0.9)
  const span = high - low
  const downbeatSet = new Set(downbeats)

  const events: BeatMapEvent[] = beats.map((time, index) => {
    const rhythmic = accents.rhythmic[index] === 1
    const pulse = accents.pulse[index] === 1
    const impact = accents.impact[index] ?? 0
    const confidence01 = span > 1e-6 ? Math.min(1, Math.max(0, (confidence[index] - low) / span)) : 0.7
    return {
      time,
      strength: impact,
      confidence: confidence01,
      camera: rhythmic && pulse,
      pulse,
      primary: rhythmic,
      impact,
      tone: 'music-tempo',
      low: accents.low[index],
      body: accents.mid[index],
      snap: accents.high[index],
      combo: COMBO_SLOTS[index % 4],
      index,
    }
  })

  // 小节位置以模型的下拍为准；没有下拍时退回四拍循环。
  let sinceDownbeat = 0
  for (const event of events) {
    if (downbeatSet.has(event.time)) {
      sinceDownbeat = 0
      event.combo = 'downbeat'
    } else {
      sinceDownbeat += 1
      event.combo = COMBO_SLOTS[sinceDownbeat % 4]
    }
  }

  const cameraIndexes = events
    .map((event, index) => (event.camera !== false ? index : -1))
    .filter((index) => index >= 0)
  // `cameraBeats` 必须是运镜光标实际要走的子集：模型会在两拍之间数出八分音符
  // （pulse = 0），它们不该各推一次镜头。
  const cameraBeats = cameraIndexes.map((index) => events[index])

  // 模型算出的重音带着上游的 impact / trackScale；原样交给 beatFx，
  // 否则高精度模式的拍点效果会退化成「每拍一样重」。
  const modelAccents = {
    v: accents.v,
    impact: cameraIndexes.map((index) => accents.impact[index]),
    low: cameraIndexes.map((index) => accents.low[index]),
    mid: cameraIndexes.map((index) => accents.mid[index]),
    high: cameraIndexes.map((index) => accents.high[index]),
    rhythmic: cameraIndexes.map((index) => accents.rhythmic[index]),
    pulse: cameraIndexes.map((index) => accents.pulse[index]),
    trackScale: accents.trackScale,
  }

  const pulseBeats: PulseBeat[] = cameraBeats.map((event) => ({
    time: event.time,
    strength: event.strength,
    impact: event.impact ?? event.strength,
    combo: event.combo,
    low: event.low,
    body: event.body,
    snap: event.snap,
  }))

  return {
    kicks: [],
    beats: events,
    pulseBeats,
    cameraBeats,
    gridStep: medianInterval(beats),
    tempoSource: 'music-tempo',
    analysisProfile,
    duration: analysis.duration,
    visualBeatCount: cameraBeats.length,
    analyzedAt: Date.now(),
    modelAccents,
  }
}
