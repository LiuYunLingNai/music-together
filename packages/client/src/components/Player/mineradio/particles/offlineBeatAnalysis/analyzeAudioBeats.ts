/**
 * 离线拍点分析主干 —— 上游 `03-beat/01-audio-beat-analysis.js` 的
 * `analyzeAudioBeats` 忠实移植（softGroove / DJ / 磁盘缓存分支已剔除，
 * 见目录 `index.ts` 的移植范围说明）。
 *
 * ## 流水线（与上游逐段对应）
 *
 *   ① fetch + decode                        上游 `:12-27`
 *   ② 四频段离线渲染（OfflineAudioContext）  上游 `:34-74`
 *      low 38–155 / body 130–420 / vocal 420–2600 / snap 1800–9000
 *   ③ 10ms 帧能量（RMS）                     上游 `:77-108`
 *   ④ onset = 正向一阶差分                   上游 `:126-140`
 *   ⑤ 自适应阈值峰检测 → candidates          上游 `:428-460`
 *      滑动 0.5s 均值+标准差，`mean + std×2.35 + 0.0045`，最小间隔 120ms
 *   ⑥ candidates → beats（打 tone/mass/…）   上游 `:462-492`
 *   ⑦ 网格锁定（gridStep + ghost 补拍）      上游 `:494-558`
 *   ⑧ music-tempo 相位校正 + 网格化重建      上游 `:560-737`
 *   ⑨ 产出 pulseBeats + 返回拍点图            上游 `:739-766`
 *
 * ## 为什么用 OfflineAudioContext 而不是手写 FIR
 *
 * 上游用 `OfflineAudioContext` + `BiquadFilterNode`（highpass/lowpass，
 * Q 0.85/0.9）做频段分离。这是浏览器原生的二阶 IIR，相位与幅频响应
 * 由规范定义 —— 手写滤波器哪怕系数相同，相位响应也会有差异，
 * 直接影响 onset 的时间位置（拍点会整体偏移几毫秒）。所以这里照搬。
 *
 * ## 红线
 *
 * 不新增 `AnalyserNode`（红线 2）。解码用的临时 `AudioContext` 用完即
 * `close()`，频段渲染用的 `OfflineAudioContext` 是一次性的，与实时
 * 音频链路（`audioTap` 的那个 AnalyserNode）完全隔离。
 */

import type { BeatMap, BeatMapEvent, BeatTone, PulseBeat } from './beatAnalysisTypes'
import { cinemaAnalysisProfileForSong, estimateTempoPhaseOffset, medianGap } from './beatTempoGrid'
import { analyzeMusicTempoInWorker } from './beatTempoWorker'

/** 分析选项 —— 上游 `options`（`prefetch` 已剔除，本项目无预取）。 */
export interface AnalyzeOptions {
  /** 后台分析（当前曲）。影响让路时长，见 `yieldMs`。 */
  background?: boolean
  /** 跳过 music-tempo（上游 `skipMusicTempoWhilePlaying`，出厂 false）。 */
  skipMusicTempo?: boolean
  song?: { name?: string; title?: string; artist?: string } | null
}

/** 上游 `beatAnalysisYieldMs`（`01-scene/02-beat-camera-runtime.js:358-363`），预取项已剔除。 */
function yieldMs(options: AnalyzeOptions, currentMs: number): number {
  if (options.background) return currentMs
  return Math.min(currentMs, 160)
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/** 上游 `yieldToIdle`（`:292-304`）。 */
function yieldToIdle(timeout?: number): Promise<void> {
  return new Promise((resolve) => {
    if (isHidden()) {
      setTimeout(resolve, Math.min(timeout || 80, 80))
      return
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: timeout || 1200 })
    } else {
      setTimeout(resolve, timeout ? Math.min(timeout, 600) : 160)
    }
  })
}

/** 上游 `yieldToPaint`（`:282-290`）。 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (isHidden() || typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
    } else {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    }
  })
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * 分析一首歌，产出拍点图。
 *
 * @param audioUrl 与播放用同一份 URL（上游也是 fetch 同一个 `/api/audio?...`）
 * @param token 切歌代次（上游 `beatMapToken`）
 * @param isCurrent 返回当前代次是否仍等于 `token`；切歌即中止
 */
