import { analyseTrack } from '../lib/automix/upstream/trackProfile'
import { melSpectrogram } from '../services/analysis/beatThis'

/**
 * 上游 `workers/automixAnalysis.worker.ts` 的宿主版：梅尔频谱与画像两趟 FFT
 * 都在这里跑，主线程只负责解码与混声道。纯函数，不碰 DOM；`yieldToUi` 在
 * 无 document 的线程里是空操作。
 */

type Request =
  | { id: number; kind: 'mel'; mono: Float32Array }
  | {
      id: number
      kind: 'profile'
      mono: Float32Array
      sampleRate: number
      options: Parameters<typeof analyseTrack>[2]
    }

const reply = (data: unknown, transfer?: Transferable[]): void => {
  ;(self as unknown as { postMessage(data: unknown, transfer?: Transferable[]): void }).postMessage(data, transfer)
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    if (request.kind === 'mel') {
      const mel = await melSpectrogram(request.mono)
      // 转移而不是复制：四分钟的曲子约六兆，这一侧之后不再使用。
      reply({ id: request.id, result: mel }, [mel.data.buffer])
      return
    }
    reply({ id: request.id, result: await analyseTrack(request.mono, request.sampleRate, request.options) })
  } catch (error) {
    reply({ id: request.id, error: String(error) })
  }
}
