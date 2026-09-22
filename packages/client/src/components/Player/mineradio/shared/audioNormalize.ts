/**
 * 上游主循环的音频归一化层（`11-main-loop.js:396-560`）。
 *
 * 为什么需要这一层：上游喂给粒子着色器的 uBass/uMid/uTreble/uEnergy **不是**
 * 原始频段电平，而是经过「动态峰值归一化 → pow 曲线 → env 攻/放平滑 →
 * 最终合成」之后的值。这条链有两个视觉效果：
 *
 *   1. **动态范围压缩**：安静歌曲与响亮歌曲的 uniform 都落在同一个 0..0.9
 *      值域内（峰值跟随器自适应），视觉幅度不随歌曲录音电平漂移；
 *   2. **帧间稳定**：env 的攻/放速率（0.28/0.075 等）把帧级抖动滤掉，
 *      快速滚动的着色器采样（滚筒条纹、唱片唱纹）因此不闪烁。
 *
 * 本项目此前只有 RMS + 一层固定系数 lerp —— 滚筒条纹由 uMid/uTreble 直接
 * 调制幅度，频谱抖动直达几何，这就是"条纹旋转中闪烁"的根因。
 *
 * 所有公式/常量逐字取自上游（变量名对齐便于核对）：
 *   rb = min(1, pow(bKick / max(0.038, bassPeak*0.66), 0.78))
 *   bassPeak = max(bassPeak*0.994, bKick, 0.030)
 *   smoothBass = env(smoothBass, min(0.82, rb*0.78 + re*0.025), 0.28, 0.075)
 *   bass = min(0.90, smoothBass*1.05 + beatPulse*0.18) * fx.intensity
 * env(prev, next, attack, release) = prev + (next-prev) * (next>prev ? attack : release)
 */

export interface NormalizedAudio {
  /** uBass：合成后的低频（0..0.9） */
  bass: number
  /** uMid（0..0.72） */
  mid: number
  /** uTreble（0..0.62） */
  treble: number
  /** uEnergy：上游 `audioEnergy = max(smoothEnergy, beatPulse*0.30)` */
  energy: number
  /** 节拍脉冲（上游 `beatPulse`，指数衰减） */
  beat: number
}

export interface NormalizerState {
  bassPeak: number
  midPeak: number
  treblePeak: number
  energyPeak: number
  smoothBass: number
  smoothMid: number
  smoothTreb: number
  smoothEnergy: number
  prevEnergy: number
  beatPulse: number
}

