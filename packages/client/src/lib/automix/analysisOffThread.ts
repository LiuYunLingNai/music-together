import { melSpectrogram, type MelSpectrogram } from '@/services/analysis/beatThis'
import { analyseTrack, type TrackProfile } from './upstream/trackProfile'

/**
 * 画像与梅尔频谱的线程边界：逐帧 FFT、`analyseTrack` 都在 Worker 里跑。
 * 每条路径最终落到同一个函数，所以没有 Worker 与 Worker 失败得到的是同一份
 * 答案，只是算在别处。失败一次后本次会话不再重试。
 */

type AnalyseOptions = Parameters<typeof analyseTrack>[2]

interface Reply {
  id: number
  result?: unknown
  error?: string
}

let worker: Worker | null = null
let declined = false
let nextId = 0
/** 单条分析消息的上限：worker 卡死时不能让队列永远等下去。 */
const WORKER_TIMEOUT_MS = 60_000
const pending = new Map<number, (reply: Reply) => void>()

const decline = (why: string): void => {
  if (!declined) console.warn(`[Automix] 分析改回主线程：${why}`)
  declined = true
  worker?.terminate()
  worker = null
  for (const settle of pending.values()) settle({ id: -1, error: why })
  pending.clear()
}

/** 单条消息超时只换一个 worker，不永久放弃线程路径。 */
const resetWorker = (why: string): void => {
  console.warn(`[Automix] 分析 worker 超时，重建：${why}`)
  worker?.terminate()
  worker = null
  for (const settle of pending.values()) settle({ id: -1, error: why })
  pending.clear()
}

const ensureWorker = (): Worker | null => {
  if (declined) return null
  if (worker) return worker
  if (typeof Worker === 'undefined') {
    declined = true
    return null
  }
  try {
    worker = new Worker(new URL('../../workers/automixAnalysis.worker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    decline(String(error))
    return null
  }
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const settle = pending.get(event.data.id)
    if (!settle) return
    pending.delete(event.data.id)
    settle(event.data)
  }
  worker.onerror = (event) => decline(event.message || 'worker error')
  return worker
}

const send = (message: Record<string, unknown>): Promise<Reply> | null => {
  const active = ensureWorker()
  if (!active) return null
  const id = (nextId += 1)
  return new Promise<Reply>((resolve) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      resetWorker('worker timeout')
      resolve({ id, error: 'worker timeout' })
    }, WORKER_TIMEOUT_MS)
    const settle = (reply: Reply): void => {
      clearTimeout(timer)
      resolve(reply)
    }
    pending.set(id, settle)
    try {
      active.postMessage({ ...message, id })
    } catch (error) {
      pending.delete(id)
      clearTimeout(timer)
      decline(String(error))
      resolve({ id, error: String(error) })
    }
  })
}

/** Beat This 吃的频谱：与 `melSpectrogram` 完全相同，只是算在 Worker 里。 */
export const melSpectrogramOffThread = async (mono: Float32Array): Promise<MelSpectrogram> => {
  const reply = await send({ kind: 'mel', mono })
  if (reply && !reply.error) return reply.result as MelSpectrogram
  return melSpectrogram(mono)
}

/** 一首歌的画像：与 `analyseTrack` 完全相同，只是算在 Worker 里。 */
export const analyseTrackOffThread = async (
  mono: Float32Array,
  sampleRate: number,
  options: AnalyseOptions = {},
): Promise<TrackProfile | null> => {
  const reply = await send({ kind: 'profile', mono, sampleRate, options })
  if (reply && !reply.error) return reply.result as TrackProfile | null
  return analyseTrack(mono, sampleRate, options)
}
