import { unpackModelWeights } from './packedWeights'
import { loadModelWeights, modelBaseUrl } from './modelWeights'
import { registerAnalysisGpuLostHandler, requestAnalysisGpu, touchAnalysisGpu } from './analysisGpu'
import { hasBeatThisGpu } from './beatThisModel'
import type { HtdemucsWgslManifest } from './htdemucsWgsl/runtime'

/**
 * htdemucs 的宿主运行时：鼓 / 人声分轨。与 beat_this 共用 worker 与 GPU device。
 *
 * 权重 92 MB，首次开启时下载并缓存；分辨率 / 精度与上游一致（f32、3.9 s 段）。
 */

export type HtdemucsPhase = 'idle' | 'probing' | 'downloading' | 'ready' | 'unavailable'

export interface HtdemucsState {
  phase: HtdemucsPhase
  progress: number
  detail?: string
}

const MODEL_FILE = 'htdemucs-wgsl.bin'
const MODEL_BYTES = 91_838_176

export const htdemucsWeightsUrl = (): string => modelBaseUrl(MODEL_FILE)

let state: HtdemucsState = { phase: 'idle', progress: 0 }
const listeners = new Set<() => void>()

const setState = (next: Partial<HtdemucsState>): void => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const getHtdemucsState = (): HtdemucsState => state

export const subscribeHtdemucsState = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let manifest: HtdemucsWgslManifest | null = null
let loadTask: Promise<void> | null = null
let failed = false

registerAnalysisGpuLostHandler(() => {
  manifest = null
  loadTask = null
  failed = false
  setState({ phase: 'idle', progress: 0, detail: undefined })
})

export const loadHtdemucsModel = async (): Promise<void> => {
  if (manifest) return
  if (failed) throw new Error(state.detail ?? 'htdemucs 不可用')
  if (loadTask) return loadTask
  loadTask = (async () => {
    setState({ phase: 'probing', progress: 0, detail: undefined })
    if (!(await hasBeatThisGpu())) throw new Error('浏览器不支持 WebGPU')
    const file = await loadModelWeights(MODEL_FILE, MODEL_BYTES, (progress) =>
      setState({ phase: 'downloading', progress }),
    )
    const packed = unpackModelWeights<HtdemucsWgslManifest>(new Uint8Array(file))
    const reply = await requestAnalysisGpu<{ bytes: number }>(
      { kind: 'load', model: 'htdemucs', weights: packed.weights, manifest: packed.manifest },
      [packed.weights.buffer],
    )
    manifest = packed.manifest
    setState({ phase: 'ready', progress: 1, detail: `显存 ${(reply.bytes / 1024 / 1024).toFixed(0)} MB` })
    touchAnalysisGpu()
  })().catch((error) => {
    failed = true
    setState({ phase: 'unavailable', detail: (error as Error)?.message ?? String(error) })
    throw error
  }).finally(() => {
    loadTask = null
  })
  return loadTask
}

export interface StemChannels {
  left: Float32Array
  right: Float32Array
}

/** 一段 3.9 s 立体声的鼓（`stems[0]`）与人声（`stems[1]`）。 */
export const separateHtdemucsSegment = async (
  left: Float32Array,
  right: Float32Array,
): Promise<StemChannels[]> => {
  if (!manifest) await loadHtdemucsModel()
  try {
    const result = await requestAnalysisGpu<{ stems: StemChannels[] }>({ kind: 'separate', left, right })
    return result.stems
  } finally {
    touchAnalysisGpu()
  }
}

export const isHtdemucsReady = (): boolean => manifest !== null