export function createAudioNormalizerState(): NormalizerState {
  return {
    bassPeak: 0.12,
    midPeak: 0.1,
    treblePeak: 0.08,
    energyPeak: 0.1,
    smoothBass: 0,
    smoothMid: 0,
    smoothTreb: 0,
    smoothEnergy: 0,
    prevEnergy: 0,
    beatPulse: 0,
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function env(prev: number, next: number, attack: number, release: number): number {
  const k = next > prev ? attack : release
  return prev + (next - prev) * k
}

/**
 * 推进一帧归一化。
 *
 * 输入的 rbBasis/energyBasis 等应为引擎产出的原始频段值
 * （见 AudioAnalyser.AudioBands 的 lowDrive/vocal/snap/kickCore/kickSub）。
 */
export function stepAudioNormalize(
  state: NormalizerState,
  input: {
    /** bKick：低频驱动（上游 bKick = kickCore*0.86 + subKick*0.42 + kickBody*0.10，即引擎 lowDrive） */
    lowDrive: number
    /** mInst：中频乐器（2600-6200Hz，引擎 snap） */
    snap: number
    /** tHigh：高频（6200Hz+，引擎 snap 高段；本项目用 snap 近似——见下） */
    tHigh: number
    /** voc：人声（420-2600Hz，引擎 vocal） */
    vocal: number
    /** re：能量（0..1，引擎 frame.energy） */
    energy: number
    /** 是否播放中；暂停走上游 idle 衰减分支 */
    playing: boolean
    /** 帧间隔（秒） */
    dt: number
  },
  /** 上游 `fx.intensity` 出厂 0.85 */
  intensity = 0.85,
  /**
   * 上游 `fx.preset`（0..12）。preset ≥ 4 时上游把最终合成换成
   * "环带再合成"分支（11-main-loop.js:540-565）：交叉相消 + pow 整形 +
   * 分档增益/上限 —— vinyl（preset 4，authored 档）更"冲"（增益
   * 1.58/1.82/2.28，beatPulse×0.72），wallpaper（preset 5）更"平"
   * （增益 1.10/1.16/1.34，cap 0.46/0.40/0.36，beatPulse×0.34）。
   * 本项目已移植预设编号与上游一致（emily 0/tunnel 1/planet 2/vinyl 4/
   * galaxy 5/topography 走独立模块不进这里），直接传 preset 即可。
   */
  preset = 0,
): NormalizedAudio {
  const dt = Math.max(0.001, input.dt || 1 / 60)

  if (input.playing) {
    // ---- 动态峰值跟踪（11-main-loop.js:396-400）----
    state.bassPeak = Math.max(state.bassPeak * 0.994, input.lowDrive, 0.03)
    state.midPeak = Math.max(state.midPeak * 0.993, input.snap, 0.026)
    state.treblePeak = Math.max(state.treblePeak * 0.992, input.tHigh, 0.018)
    state.energyPeak = Math.max(state.energyPeak * 0.995, input.energy, 0.03)

    // ---- pow 归一化（:401-404）----
    const rb = Math.min(1, Math.pow(input.lowDrive / Math.max(0.038, state.bassPeak * 0.66), 0.78))
    const rm = Math.min(1, Math.pow(input.snap / Math.max(0.025, state.midPeak * 0.7), 0.86))
    const rt = Math.min(1, Math.pow(input.tHigh / Math.max(0.02, state.treblePeak * 0.74), 0.92))
    const re = Math.min(1, Math.pow(input.energy / Math.max(0.034, state.energyPeak * 0.68), 0.82))

    const bassOnset = Math.max(0, rb - state.smoothBass)
    const energyOnset = Math.max(0, re - state.prevEnergy)
    state.prevEnergy = state.prevEnergy * 0.88 + re * 0.12

    // ---- beatPulse（:446-455）：实时引擎命中时抬升，随后指数衰减 ----
    // 上游的完整实时节拍引擎依赖 beatmap/置信度打分；本项目等价简化为
    // 「低频突升 + 能量突升」双门槛，衰减率用上游原值 pow(0.36, dt)。
    const rtPulse = clamp01(bassOnset * 2.2 + energyOnset * 0.9)
    if (input.lowDrive > 0.42 && rb > 0.32 && bassOnset > 0.04 && energyOnset > 0.006) {
      state.beatPulse = Math.max(state.beatPulse, rtPulse)
    }
    state.beatPulse *= Math.pow(0.36, dt)

    // ---- env 平滑（:484-487）----
    state.smoothBass = env(state.smoothBass, Math.min(0.82, rb * 0.78 + re * 0.025), 0.28, 0.075)
    state.smoothMid = env(state.smoothMid, Math.min(0.68, rm * 0.64 + re * 0.025), 0.18, 0.06)
    state.smoothTreb = env(state.smoothTreb, Math.min(0.56, rt * 0.54), 0.18, 0.055)
    state.smoothEnergy = env(state.smoothEnergy, Math.min(0.72, re), 0.16, 0.055)
  } else {
    // ---- idle 衰减（:524）----
    const idle = Math.max(1, dt * 60)
    state.smoothBass *= Math.pow(0.91, idle)
    state.smoothMid *= Math.pow(0.91, idle)
    state.smoothTreb *= Math.pow(0.91, idle)
    state.smoothEnergy *= Math.pow(0.91, idle)
    state.beatPulse *= Math.pow(0.82, idle)
  }

  // ---- 最终合成（:536-539）----
  const audioEnergy = Math.max(state.smoothEnergy, state.beatPulse * 0.3)
  let bass = Math.min(0.9, state.smoothBass * 1.05 + state.beatPulse * 0.18) * intensity
  let mid = Math.min(0.72, state.smoothMid * 1.12) * intensity
  let treble = Math.min(0.62, state.smoothTreb * 1.2) * intensity
  let beat = state.beatPulse

  // ---- preset ≥ 4 环带再合成（:540-565）----
  if (preset >= 4) {
    const wallpaperAudio = preset === 5
    // 上游 authoredParticles 分支（preset 9-12）本项目未移植，preset 4
    // 落入 else（"非 wallpaper 的 ≥4"）即 vinyl 的 1.58/1.82/2.28 档。
    const ringBassGain = wallpaperAudio ? 1.1 : 1.58
    const ringMidGain = wallpaperAudio ? 1.16 : 1.82
    const ringTrebleGain = wallpaperAudio ? 1.34 : 2.28
    const ringBeatGain = wallpaperAudio ? 0.18 : 0.42
    const ringBass =
      state.smoothBass * ringBassGain + beat * ringBeatGain - state.smoothMid * 0.16 - state.smoothTreb * 0.06
    const ringMid = state.smoothMid * ringMidGain - state.smoothBass * 0.14 - state.smoothTreb * 0.07
    const ringTreble = state.smoothTreb * ringTrebleGain - state.smoothMid * 0.1 - state.smoothBass * 0.05
    bass = Math.pow(clamp01((ringBass - 0.05) / 0.58), 0.72) * intensity
    mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * intensity
    treble = Math.pow(clamp01((ringTreble - 0.03) / 0.34), 0.84) * intensity
    if (wallpaperAudio) {
      bass = Math.min(bass, 0.46 * intensity)
      mid = Math.min(mid, 0.4 * intensity)
      treble = Math.min(treble, 0.36 * intensity)
      beat *= 0.34
    } else {
      bass = Math.min(bass, 0.72 * intensity)
      mid = Math.min(mid, 0.62 * intensity)
      treble = Math.min(treble, 0.58 * intensity)
      beat *= 0.72
    }
  }

  return { bass, mid, treble, energy: audioEnergy, beat }
}