export async function analyzeAudioBeats(
  audioUrl: string,
  token: number,
  isCurrent: (token: number) => boolean,
  options: AnalyzeOptions = {},
): Promise<BeatMap | null> {
  const analysisProfile = cinemaAnalysisProfileForSong(options.song)
  try {
    await yieldToIdle(yieldMs(options, 140))
    if (!isCurrent(token)) return null

    const resp = await fetch(audioUrl)
    if (!isCurrent(token)) return null
    const ab = await resp.arrayBuffer()
    if (!isCurrent(token)) return null

    // 上游 `:18-26`：解码用独立的 AudioContext（实时那个可能已 closed），
    // 频段渲染用 OfflineAudioContext。
    const OfflineCtx: typeof OfflineAudioContext | undefined =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!OfflineCtx) return null
    const DecodeCtx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!DecodeCtx) return null
    const dc = new DecodeCtx()
    const buffer = await new Promise<AudioBuffer | null>((resolve) => {
      dc.decodeAudioData(
        ab.slice(0),
        (decoded) => resolve(decoded),
        (e) => {
          console.warn('decode failed:', e)
          resolve(null)
        },
      )
    })
    if (dc.close) await dc.close()
    if (!buffer) return null
    if (!isCurrent(token)) return null

    // ★ music-tempo 与频段渲染**并行**跑（上游 `:31` 先起任务，`:560` 才 await）。
    //   Worker 在另一个线程，主线程这边同时做 OfflineAudioContext 渲染。
    const revisionAtStart = token
    const musicTempoTask = options.skipMusicTempo
      ? Promise.resolve(null)
      : analyzeMusicTempoInWorker(buffer, token, revisionAtStart)

    const sr = buffer.sampleRate

    /** 上游 `renderBand`（`:35-61`）。 */
    async function renderBand(hpFreq: number, lpFreq: number): Promise<Float32Array | null> {
      const off = new OfflineCtx!(1, buffer!.length, sr)
      const src = off.createBufferSource()
      src.buffer = buffer
      let node: AudioNode = src
      if (hpFreq) {
        const hp = off.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = Math.min(hpFreq, sr * 0.45)
        hp.Q.value = 0.85
        node.connect(hp)
        node = hp
      }
      if (lpFreq) {
        const lp = off.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = Math.min(lpFreq, sr * 0.45)
        lp.Q.value = 0.9
        node.connect(lp)
        node = lp
      }
      node.connect(off.destination)
      src.start(0)
      const renderedBand = await off.startRendering()
      if (!isCurrent(token)) return null
      await yieldToIdle(yieldMs(options, 110))
      return renderedBand.getChannelData(0)
    }

    const lowPcm = await renderBand(38, 155)
    if (!isCurrent(token) || !lowPcm) return null
    const bodyPcm = await renderBand(130, 420)
    if (!isCurrent(token) || !bodyPcm) return null
    const vocalPcm = await renderBand(420, 2600)
    if (!isCurrent(token) || !vocalPcm) return null
    const snapPcm = await renderBand(1800, 9000)
    if (!isCurrent(token) || !snapPcm) return null

    // ③ 10ms 帧能量 —— 上游 `:77-95`。
    const winSize = Math.floor(sr * 0.01)
    async function makeFrameEnergy(pcm: Float32Array): Promise<Float32Array | null> {
      const frames = Math.floor(pcm.length / winSize)
      const out = new Float32Array(frames)
      for (let f = 0; f < frames; f++) {
        let s = 0
        const off2 = f * winSize
        for (let i = 0; i < winSize; i++) {
          const v = pcm[off2 + i]
          s += v * v
        }
        out[f] = Math.sqrt(s / winSize)
        if (f > 0 && f % 520 === 0) {
          await yieldToPaint()
          if (!isCurrent(token)) return null
        }
      }
      return out
    }

    const energy = await makeFrameEnergy(lowPcm)
    await yieldToIdle(yieldMs(options, 90))
    const bodyEnergy = await makeFrameEnergy(bodyPcm)
    await yieldToIdle(yieldMs(options, 90))
    const vocalEnergy = await makeFrameEnergy(vocalPcm)
    await yieldToIdle(yieldMs(options, 90))
    const snapEnergy = await makeFrameEnergy(snapPcm)
    if (!isCurrent(token) || !energy || !bodyEnergy || !vocalEnergy || !snapEnergy) return null

    const nFrames = Math.min(energy.length, bodyEnergy.length, vocalEnergy.length, snapEnergy.length)

    /** 上游 `percentile`（`:110-113`）：排序后取 `floor(len × p)`。 */
    function percentile(arr: ArrayLike<number>, p: number): number {
      const copy = Array.prototype.slice.call(arr).sort((a: number, b: number) => a - b)
      return copy.length ? copy[Math.floor(copy.length * p)] : 0.001
    }
    /** 上游 `bandAt`（`:114-119`）：三点 [1,2,1]/4 平滑。 */
    function bandAt(arr: Float32Array, f: number): number {
      const a = arr[Math.max(0, f - 1)] || 0
      const b = arr[f] || 0
      const c = arr[Math.min(nFrames - 1, f + 1)] || 0
      return (a + b * 2 + c) * 0.25
    }

    const lowRef = Math.max(0.0008, percentile(energy, 0.86))
    const bodyRef = Math.max(0.0008, percentile(bodyEnergy, 0.86))
    const vocalRef = Math.max(0.0008, percentile(vocalEnergy, 0.86))
    const snapRef = Math.max(0.0008, percentile(snapEnergy, 0.86))

    // ④ onset = 正向一阶差分 —— 上游 `:126-132`。
    function makeOnset(arr: Float32Array): Float32Array {
      const out = new Float32Array(nFrames)
      for (let oi = 1; oi < nFrames; oi++) out[oi] = Math.max(0, arr[oi] - arr[oi - 1])
      return out
    }
    const onset = makeOnset(energy)

    // ⑤ 自适应阈值峰检测 —— 上游 `:428-460`。
    const winN = 50 // 0.5 秒
    const candidates: Array<{
      frame: number
      time: number
      raw: number
      score: number
      lowTone: number
      bodyTone: number
      vocalTone: number
      snapTone: number
    }> = []
    let lastKickFrame = -winN
    const minIntervalFrames = 12 // 120ms，粒子可响应较密集的低频瞬态
    for (let f = winN; f < nFrames - 5; f++) {
      let sum = 0
      let sqSum = 0
      for (let k = f - winN; k < f; k++) {
        sum += onset[k]
        sqSum += onset[k] * onset[k]
      }
      const mean = sum / winN
      const std = Math.sqrt(Math.max(0, sqSum / winN - mean * mean))
      const thresh = mean + std * 2.35 + 0.0045
      if (onset[f] > thresh && onset[f] > onset[f - 1] && onset[f] >= onset[f + 1]) {
        if (f - lastKickFrame >= minIntervalFrames) {
          const localScore = (onset[f] - thresh) / Math.max(0.006, std + mean * 0.35)
          candidates.push({
            frame: f,
            time: f * 0.01,
            raw: onset[f],
            score: localScore,
            lowTone: Math.min(2.0, bandAt(energy, f) / lowRef),
            bodyTone: Math.min(2.0, bandAt(bodyEnergy, f) / bodyRef),
            vocalTone: Math.min(2.0, bandAt(vocalEnergy, f) / vocalRef),
            snapTone: Math.min(2.0, bandAt(snapEnergy, f) / snapRef),
          })
          lastKickFrame = f
        }
      }
      if (f > winN && f % 900 === 0) {
        await yieldToPaint()
        if (!isCurrent(token)) return null
      }
    }

    // ⑥ candidates → beats —— 上游 `:462-492`。
    const scores = candidates.map((b) => b.score).sort((a, b) => a - b)
    const p75 = scores.length ? scores[Math.floor(scores.length * 0.75)] : 1
    const p92 = scores.length ? scores[Math.floor(scores.length * 0.92)] : Math.max(1, p75)
    const strongTimes: number[] = []
    const beats: BeatMapEvent[] = candidates.map((b, i) => {
      const strength = Math.max(0.18, Math.min(1, (b.score - p75 * 0.36) / Math.max(0.001, p92 - p75 * 0.36)))
      const lowDominance = b.lowTone / Math.max(0.001, b.vocalTone * 0.84 + b.bodyTone * 0.36 + b.snapTone * 0.1)
      const toneTotal = Math.max(0.001, b.lowTone + b.bodyTone * 0.72 + b.snapTone * 0.58)
      const lowMix = b.lowTone / toneTotal
      const bodyMix = (b.bodyTone * 0.72) / toneTotal
      const snapMix = (b.snapTone * 0.58) / toneTotal
      // "像鼓" = 低频够强，且低频占比高或低频压过人声
      const drumLike = b.lowTone > 0.38 && (lowMix > 0.42 || lowDominance > 0.72)
      if (strength > 0.55 && drumLike) strongTimes.push(b.time)
      const sharpness = Math.max(0.08, Math.min(1, snapMix * 1.55 + strength * 0.1))
      const mass = Math.max(0.25, Math.min(1, lowMix * 0.72 + bodyMix * 0.36 + strength * 0.2))
      const tone: BeatTone =
        snapMix > 0.34 && b.snapTone > 0.55
          ? 'snap'
          : bodyMix > 0.36 && b.bodyTone > 0.55
            ? 'body'
            : lowMix > 0.55
              ? 'deep'
              : 'mixed'
      return {
        time: b.time,
        strength,
        confidence: Math.max(0.22, Math.min(1, b.score / Math.max(0.001, p92))),
        primary: drumLike && strength >= 0.5,
        camera: drumLike && strength >= 0.42,
        tone,
        low: lowMix,
        body: bodyMix,
        snap: snapMix,
        mass,
        sharpness,
        index: i,
      }
    })

    // ⑦ 网格锁定 —— 上游 `:494-558`。
    const gaps: number[] = []
    for (let gi = 1; gi < strongTimes.length; gi++) {
      const gap = strongTimes[gi] - strongTimes[gi - 1]
      if (gap >= 0.26 && gap <= 0.86) gaps.push(gap)
    }
    gaps.sort((a, b) => a - b)
    let gridStep = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0
    let cameraBeats: BeatMapEvent[] = beats.filter((b) => b.camera)
    if (gridStep > 0) {
      // 落在网格上的拍门槛放低（0.42），离网格的要更强（0.58）
      for (let bi = 0; bi < beats.length; bi++) {
        const prevGap = bi > 0 ? beats[bi].time - beats[bi - 1].time : gridStep
        const nextGap = bi < beats.length - 1 ? beats[bi + 1].time - beats[bi].time : gridStep
        const gridLike =
          Math.abs(prevGap - gridStep) < gridStep * 0.32 || Math.abs(nextGap - gridStep) < gridStep * 0.32
        beats[bi].primary = beats[bi].camera && beats[bi].strength >= (gridLike ? 0.42 : 0.58)
      }
      if (gridStep >= 0.38 && gridStep <= 0.88 && strongTimes.length >= 4) {
        // 从第一个强拍往前推出网格锚点，然后逐格找最近的候选；
        // 找不到就看该处 tone 是否够格，够就补一个 ghost 拍。
        let anchor = strongTimes[0]
        while (anchor - gridStep > 0.2) anchor -= gridStep
        const gridBeats: BeatMapEvent[] = []
        const windowSec = Math.min(0.18, gridStep * 0.3)
        for (let gt = anchor; gt < buffer.duration - 0.05; gt += gridStep) {
          let best: BeatMapEvent | null = null
          let bestDist = windowSec
          for (let ci = 0; ci < beats.length; ci++) {
            const dist = Math.abs(beats[ci].time - gt)
            if (dist < bestDist) {
              best = beats[ci]
              bestDist = dist
            }
          }
          if (best && best.camera) {
            best.primary = true
            best.strength = Math.max(best.strength, 0.54)
            best.confidence = Math.max(best.confidence, 0.58)
            gridBeats.push(best)
          } else {
            const gf = Math.max(0, Math.min(nFrames - 1, Math.round(gt / 0.01)))
            const lowTone = Math.min(2.0, bandAt(energy, gf) / lowRef)
            const bodyTone = Math.min(2.0, bandAt(bodyEnergy, gf) / bodyRef)
            const vocalTone = Math.min(2.0, bandAt(vocalEnergy, gf) / vocalRef)
            const snapTone = Math.min(2.0, bandAt(snapEnergy, gf) / snapRef)
            const lowDominance = lowTone / Math.max(0.001, vocalTone * 0.84 + bodyTone * 0.36 + snapTone * 0.1)
            const toneTotal = Math.max(0.001, lowTone + bodyTone * 0.72 + snapTone * 0.58)
            const lowMix = lowTone / toneTotal
            const bodyMix = (bodyTone * 0.72) / toneTotal
            const snapMix = (snapTone * 0.58) / toneTotal
            if (lowTone <= 0.38 || (lowMix <= 0.42 && lowDominance <= 0.72)) continue
            gridBeats.push({
              time: gt,
              strength: 0.53,
              confidence: 0.6,
              primary: true,
              ghost: true,
              tone: 'grid',
              low: lowMix,
              body: bodyMix,
              snap: snapMix,
              mass: Math.max(0.35, Math.min(0.82, lowMix * 0.72 + bodyMix * 0.36 + 0.16)),
              sharpness: Math.max(0.08, Math.min(0.65, snapMix * 1.25)),
              index: gridBeats.length,
            })
          }
        }
        cameraBeats = gridBeats
      }
    }

    // ⑧ music-tempo 相位校正 + 网格化重建 —— 上游 `:560-737`。
    const musicTempoResult = await musicTempoTask
    if (!isCurrent(token)) return null
    let musicTempoBeats: number[] = []
    let musicTempoGridStep = 0
    if (musicTempoResult && musicTempoResult.beats && musicTempoResult.beats.length) {
      // `analyzeMusicTempoInWorker` 内已做 `normalizeMusicTempoBeats`。
      musicTempoBeats = musicTempoResult.beats
      musicTempoGridStep = medianGap(musicTempoBeats, 0.36, 1.0)
    }

    if (musicTempoBeats.length >= 4) {
      const phaseOffset = estimateTempoPhaseOffset(musicTempoBeats, beats, musicTempoGridStep || gridStep, buffer.duration)
      if (phaseOffset) {
        musicTempoBeats = musicTempoBeats
          .map((t) => t + phaseOffset)
          .filter((t) => Number.isFinite(t) && t >= 0.05 && t < buffer.duration - 0.05)
      }
      // ★ 上游此处还有 `analysisProfile.phaseScan` 的 softGroove 二次相位扫描
      //   （`estimateSoftGrooveTempoOffset`）—— 仅《日落大道》触发，未移植。

      const tempoWindow = Math.min(0.16, Math.max(0.095, (musicTempoGridStep || 0.6) * 0.24))
      const tempoMetrics: Array<{
        time: number
        nearest: BeatMapEvent | null
        lowTone: number
        bodyTone: number
        snapTone: number
        lowRise: number
        bodyRise: number
        snapRise: number
        lowMix: number
        bodyMix: number
        snapMix: number
        power: number
        index: number
      }> = []
      const bodyOnset = makeOnset(bodyEnergy)
      const snapOnset = makeOnset(snapEnergy)
      const lowOnsetRef = Math.max(0.00025, percentile(onset, 0.88))
      const bodyOnsetRef = Math.max(0.00025, percentile(bodyOnset, 0.88))
      const snapOnsetRef = Math.max(0.00025, percentile(snapOnset, 0.88))

      for (let ti = 0; ti < musicTempoBeats.length; ti++) {
        // ★ 上游 `refineSoftGrooveBeatTime` 在 default 剖面下直接返回原时间
        //   （`:410` 的 `if (!softGrooveAnalysis || !analysisProfile.localRefine)`），
        //   因此这里就是网格时间本身。
        const metricTime = musicTempoBeats[ti]
        let nearest: BeatMapEvent | null = null
        let nearestDist = tempoWindow
        for (let nb = 0; nb < beats.length; nb++) {
          const nd = Math.abs(beats[nb].time - metricTime)
          if (nd < nearestDist) {
            nearest = beats[nb]
            nearestDist = nd
          }
        }
        const mf = Math.max(0, Math.min(nFrames - 1, Math.round(metricTime / 0.01)))
        const mtLowTone = Math.min(2.0, bandAt(energy, mf) / lowRef)
        const mtBodyTone = Math.min(2.0, bandAt(bodyEnergy, mf) / bodyRef)
        const mtVocalTone = Math.min(2.0, bandAt(vocalEnergy, mf) / vocalRef)
        const mtSnapTone = Math.min(2.0, bandAt(snapEnergy, mf) / snapRef)
        const mtLowRise = Math.min(2.5, (onset[mf] || 0) / lowOnsetRef)
        const mtBodyRise = Math.min(2.5, (bodyOnset[mf] || 0) / bodyOnsetRef)
        const mtSnapRise = Math.min(2.5, (snapOnset[mf] || 0) / snapOnsetRef)
        const mtLowDominance = mtLowTone / Math.max(0.001, mtVocalTone * 0.84 + mtBodyTone * 0.36 + mtSnapTone * 0.1)
        const mtToneTotal = Math.max(0.001, mtLowTone + mtBodyTone * 0.72 + mtSnapTone * 0.58)
        tempoMetrics.push({
          time: metricTime,
          nearest,
          lowTone: mtLowTone,
          bodyTone: mtBodyTone,
          snapTone: mtSnapTone,
          lowRise: mtLowRise,
          bodyRise: mtBodyRise,
          snapRise: mtSnapRise,
          lowMix: mtLowTone / mtToneTotal,
          bodyMix: (mtBodyTone * 0.72) / mtToneTotal,
          snapMix: (mtSnapTone * 0.58) / mtToneTotal,
          power:
            mtLowTone * 0.44 +
            mtBodyTone * 0.16 +
            mtSnapTone * 0.08 +
            Math.min(1.8, mtLowDominance) * 0.16 +
            (nearest ? nearest.strength * 0.46 : 0),
          index: ti,
        })
      }

      // 各项的分位数作为相对标尺 —— 上游 `:637-660`。
      const pick = (f: (m: (typeof tempoMetrics)[number]) => number) => tempoMetrics.map(f)
      const powerFloor = Math.max(0.001, percentile(pick((m) => m.power), 0.25))
      const powerCeil = Math.max(powerFloor + 0.001, percentile(pick((m) => m.power), 0.9))
      const lowFloor = Math.max(0.001, percentile(pick((m) => m.lowTone), 0.25))
      const lowCeil = Math.max(lowFloor + 0.001, percentile(pick((m) => m.lowTone), 0.88))
      const bodyFloor = Math.max(0.001, percentile(pick((m) => m.bodyTone), 0.25))
      const bodyCeil = Math.max(bodyFloor + 0.001, percentile(pick((m) => m.bodyTone), 0.9))
      const snapFloor = Math.max(0.001, percentile(pick((m) => m.snapTone), 0.25))
      const snapCeil = Math.max(snapFloor + 0.001, percentile(pick((m) => m.snapTone), 0.9))
      const lowRiseFloor = Math.max(0.001, percentile(pick((m) => m.lowRise || 0), 0.25))
      const lowRiseCeil = Math.max(lowRiseFloor + 0.001, percentile(pick((m) => m.lowRise || 0), 0.9))
      const bodyRiseFloor = Math.max(0.001, percentile(pick((m) => m.bodyRise || 0), 0.25))
      const bodyRiseCeil = Math.max(bodyRiseFloor + 0.001, percentile(pick((m) => m.bodyRise || 0), 0.9))

      const tempoCameraBeats: BeatMapEvent[] = []
      for (let tm = 0; tm < tempoMetrics.length; tm++) {
        const m = tempoMetrics[tm]
        // ★ 四循环：`index % 4` ⇒ downbeat / push / drop / rebound。
        //   这是"炸歌与抒情歌形态不同"的核心来源 —— 没有 music-tempo
        //   网格就没有稳定的拍序，也就没有这个四循环。
        const mtSlot = m.index % 4
        const powerRel = clamp01((m.power - powerFloor) / (powerCeil - powerFloor))
        const lowRel = clamp01((m.lowTone - lowFloor) / (lowCeil - lowFloor))
        const bodyRel = clamp01((m.bodyTone - bodyFloor) / (bodyCeil - bodyFloor))
        const snapRel = clamp01((m.snapTone - snapFloor) / (snapCeil - snapFloor))
        const lowRiseRel = clamp01(((m.lowRise || 0) - lowRiseFloor) / (lowRiseCeil - lowRiseFloor))
        const bodyRiseRel = clamp01(((m.bodyRise || 0) - bodyRiseFloor) / (bodyRiseCeil - bodyRiseFloor))

        let mtImpact = clamp01(powerRel * 0.5 + lowRel * 0.24 + bodyRel * 0.18 + snapRel * 0.08)
        if (m.nearest) mtImpact = Math.max(mtImpact, Math.min(1, m.nearest.strength * 0.58 + (m.nearest.primary ? 0.08 : 0)))

        const activeCamera = mtImpact >= 0.2 || (mtSlot === 0 && mtImpact >= 0.15 && (lowRel > 0.2 || bodyRel > 0.26))
        const activePulse = mtImpact >= 0.24 || (mtSlot === 0 && mtImpact >= 0.18)
        const grooveEvidence = lowRiseRel * 0.52 + bodyRiseRel * 0.48 + lowRel * 0.2 + bodyRel * 0.18

        const downbeatLift = activeCamera ? (mtSlot === 0 ? 0.14 : mtSlot === 2 ? 0.06 : 0) : 0
        let mtStrength = 0.26 + powerRel * 0.23 + lowRel * 0.1 + bodyRel * 0.08 + snapRel * 0.04 + downbeatLift
        if (m.nearest) mtStrength = Math.max(mtStrength, 0.42 + m.nearest.strength * 0.28)
        if (mtSlot === 0 && activeCamera) mtStrength = Math.max(mtStrength, 0.54 + mtImpact * 0.16)
        if (!activeCamera) mtStrength = Math.min(mtStrength, 0.36)
        mtStrength = Math.max(0.3, Math.min(0.82, mtStrength))

        const lowForCamera = Math.max(0.22, Math.min(0.78, m.lowMix * 0.82 + lowRel * 0.18))
        tempoCameraBeats.push({
          time: m.time,
          strength: mtStrength,
          confidence: m.nearest ? Math.max(0.6, m.nearest.confidence || 0) : Math.max(0.52, 0.48 + powerRel * 0.28),
          primary: activeCamera,
          camera: activeCamera,
          pulse: activePulse,
          impact: mtImpact,
          tone: 'music-tempo',
          grooveEvidence,
          low: lowForCamera,
          body: m.bodyMix,
          snap: m.snapMix,
          mass: Math.max(0.35, Math.min(0.86, lowForCamera * 0.68 + m.bodyMix * 0.24 + mtStrength * 0.16)),
          sharpness: Math.max(0.08, Math.min(0.65, m.snapMix * 1.18)),
          combo: mtSlot === 0 ? 'downbeat' : mtSlot === 1 ? 'push' : mtSlot === 2 ? 'drop' : 'rebound',
          index: m.index,
        })
      }
      if (tempoCameraBeats.length >= 4) {
        // ★ 上游此处有 `analysisProfile.sparseCamera` 的抽稀
        //   （`thinSoftGrooveCameraBeats`）—— 仅《日落大道》触发，未移植。
        cameraBeats = tempoCameraBeats
        gridStep = musicTempoGridStep || gridStep
      }
    }

    // ⑨ 产出 pulseBeats —— 上游 `:739-761`。
    const kicks = beats.map((b) => b.time)
    let visualBeatCount = 0
    const pulseBeats: PulseBeat[] = cameraBeats
      .filter((b) => {
        const active = b.primary !== false && b.camera !== false && b.pulse !== false
        if (active) visualBeatCount++
        return active && (b.strength >= 0.38 || (b.impact || 0) >= 0.2)
      })
      .map((b) => ({
        time: b.time,
        strength: b.strength,
        impact: b.impact == null ? b.strength : b.impact,
        combo: b.combo,
        low: b.low,
        body: b.body,
        snap: b.snap,
      }))

    await yieldToPaint()
    if (!isCurrent(token)) return null

    return {
      kicks,
      beats,
      pulseBeats,
      cameraBeats,
      gridStep,
      tempoSource: musicTempoBeats.length >= 4 ? 'music-tempo' : 'local',
      analysisProfile: analysisProfile.id || 'default',
      duration: buffer.duration,
      visualBeatCount,
      analyzedAt: Date.now(),
    }
  } catch (e) {
    console.warn('beat analysis failed:', e)
    return null
  }
}
