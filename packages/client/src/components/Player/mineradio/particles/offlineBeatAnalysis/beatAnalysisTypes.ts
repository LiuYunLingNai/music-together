/**
 * 拍点图的数据结构 —— 上游 `03-beat/01-audio-beat-analysis.js` 的返回值
 * 与 `03-beat/04-beat-map-runtime.js` 的消费侧契约。
 *
 * 上游 `analyzeAudioBeats` 返回：
 *
 *   { kicks, beats, pulseBeats, cameraBeats, gridStep, tempoSource,
 *     analysisProfile, duration, visualBeatCount, analyzedAt }
 *
 * 其中只有 `cameraBeats` / `pulseBeats` / `gridStep` / `tempoSource` /
 * `duration` 被 `beatCamera` 侧真正消费：
 *
 *   · `tickBeatMap()` 读 `cameraBeats` 与 `pulseBeats` 两条光标
 *   · `gridTimingLocked = tempoSource === 'music-tempo' && length >= 4`
 *   · `applyCinemaProfileFromBeatMap` 读 `cameraBeats` + `duration`
 *
 * `kicks`（全部 onset 时间，无结构）与 `beats`（本地候选，含 ghost 标记）
 * 在上游只有 `beats` 被中间步骤读，`kicks` 仅作返回值字段、无人消费 ——
 * 这里仍然保留，因为 `beats` 是 `cameraBeats` 的来源（`cameraBeats` 由
 * `beats.filter(b => b.camera)` 或网格化后的 `gridBeats` 得到）。
 */

/** 上游 beat 事件的 `combo` 四循环（`beatCam` 侧已定义同名类型）。 */
export type BeatCombo = 'downbeat' | 'push' | 'drop' | 'rebound'

/** 上游 beat 事件的 `tone` 标记。 */
export type BeatTone = 'snap' | 'body' | 'deep' | 'mixed' | 'grid' | 'music-tempo'

/**
 * 一个拍点事件 —— 上游 `cameraBeats[i]` 的形状。
 *
 * `pulse` 只在本地 onset 分支与 tempo 分支都出现（上游 tempo 分支产出
 * `pulse: activePulse`，本地分支不设该字段 ⇒ `undefined` ⇒ 视为 true）。
 * `tickBeatMap` 对 `pulseBeats` 用的是 `.filter()` 之后的副本，那份只保留
 * `time / strength / impact / combo / low / body / snap`（见 `toPulseBeat`）。
 */
export interface BeatMapEvent {
  time: number
  strength: number
  confidence: number
  /** 是否进相机运镜（`beatCam` 光标）。上游 `camera: drumLike && strength >= 0.42`。 */
  camera?: boolean
  /** 是否进冲击脉冲（`pulseBeats` 光标）。上游 tempo 分支显式产出。 */
  pulse?: boolean
  /** 主拍。上游本地分支 `primary: drumLike && strength >= 0.50`，网格化后置 true。 */
  primary?: boolean
  impact?: number
  tone?: BeatTone
  low?: number
  body?: number
  snap?: number
  mass?: number
  sharpness?: number
  combo?: BeatCombo
  /** 网格锁定补出来的拍（该处无 onset，只有 tone 够格）。上游 `ghost: true`。 */
  ghost?: boolean
  /** groove 证据，softGroove 剖面专用；default 剖面下不产出。 */
  grooveEvidence?: number
  index?: number
}

/** `pulseBeats` 的元素 —— 上游 `:753-761` 的瘦身副本。 */
export interface PulseBeat {
  time: number
  strength: number
  impact: number
  combo?: BeatCombo
  low?: number
  body?: number
  snap?: number
}

/** 上游 `analyzeAudioBeats` 的返回值。 */
export interface BeatMap {
  /** 全部 onset 时间（上游保留但无人消费的字段）。 */
  kicks: number[]
  /** 本地 onset 候选（`cameraBeats` 的来源）。 */
  beats: BeatMapEvent[]
  /** 瘦身后的冲击脉冲序列。 */
  pulseBeats: PulseBeat[]
  /** 运镜拍点序列。 */
  cameraBeats: BeatMapEvent[]
  /** 主拍间隔的中位数（秒）。0 = 未锁定。 */
  gridStep: number
  /** `'music-tempo'` = 拍点图来自 tempo 库网格化；`'local'` = 只用本地 onset。 */
  tempoSource: 'music-tempo' | 'local'
  /** 剖面 id（`cinemaAnalysisProfileForSong` 的 `id`）。 */
  analysisProfile: string
  /** 音频总时长（秒）。 */
  duration: number
  /** 视觉主拍数（上游 toast 显示用）。 */
  visualBeatCount: number
  analyzedAt: number
}

/**
 * 上游 `cinemaAnalysisProfileForSong()`
 * （`01-scene/02-beat-camera-runtime.js:115-130`）的返回值。
 *
 * `id` 也进 `BeatMap.analysisProfile`。
 */
export interface CinemaAnalysisProfile {
  id: string
  softGroove: boolean
  phaseScan: boolean
  localRefine: boolean
  sparseCamera: boolean
  introPattern: boolean
}

/** 上游 default 剖面（除《日落大道》外的全部歌曲）。 */
export const DEFAULT_ANALYSIS_PROFILE: CinemaAnalysisProfile = {
  id: 'default',
  softGroove: false,
  phaseScan: false,
  localRefine: false,
  sparseCamera: false,
  introPattern: false,
}
