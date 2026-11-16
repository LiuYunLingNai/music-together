import type { LyricPresentation } from './lyricPresentation'

const DB_NAME = 'music-together-lyrics'
const DB_VERSION = 1
const STORE = 'presentations'
const MAX_ENTRIES = 200
const TTL_MS = 24 * 60 * 60 * 1_000

interface StoredPresentation {
  key: string
  savedAt: number
  expiresAt: number
  value: LyricPresentation
}

let databasePromise: Promise<IDBDatabase | null> | null = null

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!databasePromise) {
    databasePromise = new Promise((resolve) => {
      let settled = false
      const finish = (database: IDBDatabase | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(database)
      }
      const timer = setTimeout(() => finish(null), 2_000)
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(STORE)) {
            const store = database.createObjectStore(STORE, { keyPath: 'key' })
            store.createIndex('savedAt', 'savedAt')
          }
        }
        request.onsuccess = () => finish(request.result)
        request.onerror = () => finish(null)
        request.onblocked = () => finish(null)
      } catch {
        finish(null)
      }
    })
  }
  return databasePromise
}

function prune(store: IDBObjectStore): void {
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
}

export async function getPersistedLyricPresentation(key: string): Promise<LyricPresentation | null> {
  const database = await openDatabase()
  if (!database) return null
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.get(key)
      request.onsuccess = () => {
        const entry = request.result as StoredPresentation | undefined
        if (!entry) {
          resolve(null)
          return
        }
        if (entry.expiresAt <= Date.now()) {
          store.delete(key)
          resolve(null)
          return
        }
        resolve(entry.value)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function savePersistedLyricPresentation(key: string, value: LyricPresentation): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  try {
    const transaction = database.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    const now = Date.now()
    store.put({ key, savedAt: now, expiresAt: now + TTL_MS, value } satisfies StoredPresentation)
    prune(store)
  } catch {
    /* IndexedDB can be unavailable in private mode; the in-memory cache still works. */
  }
}
