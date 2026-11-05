import type { BeatMap } from './beatAnalysisTypes'

/**
 * 拍点图的持久缓存。
 *
 * 音频代理是 `Cache-Control: private, no-store`：刷新页面、重播同一首歌都会
 * 重新下载整首音频再解码。把分析结果按曲目身份存进 IndexedDB，命中时不再
 * 走网络，也顺带减轻服务端代理压力。
 */

const DB_NAME = 'mt-beat-analysis'
const STORE_NAME = 'beat-maps'
const DB_VERSION = 1
const CACHE_VERSION = 3
const MAX_ENTRIES = 60

interface StoredBeatMap {
  key: string
  version: number
  savedAt: number
  map: BeatMap
}

let databasePromise: Promise<IDBDatabase | null> | null = null

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('savedAt', 'savedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return databasePromise
}

export const readBeatMapFromDisk = async (key: string): Promise<BeatMap | null> => {
  const db = await openDatabase()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => {
        const stored = request.result as StoredBeatMap | undefined
        if (!stored || stored.version !== CACHE_VERSION) {
          resolve(null)
          if (stored) void deleteBeatMapFromDisk(key)
          return
        }
        resolve(stored.map)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export const writeBeatMapToDisk = async (key: string, map: BeatMap): Promise<void> => {
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put({ key, version: CACHE_VERSION, savedAt: Date.now(), map } satisfies StoredBeatMap)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  await pruneOldEntries(db)
}

const pruneOldEntries = async (db: IDBDatabase): Promise<void> => {
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const countRequest = store.count()
      countRequest.onsuccess = () => {
        let excess = countRequest.result - MAX_ENTRIES
        if (excess <= 0) return
        const cursorRequest = store.index('savedAt').openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor || excess <= 0) return
          cursor.delete()
          excess -= 1
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

export const deleteBeatMapFromDisk = async (key: string): Promise<void> => {
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

export const clearBeatMapDisk = async (): Promise<void> => {
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
