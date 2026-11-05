/**
 * 分析模型共享的 WebGPU worker 客户端。
 *
 * beat_this 与 htdemucs 在同一个 worker、同一个 device 上运行（与上游一致），
 * 由这里统一管理请求、空闲卸载与失败清理。
 */

const IDLE_UNLOAD_MS = 120_000

interface WorkerReply {
  id: number
  result?: unknown
  error?: string
}

let worker: Worker | null = null
let pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
let nextId = 1
let idleTimer: ReturnType<typeof setTimeout> | null = null
const lostHandlers = new Set<() => void>()

/** worker/device 被丢弃时调用：各模型模块把自己“已加载”的状态清掉。 */
export const registerAnalysisGpuLostHandler = (handler: () => void): (() => void) => {
  lostHandlers.add(handler)
  return () => lostHandlers.delete(handler)
}

const notifyLost = (): void => {
  for (const handler of lostHandlers) handler()
}

const clearIdle = (): void => {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

export const disposeAnalysisGpu = (): void => {
  clearIdle()
  for (const { reject } of pending.values()) reject(new Error('分析 worker 已关闭'))
  pending = new Map()
  worker?.terminate()
  worker = null
  notifyLost()
}

const ensureWorker = (): Worker => {
  if (worker) return worker
  const created = new Worker(new URL('../../workers/beatThisGpu.worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent<WorkerReply>) => {
    const settle = pending.get(event.data.id)
    if (!settle) return
    pending.delete(event.data.id)
    if (event.data.error) settle.reject(new Error(event.data.error))
    else settle.resolve(event.data.result)
  }
  created.onerror = (event) => {
    const error = new Error(event.message || '分析 worker 出错')
    for (const { reject } of pending.values()) reject(error)
    pending = new Map()
    worker = null
    created.terminate()
    notifyLost()
  }
  worker = created
  return created
}

let disposing: Promise<unknown> | null = null

const sendAnalysisGpu = <T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    try {
      ensureWorker().postMessage({ ...message, id }, transfer)
    } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

/** 每次模型使用后调用：空闲两分钟把两个模型都卸下，保留 worker。 */
export const touchAnalysisGpu = (): void => {
  clearIdle()
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (pending.size > 0) {
      touchAnalysisGpu()
      return
    }
    // 卸载往返期间新到的请求等到 worker 关掉之后再发；否则它们会被
    // `disposeAnalysisGpu` 以「分析 worker 已关闭」拒掉。
    disposing = sendAnalysisGpu({ kind: 'dispose' })
      .catch(() => undefined)
      .finally(() => {
        disposeAnalysisGpu()
        disposing = null
      })
  }, IDLE_UNLOAD_MS)
}

/**
 * 发一条 GPU 请求。空闲卸载正在进行时排在它之后，避免把刚启动的分析
 * 误伤成「worker 已关闭」。
 */
export const requestAnalysisGpu = <T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> =>
  disposing ? disposing.then(() => sendAnalysisGpu<T>(message, transfer)) : sendAnalysisGpu<T>(message, transfer)
