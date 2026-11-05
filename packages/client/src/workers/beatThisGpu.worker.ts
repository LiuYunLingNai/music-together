/// <reference types="@webgpu/types" />
import { BeatThisWgsl, type BeatThisWgslManifest } from '../services/analysis/beatThisWgsl/runtime'
import { runPercussiveEnergy, type PercussiveEnergyFrames } from '../services/analysis/beatThisWgsl/percussive'
import { HtdemucsWgsl, type HtdemucsWgslManifest } from '../services/analysis/htdemucsWgsl/runtime'

/**
 * 分析模型的 WebGPU worker（上游 `workers/beatThisGpu.worker.ts` 的宿主版）：
 * beat_this 与 htdemucs 共用同一个 device，模型按需加载、空闲卸载。
 *
 * htdemucs 只要求鼓（0）与人声（3）两个源；网络本身总是整跑，sources 只影响
 * iSTFT 与回读，单源结果与四源一致。上游为精度选 f32，这里保持一致。
 */

type Request =
  | { id: number; kind: 'load'; model: 'beat_this'; weights: Uint8Array<ArrayBuffer>; manifest: BeatThisWgslManifest }
  | { id: number; kind: 'load'; model: 'htdemucs'; weights: Uint8Array<ArrayBuffer>; manifest: HtdemucsWgslManifest }
  | { id: number; kind: 'run'; chunks: Float32Array<ArrayBuffer>[]; percussive?: { mel: Float32Array<ArrayBuffer>; frames: number } }
  | { id: number; kind: 'separate'; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }
  | { id: number; kind: 'percussive'; mel: Float32Array<ArrayBuffer>; frames: number }
  | { id: number; kind: 'unload'; model: 'beat_this' | 'htdemucs' }
  | { id: number; kind: 'dispose' }

let beatThis: BeatThisWgsl | null = null
let htdemucs: HtdemucsWgsl | null = null
let device: GPUDevice | null = null
let lost: string | null = null

const openDevice = async (): Promise<GPUDevice> => {
  if (device) return device
  if (!navigator.gpu) throw new Error('no WebGPU in this worker')
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('no WebGPU adapter')
  const f16 = adapter.features.has('shader-f16')
  const opened = await adapter.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [] })
  opened.lost.then((info) => {
    lost = `device lost (${info.reason}): ${info.message}`
    beatThis = null
    htdemucs = null
  })
  device = opened
  return opened
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    if (request.kind === 'load') {
      const opened = await openDevice()
      if (request.model === 'htdemucs') {
        if (!htdemucs) {
          htdemucs = await HtdemucsWgsl.create(opened, request.weights, request.manifest, { sources: [0, 3] })
        }
        self.postMessage({ id: request.id, result: { bytes: htdemucs.bytes } })
      } else {
        if (!beatThis) {
          const f16 = opened.features.has('shader-f16')
          beatThis = await BeatThisWgsl.create(opened, request.weights, request.manifest, {
            f16: f16 ? 'storage' : undefined,
          })
        }
        self.postMessage({ id: request.id, result: { bytes: beatThis.bytes } })
      }
      return
    }
    if (request.kind === 'percussive') {
      const opened = await openDevice()
      if (lost) throw new Error(lost)
      const energy = await runPercussiveEnergy(opened, request.mel, request.frames)
      self.postMessage({ id: request.id, result: energy }, { transfer: [energy.percussive.buffer, energy.total.buffer] })
      return
    }
    if (request.kind === 'separate') {
      if (lost) throw new Error(lost)
      if (!htdemucs) throw new Error('htdemucs not loaded')
      // 上游用 'auto' 分片是为了与可视化争 GPU 时不掉帧；但在本项目的 Chrome/Windows
      // 驱动上 onSubmittedWorkDone 每次约 20 ms，'auto' 会让每段慢到约 2 s（实测 8×）。
      // 结果与切片方式无关，这里整段一次提交，段间由调用方让出主线程。
      const result = await htdemucs.run(request.left, request.right, { slice: 'none' })
      const stems = result.stems
      self.postMessage({ id: request.id, result: { stems } }, { transfer: [stems[0].left.buffer] })
      return
    }
    if (request.kind === 'unload') {
      if (request.model === 'htdemucs') {
        htdemucs?.destroy()
        htdemucs = null
      } else {
        beatThis?.destroy()
        beatThis = null
      }
      self.postMessage({ id: request.id, result: true })
      return
    }
    if (request.kind === 'dispose') {
      beatThis?.destroy()
      htdemucs?.destroy()
      beatThis = null
      htdemucs = null
      device?.destroy()
      self.postMessage({ id: request.id, result: true })
      return
    }

    if (!beatThis) throw new Error('beat_this not loaded')
    const beat: Float32Array[] = []
    const downbeat: Float32Array[] = []
    for (const chunk of request.chunks) {
      if (lost) throw new Error(lost)
      const result = await beatThis.run(chunk, { slice: 'auto' })
      beat.push(result.beat.slice())
      downbeat.push(result.downbeat.slice())
    }
    let percussive: PercussiveEnergyFrames | undefined
    if (request.percussive && device && !lost) {
      try {
        percussive = await runPercussiveEnergy(device, request.percussive.mel, request.percussive.frames)
      } catch (error) {
        console.warn(`[beat-this-gpu] percussive energy failed: ${(error as Error)?.message ?? error}`)
      }
    }
    const tracks = [...beat, ...downbeat, ...(percussive ? [percussive.percussive, percussive.total] : [])]
    self.postMessage({ id: request.id, result: { beat, downbeat, percussive } }, { transfer: tracks.map((track) => track.buffer) })
  } catch (error) {
    self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error) })
  }
}
