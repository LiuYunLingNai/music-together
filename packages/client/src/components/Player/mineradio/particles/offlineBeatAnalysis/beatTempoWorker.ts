/**
 * music-tempo 的 Web Worker 桥 —— 上游
 * `03-beat/00-tempo-worker-cache-prefetch.js:93-181` 的移植。
 *
 * ## 上游的做法
 *
 * 上游把 Worker 源码**拼成字符串**，`URL.createObjectURL(new Blob([...]))`
 * 造一个 blob URL，Worker 里 `importScripts('/vendor/music-tempo.min.js')`。
 * 这是 vanilla 时代的做法，好处是不需要构建系统配合。
 *
 * ## 本项目的做法
 *
 * 用 Vite 的 `?worker` 后缀直接引一个真正的模块 Worker，
 * Worker 内 `import MusicTempo from 'music-tempo'`。
 *
 * 差异与取舍：
 *   · **分析参数逐字照抄上游**（`bufferSize: 2048`、
 *     `hopSize: max(128, round(sr × 0.010))`、`timeStep: 0.010`、
 *     `minBeatInterval: 0.36`、`maxBeatInterval: 0.95`、`expiryTime: 8`）
 *     —— 这些数值决定 BPM 估计的搜索范围与平滑程度，是结果的主要来源。
 *   · **mono 下混分块让路**照抄（`monoChunk = max(4096, sr × 0.70)`，
 *     奇数块 `yieldToIdle`）—— 长歌（5 分钟 @ 44.1kHz ≈ 1300 万样本）
 *     不分块让路会卡住主线程近 200ms。
 *   · **16 秒超时**照抄（上游 `setTimeout(…, 16000)` 后 `terminate()`）。
 *   · 传输用 transferable（`[mono.buffer]`）而不是 structured clone 拷贝
 *     —— 上游即如此，且避免 52MB 的拷贝。
 *
 * 失败一律 resolve(null)：上游的所有失败分支都是 `resolve(null)` +
 * `console.warn`，分析降级为"只用本地 onset"（`tempoSource: 'local'`），
 * 不抛到调用方。
 */

import { getAudioTapRevision } from '@/lib/audioTap'
import { normalizeMusicTempoBeats } from './beatTempoGrid'

/** music-tempo 在 Worker 里的产出。 */
export interface MusicTempoResult {
  tempo: string
  /** 已归一化（抽稀 + 去首尾）的拍点时间。 */
  beats: number[]
}

/** 上游 `beatAnalysisYieldMs` 的当前曲（非预取）取值。 */
function yieldToIdle(timeout?: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: timeout ?? 1200 })
    } else {
      setTimeout(resolve, timeout ? Math.min(timeout, 600) : 160)
    }
  })
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * 把多声道 buffer 下混成 mono —— 上游 `:129-145`。
 *
 * 分块做，奇数块之间让路。上游的让路间隔是
 * `isHidden ? 10 : 60` ms。
 */
async function downmixToMono(buffer: AudioBuffer): Promise<Float32Array> {
  const channels = buffer.numberOfChannels
  const len = buffer.length
  const mono = new Float32Array(len)
  const chDataList: Float32Array[] = []
  for (let ch = 0; ch < channels; ch++) chDataList.push(buffer.getChannelData(ch))
  const chScale = 1 / Math.max(1, channels)
  const monoChunk = Math.max(4096, Math.floor(buffer.sampleRate * 0.7))
  for (let monoStart = 0; monoStart < len; monoStart += monoChunk) {
    const monoEnd = Math.min(len, monoStart + monoChunk)
    for (let mi = monoStart; mi < monoEnd; mi++) {
      let sum = 0
      for (let ci = 0; ci < channels; ci++) sum += chDataList[ci][mi] * chScale
      mono[mi] = sum
    }
    if (monoStart / monoChunk % 2 === 1) {
      await yieldToIdle(isHidden() ? 10 : 60)
    }
  }
  return mono
}

/**
 * 在 Worker 里跑 music-tempo —— 上游 `analyzeMusicTempoInWorker`（`:129-181`）。
 *
 * @param buffer 已解码的整首歌
 * @param token 切歌代次；不等了（切歌）时返回 null
 * @param revision 当前 `getAudioTapRevision()`，与 token 同源判据
 */
export async function analyzeMusicTempoInWorker(
  buffer: AudioBuffer,
  token: number,
  revision: number,
): Promise<MusicTempoResult | null> {
  if (typeof Worker === 'undefined') return null
  try {
    const mono = await downmixToMono(buffer)
    if (token !== revision) return null
    const result = await runTempoWorker(mono, buffer.sampleRate)
    if (!result || !result.ok) return null
    return {
      tempo: String(result.tempo ?? ''),
      beats: normalizeMusicTempoBeats(result.beats ?? [], buffer.duration),
    }
  } catch (err) {
    console.warn('music-tempo worker setup failed:', err)
    return null
  }
}

interface TempoWorkerResponse {
  ok: boolean
  tempo?: number
  beats?: number[]
  error?: string
}

/** 上游 `getMusicTempoWorkerUrl` + Promise 包装（`:103-181`）。 */
async function runTempoWorker(mono: Float32Array, sampleRate: number): Promise<TempoWorkerResponse | null> {
  // Vite 的 `?worker` 在构建期生成真正的模块 Worker chunk。
  // 本项目 eslint 未装 `import/no-unresolved`，故不加 disable 注释。
  const workerModule = await import(/* @vite-ignore */ './tempoWorker?worker')
  const worker: Worker = new workerModule.default()
  return new Promise<TempoWorkerResponse | null>((resolve) => {
    let done = false
    // ★ 上游 16000ms 超时后 `terminate()` 并 resolve(null)。
    const timer = setTimeout(() => {
      if (done) return
      done = true
      worker.terminate()
      resolve(null)
    }, 16000)
    const finish = (value: TempoWorkerResponse | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker.terminate()
      resolve(value)
    }
    worker.onmessage = (ev: MessageEvent<TempoWorkerResponse>) => {
      const data = ev.data || {}
      if (!data.ok) {
        console.warn('music-tempo worker failed:', data.error)
        finish(null)
        return
      }
      finish(data)
    }
    worker.onerror = (err) => {
      console.warn('music-tempo worker error:', err && err.message ? err.message : err)
      finish(null)
    }
    // transferable：避免 52MB 级别的 structured clone 拷贝（上游同样 transfer）。
    worker.postMessage({ mono, sampleRate }, [mono.buffer])
  })
}

export { getAudioTapRevision }
