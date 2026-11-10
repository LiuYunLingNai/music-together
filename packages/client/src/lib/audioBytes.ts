/**
 * 会话内音频字节复用。
 *
 * 播放器是渐进流；拍点图、automix 画像、分轨三处各自 fetch 整曲，一次播放
 * 最多会把同一首歌下载四遍。这里按稳定曲目键合并进行中的请求，并用小容量
 * LRU 保留最近几首，后续分析直接命中。
 *
 * 只缓存原始字节，不缓存解码结果：decodeAudioData 会 detach 传入的
 * ArrayBuffer，所以对外一律交付副本。弱网/省流量模式下把预算压到一首。
 */

const MAX_ENTRIES = 3
const DESKTOP_BUDGET_BYTES = 48 * 1024 * 1024
const MOBILE_BUDGET_BYTES = 24 * 1024 * 1024
const SAVE_DATA_BUDGET_BYTES = 16 * 1024 * 1024
/** 低于这个大小多半是错误页或试听碎片，不当作整曲缓存。 */
const MIN_AUDIO_BYTES = 16 * 1024

const coarsePointer = (): boolean => {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches === true
  } catch {
    return false
  }
}

const entries = new Map<string, ArrayBuffer>()
const inflight = new Map<string, Promise<ArrayBuffer | null>>()
/** 同一首歌的持久化写入串行化：预取写入必须完成后，解码校验的提交才能覆盖它。 */
const cacheWrites = new Map<string, Promise<boolean>>()
let totalBytes = 0

function queueCacheWrite(key: string, task: Promise<boolean>): void {
  const chained = task
    .catch(() => false)
    .finally(() => {
      if (cacheWrites.get(key) === chained) cacheWrites.delete(key)
    })
  cacheWrites.set(key, chained)
}

function budgetBytes(): number {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection
  if (connection?.saveData) return SAVE_DATA_BUDGET_BYTES
  return coarsePointer() ? MOBILE_BUDGET_BYTES : DESKTOP_BUDGET_BYTES
}

const maxEntries = (): number => (coarsePointer() ? 1 : MAX_ENTRIES)

function evictUntilWithinBudget(): void {
  const budget = budgetBytes()
  while (entries.size > 0 && (entries.size > maxEntries() || totalBytes > budget)) {
    const oldest = entries.entries().next()
    if (oldest.done) return
    const [key, value] = oldest.value
    entries.delete(key)
    totalBytes -= value.byteLength
  }
}

function store(key: string, bytes: ArrayBuffer): void {
  if (bytes.byteLength > budgetBytes()) return
  const previous = entries.get(key)
  if (previous) totalBytes -= previous.byteLength
  entries.delete(key)
  entries.set(key, bytes)
  totalBytes += bytes.byteLength
  evictUntilWithinBudget()
}

import { getCachedAudioBytes, putCachedAudioBytes } from './mediaCache'
import { notePlayback } from './playbackDiagnostics'

/** 取一首歌的完整音频字节。命中时返回副本；失败返回 null，且不写缓存。
 * 同一个键的并发请求共享一次网络下载。
 *
 * `persist` 用于预取：拿不到解码时长，只能按“无旧副本才写入”的保守规则落盘；
 * 播放/分析侧解码后应调用 `commitAudioBytesToCache` 用真实时长复核。
 */
export async function fetchAudioBytes(
  key: string,
  url: string,
  options: { persist?: boolean; statedDurationSec?: number | null; signal?: AbortSignal } = {},
): Promise<ArrayBuffer | null> {
  const cached = entries.get(key)
  if (cached) {
    // 刷新 LRU 顺序。
    entries.delete(key)
    entries.set(key, cached)
    notePlayback('memoryHits')
    return Promise.resolve(cached.slice(0))
  }

  const persisted = await getCachedAudioBytes(key)
  if (persisted) {
    store(key, persisted)
    notePlayback('persistentHits')
    return persisted.slice(0)
  }

  const running = inflight.get(key)
  if (running) return running.then((bytes) => bytes?.slice(0) ?? null)

  const task = (async (): Promise<ArrayBuffer | null> => {
    try {
      const response = await fetch(url, { signal: options.signal })
      if (!response.ok) {
        notePlayback('networkFailures')
        return null
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength < MIN_AUDIO_BYTES) {
        notePlayback('networkFailures')
        return null
      }
      notePlayback('networkLoads')
      store(key, bytes)
      if (options.persist) {
        queueCacheWrite(
          key,
          putCachedAudioBytes(key, bytes, { statedDurationSec: options.statedDurationSec }),
        )
      }
      return bytes
    } catch {
      notePlayback('networkFailures')
      return null
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, task)
  return task.then((bytes) => bytes?.slice(0) ?? null)
}

/** 解码拿到真实时长后复核并落盘；片段会被拒绝并从持久缓存删除。 */
export function commitAudioBytesToCache(
  key: string,
  actualDurationSec: number | null,
  statedDurationSec: number | null,
): void {
  const previous = cacheWrites.get(key)
  const task = (async (): Promise<boolean> => {
    // 预取的未校验写入可能还在飞；等它结束后再按真实时长覆盖/删除。
    if (previous) await previous
    const bytes = entries.get(key)
    if (!bytes) return false
    return putCachedAudioBytes(key, bytes, {
      actualDurationSec,
      statedDurationSec,
      validated: true,
    })
  })()
  queueCacheWrite(key, task)
}

/** 离开房间时释放；下一次进入重新取数。 */
export function clearAudioBytes(): void {
  entries.clear()
  inflight.clear()
  totalBytes = 0
}
