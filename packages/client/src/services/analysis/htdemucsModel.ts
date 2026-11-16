import { unpackModelWeights } from './packedWeights'
import { importModelWeights, loadModelWeights, modelBaseUrl } from './modelWeights'
import {
  AnalysisModelUnloadedError,
  AnalysisRequestDroppedError,
  registerAnalysisGpuLostHandler,
  requestAnalysisGpu,
  touchAnalysisGpu,
} from './analysisGpu'
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
const MODEL_SHA256 = '27d5331a74a4e23b18172b3d59d0378e698fd79bc0d0fed3316da77e3a37d8d1'

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
/** 失败时间；冷却结束后允许自动重试。 */
let failedAt = 0
const MODEL_RETRY_MS = 10 * 60_000

registerAnalysisGpuLostHandler(() => {
  manifest = null
  // 权重下载可能仍在飞，保留 loadTask，避免下一次调用重复下载 92 MB。
  failedAt = 0
  setState({ phase: 'idle', progress: 0, detail: undefined })
})
export const loadHtdemucsModel = async (): Promise<void> => {
  if (manifest) return
  if (failedAt > 0 && Date.now() - failedAt < MODEL_RETRY_MS) {
    throw new Error(state.detail ?? 'htdemucs 不可用')
  }
  if (failedAt > 0) {
    failedAt = 0
    setState({ phase: 'idle', progress: 0, detail: undefined })
  }
  if (loadTask) return loadTask
  loadTask = (async () => {
    setState({ phase: 'probing', progress: 0, detail: undefined })
    if (!(await hasBeatThisGpu())) throw new Error('浏览器不支持 WebGPU')
    const file = await loadModelWeights(
      MODEL_FILE,
      MODEL_BYTES,
      (progress) => setState({ phase: 'downloading', progress }),
      MODEL_SHA256,
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
    if (error instanceof AnalysisModelUnloadedError || error instanceof AnalysisRequestDroppedError) {
      setState({ phase: 'idle', progress: 0, detail: undefined })
    } else {
      failedAt = Date.now()
      setState({ phase: 'unavailable', detail: (error as Error)?.message ?? String(error) })
    }
    throw error
  }).finally(() => {
    loadTask = null
  })
  return loadTask
}

/** 下载失败后用户重新开启开关时调用：清掉失败态，允许再试一次。 */
export const resetHtdemucsFailure = (): void => {
  if (failedAt === 0) return
  failedAt = 0
  if (!manifest) setState({ phase: 'idle', progress: 0, detail: undefined })
}

/** 导入浏览器已下载好的权重文件；成功后可用 loadHtdemucsModel 直接加载。 */
export const importHtdemucsModel = async (file: File): Promise<void> => {
  await importModelWeights(MODEL_FILE, MODEL_BYTES, MODEL_SHA256, file)
  resetHtdemucsFailure()
}

export interface StemChannels {
  left: Float32Array
  right: Float32Array
}

/** 一段 3.9 s 立体声的四轨：[鼓, 贝斯, 其他, 人声]。 */
export const separateHtdemucsSegment = async (
  left: Float32Array,
  right: Float32Array,
  options: { slice?: 'auto' | 'none'; priority?: 'foreground' | 'background'; isStale?: () => boolean } = {},
): Promise<StemChannels[]> => {
  const request = (): Promise<{ stems: StemChannels[] }> =>
    requestAnalysisGpu<{ stems: StemChannels[] }>(
      { kind: 'separate', left, right, slice: options.slice ?? 'none' },
      [],
      { priority: options.priority, isStale: options.isStale, timeoutMs: 120_000 },
    )
  if (!manifest) await loadHtdemucsModel()
  try {
    const result = await request()
    return result.stems
  } catch (error) {
    if (!(error instanceof AnalysisModelUnloadedError)) throw error
    // 空闲卸载与新请求撞车：模型层重载后重试一次。
    manifest = null
    failedAt = 0
    await loadHtdemucsModel()
    const result = await request()
    return result.stems
  } finally {
    touchAnalysisGpu()
  }
}

export const isHtdemucsReady = (): boolean => manifest !== null
