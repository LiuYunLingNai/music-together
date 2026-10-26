/**
 * music-tempo 的 Worker 体 —— 上游
 * `03-beat/00-tempo-worker-cache-prefetch.js:105-125` 的 `getMusicTempoWorkerUrl`
 * 里那段字符串的等价物。
 *
 * 上游是拼字符串 + `importScripts`；这里是真模块 Worker，直接 `import`。
 * 参数逐字照抄上游，见 `beatTempoWorker.ts` 的说明。
 */

/// <reference lib="webworker" />

import MusicTempo from 'music-tempo'

export interface TempoWorkerRequest {
  mono: Float32Array
  sampleRate: number
}

export interface TempoWorkerResponse {
  ok: boolean
  tempo?: number
  beats?: number[]
  error?: string
}

self.onmessage = (ev: MessageEvent<TempoWorkerRequest>) => {
  const d = ev.data || ({} as TempoWorkerRequest)
  try {
    const { mono, sampleRate } = d
    if (!mono || !sampleRate) throw new Error('missing mono/sampleRate')
    const mt = new MusicTempo(mono, {
      bufferSize: 2048,
      hopSize: Math.max(128, Math.round(sampleRate * 0.01)),
      timeStep: 0.01,
      minBeatInterval: 0.36,
      maxBeatInterval: 0.95,
      expiryTime: 8,
    })
    const response: TempoWorkerResponse = { ok: true, tempo: Number(mt.tempo), beats: mt.beats || [] }
    ;(self as unknown as Worker).postMessage(response)
  } catch (err) {
    const response: TempoWorkerResponse = {
      ok: false,
      error: (err instanceof Error && err.message) || String(err),
    }
    ;(self as unknown as Worker).postMessage(response)
  }
}
