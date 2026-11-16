import { unpackModelWeights } from './packedWeights'
import { importModelWeights, loadModelWeights, modelBaseUrl } from './modelWeights'
import {
  AnalysisModelUnloadedError,
  AnalysisRequestDroppedError,
  registerAnalysisGpuLostHandler,
  requestAnalysisGpu,
  touchAnalysisGpu,
} from './analysisGpu'
import type { BeatThisWgslManifest } from './beatThisWgsl/runtime'
import type { PercussiveEnergyFrames } from './beatThisWgsl/percussive'

/**
 * beat_this 的宿主运行时：WebGPU 探测、权重下载与缓存、加载状态。
 *
 * 权重由客户端按镜像直连下载，服务端不保存；首次下载后写入 Cache Storage，
 * 模型空闲 10 分钟随 worker 卸下。
 */

export type BeatThisPhase = 'idle' | 'probing' | 'downloading' | 'ready' | 'unavailable'

export interface BeatThisState {
  phase: BeatThisPhase
  progress: number
  detail?: string
}

const MODEL_FILE = 'beat_this-wgsl.bin'
const MODEL_BYTES = 41_102_271
const MODEL_SHA256 = '6365ae5ba2e42922772da01fbfd0bde8dd20b7362a679018e78a5f251fe8a967'

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
    // 一次临时失败（驱动/进程忙）不能把整个页面锁死；只缓存成功结果。
    void gpuProbe.then((available) => {
      if (!available) gpuProbe = null
    })
  }
  return gpuProbe
}

let manifest: BeatThisWgslManifest | null = null
let loadTask: Promise<void> | null = null
/** 失败时间；冷却结束后允许自动重试，不再把一次网络抖动锁死整个会话。 */
let failedAt = 0
const MODEL_RETRY_MS = 10 * 60_000

registerAnalysisGpuLostHandler(() => {
  manifest = null
  // 不在这里清 loadTask：权重下载可能仍在飞，清掉会让下一次调用重复下整份文件；
  // 该任务自己失败/完成时会 finally 收尾。
  failedAt = 0
  // 设备丢失后下一次加载重新探测 adapter，避免沿用旧的失败结果。
  gpuProbe = null
  setState({ phase: 'idle', progress: 0, detail: undefined })
})

export const loadBeatThisModel = async (): Promise<void> => {
  if (manifest) return
  if (failedAt > 0 && Date.now() - failedAt < MODEL_RETRY_MS) {
    throw new Error(state.detail ?? 'beat_this 不可用')
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
    const packed = unpackModelWeights<BeatThisWgslManifest>(new Uint8Array(file))
    const reply = await requestAnalysisGpu<{ bytes: number }>(
      { kind: 'load', model: 'beat_this', weights: packed.weights, manifest: packed.manifest },
      [packed.weights.buffer],
    )
    manifest = packed.manifest
    setState({ phase: 'ready', progress: 1, detail: `显存 ${(reply.bytes / 1024 / 1024).toFixed(0)} MB` })
    touchAnalysisGpu()
  })().catch((error) => {
    // worker 被卸载/请求作废不是“模型坏了”，不能写失败冷却，否则一次切歌
    // 就会把模型锁 10 分钟。
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
export const resetBeatThisFailure = (): void => {
  if (failedAt === 0) return
  failedAt = 0
  if (!manifest) setState({ phase: 'idle', progress: 0, detail: undefined })
}

/** 导入浏览器已下载好的权重文件；成功后可用 loadBeatThisModel 直接加载。 */
export const importBeatThisModel = async (file: File): Promise<void> => {
  await importModelWeights(MODEL_FILE, MODEL_BYTES, MODEL_SHA256, file)
  resetBeatThisFailure()
}

export interface BeatThisRunResult {
  beat: Float32Array[]
  downbeat: Float32Array[]
  percussive?: PercussiveEnergyFrames
}

export const runBeatThis = async (
  chunks: Float32Array[],
  percussive?: { mel: Float32Array; frames: number },
  isCurrent: () => boolean = () => true,
): Promise<BeatThisRunResult | null> => {
  if (!manifest) await loadBeatThisModel()
  const beat: Float32Array[] = []
  const downbeat: Float32Array[] = []
  const send = async <T>(message: Record<string, unknown>, transfer: Transferable[]): Promise<T> => {
    try {
      return await requestAnalysisGpu<T>(message, transfer, {
        priority: 'foreground',
        isStale: () => !isCurrent(),
      })
    } catch (error) {
      if (!(error instanceof AnalysisModelUnloadedError)) throw error
      // 输入缓冲尚未转移，可以安全重载后重试一次。
      manifest = null
      failedAt = 0
      await loadBeatThisModel()
      return requestAnalysisGpu<T>(message, transfer, {
        priority: 'foreground',
        isStale: () => !isCurrent(),
      })
    }
  }

  try {
    // 每块单独走一次 GPU 队列：切歌后未执行的块由 isStale 丢弃，已算完的块保留。
    for (const chunk of chunks) {
      if (!isCurrent()) return null
      const result = await send<BeatThisRunResult>({ kind: 'run', chunks: [chunk] }, [chunk.buffer])
      beat.push(result.beat[0] ?? new Float32Array(0))
      downbeat.push(result.downbeat[0] ?? new Float32Array(0))
    }
    let energy: PercussiveEnergyFrames | undefined
    if (percussive) {
      if (!isCurrent()) return null
      energy = await send<PercussiveEnergyFrames>(
        { kind: 'percussive', mel: percussive.mel, frames: percussive.frames },
        [percussive.mel.buffer],
      )
    }
    return { beat, downbeat, percussive: energy }
  } catch (error) {
    if (error instanceof AnalysisRequestDroppedError) return null
    throw error
  } finally {
    touchAnalysisGpu()
  }
}

export const isBeatThisReady = (): boolean => manifest !== null
