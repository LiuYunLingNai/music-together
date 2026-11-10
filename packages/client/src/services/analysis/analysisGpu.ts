/**
 * 分析模型共享的 WebGPU worker 客户端。
 *
 * beat_this 与 htdemucs 在同一个 worker、同一个 device 上运行（与上游一致），
 * 由这里统一管理请求、空闲卸载与失败清理。
 *
 * 上游 `beatThisGpu.ts` 的关键约束：模型只有一套 activation buffer，两个请求在
 * worker 里交错就会互相读坏。这里把 run / separate / percussive / load 全部放进
 * 一条单飞队列（前台优先，后台等待超过 1s 后插队防止饿死），并在请求超时或
 * worker 出错时丢弃 worker、让模型层重载；不再有并发交错与永久挂起的可能。
 */

const IDLE_UNLOAD_MS = 10 * 60_000
const DEFAULT_TIMEOUT_MS = 90_000
/** 后台请求（整曲分轨）等待超过这个时间就先于下一条前台请求执行。 */
const BACKGROUND_PROMOTE_MS = 1_000

/** 空闲卸载/卡死与新请求撞车时抛出：调用方应重载模型后再试，而不是当成分析失败。 */
export class AnalysisModelUnloadedError extends Error {
  constructor() {
    super('分析模型已随空闲 worker 卸载')
    this.name = 'AnalysisModelUnloadedError'
  }
}

/** 切歌后排队中的请求被丢弃；调用方按“本次分析作废”处理，而不是失败重试。 */
export class AnalysisRequestDroppedError extends Error {
  constructor() {
    super('分析请求已作废')
    this.name = 'AnalysisRequestDroppedError'
  }
}

export type AnalysisPriority = 'foreground' | 'background'

export interface AnalysisRequestOptions {
  priority?: AnalysisPriority
  /** 出队前判断：true 表示这次请求已经没人要了，直接丢弃。 */
  isStale?: () => boolean
  timeoutMs?: number
}

interface WorkerReply {
  id: number
  result?: unknown
  error?: string
  /** worker 内的 WebGPU device 已丢失；需要丢弃 worker 并让模型层重载。 */
  deviceLost?: boolean
}

interface QueuedJob {
  message: Record<string, unknown>
  transfer: Transferable[]
  priority: AnalysisPriority
  enqueuedAt: number
  isStale?: () => boolean
  timeoutMs: number
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
const pending = new Map<number, PendingRequest>()
let nextId = 1
let idleTimer: ReturnType<typeof setTimeout> | null = null
let queue: QueuedJob[] = []
let running = false
/** 空闲卸载/超时丢弃 worker 的同一 tick 内，让新来的运行请求改走重载路径。 */
let disposing = false
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

const clearPending = (error: Error): void => {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer)
    reject(error)
  }
  pending.clear()
}

const dropWorker = (error: Error): void => {
  clearIdle()
  worker?.terminate()
  worker = null
  clearPending(error)
  notifyLost()
  // 已经排队的 load 不依赖旧 worker，保留；运行请求的模型已随 worker 清掉，
  // 让调用方走“重载后重试”的既有路径。
  const kept: QueuedJob[] = []
  for (const job of queue) {
    if (job.message.kind === 'load') kept.push(job)
    else if (job.isStale?.()) job.reject(new AnalysisRequestDroppedError())
    else job.reject(new AnalysisModelUnloadedError())
  }
  queue = kept
}

export const disposeAnalysisGpu = (): void => {
  clearIdle()
  dropWorker(new Error('分析 worker 已关闭'))
  for (const job of queue) job.reject(new Error('分析 worker 已关闭'))
  queue = []
  running = false
}

const ensureWorker = (): Worker => {
  if (worker) return worker
  const created = new Worker(new URL('../../workers/beatThisGpu.worker.ts', import.meta.url), { type: 'module' })
  created.onmessage = (event: MessageEvent<WorkerReply>) => {
    // worker 明确报告 device 丢失：丢弃整个 worker，让模型层按“已卸载”重载，
    // 而不是把这次请求当成普通失败永久锁死分析。
    if (event.data.deviceLost) {
      dropWorker(new AnalysisModelUnloadedError())
      return
    }
    const settle = pending.get(event.data.id)
    if (!settle) return
    pending.delete(event.data.id)
    clearTimeout(settle.timer)
    if (event.data.error) settle.reject(new Error(event.data.error))
    else settle.resolve(event.data.result)
  }
  created.onerror = (event) => {
    dropWorker(new Error(event.message || '分析 worker 出错'))
  }
  worker = created
  return created
}

const sendJob = (job: QueuedJob): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      // 一次超时说明 worker/device 已经不可信：丢弃后由模型层重载。
      dropWorker(new Error('分析请求超时'))
    }, job.timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      ensureWorker().postMessage({ ...job.message, id }, job.transfer)
    } catch (error) {
      pending.delete(id)
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

const takeNext = (): QueuedJob | null => {
  if (!queue.length) return null
  const now = Date.now()
  const promoted = queue.findIndex(
    (job) => job.priority === 'background' && now - job.enqueuedAt >= BACKGROUND_PROMOTE_MS,
  )
  if (promoted >= 0) return queue.splice(promoted, 1)[0] ?? null
  const foreground = queue.findIndex((job) => job.priority === 'foreground')
  if (foreground >= 0) return queue.splice(foreground, 1)[0] ?? null
  return queue.shift() ?? null
}

const pump = (): void => {
  if (running) return
  const job = takeNext()
  if (!job) return
  running = true
  void (async () => {
    try {
      if (job.isStale?.()) throw new AnalysisRequestDroppedError()
      job.resolve(await sendJob(job))
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error(String(error)))
    } finally {
      running = false
      touchAnalysisGpu()
      pump()
    }
  })()
}

/** 每次模型使用后调用：空闲时丢弃 worker 并释放显存。 */
export const touchAnalysisGpu = (): void => {
  clearIdle()
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (pending.size > 0 || running || queue.length > 0) {
      touchAnalysisGpu()
      return
    }
    // 同一 tick 到达的运行请求不能排到已被丢弃的 worker 上，让它走重载路径。
    disposing = true
    disposeAnalysisGpu()
    setTimeout(() => {
      disposing = false
    }, 0)
  }, IDLE_UNLOAD_MS)
}

/**
 * 发一条 GPU 请求。所有请求串行执行（上游同样的单飞约束）；
 * 空闲卸载发生在同一 tick 时，运行请求改抛 `AnalysisModelUnloadedError`，
 * 让模型层重载后再发（此时输入缓冲尚未转移）。
 */
export const requestAnalysisGpu = <T>(
  message: Record<string, unknown>,
  transfer: Transferable[] = [],
  options: AnalysisRequestOptions = {},
): Promise<T> => {
  const kind = message.kind
  if (disposing && kind !== 'load') {
    return Promise.reject(new AnalysisModelUnloadedError())
  }
  return new Promise<T>((resolve, reject) => {
    queue.push({
      message,
      transfer,
      priority: options.priority ?? (kind === 'separate' ? 'background' : 'foreground'),
      enqueuedAt: Date.now(),
      isStale: options.isStale,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      resolve: resolve as (value: unknown) => void,
      reject,
    })
    touchAnalysisGpu()
    pump()
  })
}
