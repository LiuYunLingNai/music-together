import { unpackModelWeights } from './packedWeights'
import { loadModelWeights, modelBaseUrl } from './modelWeights'
import { registerAnalysisGpuLostHandler, requestAnalysisGpu, touchAnalysisGpu } from './analysisGpu'
import type { BeatThisWgslManifest } from './beatThisWgsl/runtime'
import type { PercussiveEnergyFrames } from './beatThisWgsl/percussive'

/**
 * beat_this 的宿主运行时：WebGPU 探测、权重下载与缓存、加载状态。
 *
 * 权重走服务端静态托管（默认 `${SERVER_URL}/models`，可用 `VITE_MODEL_BASE_URL`
 * 指向 CDN）。首次下载后写入 Cache Storage；模型两分钟未用即随 worker 卸下。
 */

export type BeatThisPhase = 'idle' | 'probing' | 'downloading' | 'ready' | 'unavailable'

export interface BeatThisState {
  phase: BeatThisPhase
  progress: number
  detail?: string
}

const MODEL_FILE = 'beat_this-wgsl.bin'
const MODEL_BYTES = 41_102_271

export const beatThisWeightsUrl = (): string => modelBaseUrl(MODEL_FILE)

let state: BeatThisState = { phase: 'idle', progress: 0 }
const listeners = new Set<() => void>()

const setState = (next: Partial<BeatThisState>): void => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const getBeatThisState = (): BeatThisState => state

export const subscribeBeatThisState = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `navigator.gpu` 存在且能拿到 adapter 才算可用；结果在本页生命周期内缓存。 */
let gpuProbe: Promise<boolean> | null = null
export const hasBeatThisGpu = (): Promise<boolean> => {
  if (!gpuProbe) {
    gpuProbe = (async () => {
      try {
        if (!navigator.gpu) return false
        return Boolean(await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }))
      } catch {
        return false
      }
    })()
  }
  return gpuProbe
}

let manifest: BeatThisWgslManifest | null = null
let loadTask: Promise<void> | null = null
let failed = false

registerAnalysisGpuLostHandler(() => {
  manifest = null
  loadTask = null
  failed = false
  setState({ phase: 'idle', progress: 0, detail: undefined })
})

export const loadBeatThisModel = async (): Promise<void> => {
  if (manifest) return
  if (failed) throw new Error(state.detail ?? 'beat_this 不可用')
  if (loadTask) return loadTask
  loadTask = (async () => {
    setState({ phase: 'probing', progress: 0, detail: undefined })
    if (!(await hasBeatThisGpu())) throw new Error('浏览器不支持 WebGPU')
    const file = await loadModelWeights(MODEL_FILE, MODEL_BYTES, (progress) =>
      setState({ phase: 'downloading', progress }),
    )
    const packed = unpackModelWeights<BeatThisWgslManifest>(new Uint8Array(file))
    const reply = await requestAnalysisGpu<{ bytes: number }>(
      { kind: 'load', model: 'beat_this', weights: packed.weights, manifest: packed.manifest },
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

export interface BeatThisRunResult {
  beat: Float32Array[]
  downbeat: Float32Array[]
  percussive?: PercussiveEnergyFrames
}

export const runBeatThis = async (
  chunks: Float32Array[],
  percussive?: { mel: Float32Array; frames: number },
): Promise<BeatThisRunResult> => {
  if (!manifest) await loadBeatThisModel()
  const transfer: Transferable[] = chunks.map((chunk) => chunk.buffer)
  if (percussive) transfer.push(percussive.mel.buffer)
  try {
    return await requestAnalysisGpu<BeatThisRunResult>({ kind: 'run', chunks, percussive }, transfer)
  } finally {
    touchAnalysisGpu()
  }
}

export const isBeatThisReady = (): boolean => manifest !== null
