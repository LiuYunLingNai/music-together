/**
 * 上游 `services/db.ts` 的宿主版本。
 *
 * 上游用 Dexie 建了一个多表缓存库（歌词、封面、分析结果、视觉素材……）。本仓没有那套库：
 * 视觉素材（cappella 表情包、monet 封面、tempera 图层图）各自用自己的 IndexedDB 库
 * （见 `folia/services/cappellaImagePacks.ts` 与 `monetPortraitImage.ts` 的注释）。
 *
 * 这里只实现上游视觉素材真正用到的那三个缓存原语，落到一个与宿主同构的单 objectStore 库
 * `mt-folia-cache`：键值对、失败一律静默降级（素材缺失只影响对应的自定义源回退）。
 */

const DATABASE_NAME = 'mt-folia-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'cache'

type CacheEntry = { key: string; data: unknown }

const openDatabase = (): Promise<IDBDatabase | null> =>
    new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null)
            return
        }
        let request: IDBOpenDBRequest
        try {
            request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        } catch {
            resolve(null)
            return
        }
        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
    })

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
    const db = await openDatabase()
    if (!db) return null
    try {
        return await new Promise<T | null>((resolve) => {
            const tx = db.transaction(STORE_NAME, mode)
            const request = run(tx.objectStore(STORE_NAME))
            request.onsuccess = () => resolve(request.result ?? null)
            request.onerror = () => resolve(null)
            tx.oncomplete = () => db.close()
            tx.onerror = () => { db.close(); resolve(null) }
        })
    } catch {
        db.close()
        return null
    }
}

export const saveToCache = async (key: string, data: unknown): Promise<void> => {
    await withStore('readwrite', (store) => store.put({ key, data } satisfies CacheEntry))
}

export const getFromCache = async <T>(key: string): Promise<T | null> => {
    const entry = await withStore<CacheEntry | undefined>('readonly', (store) => store.get(key))
    return (entry?.data as T) ?? null
}

export const removeFromCache = async (key: string): Promise<void> => {
    await withStore('readwrite', (store) => store.delete(key))
}

/** 上游还有带迁移的读取；视觉素材用不到，保留同形签名以免调用方改动。 */
export const getFromCacheWithMigration = async <T>(
    key: string,
    migrate: (data: T) => { ok: true; data: T } | { ok: false; remove?: boolean },
): Promise<T | null> => {
    const cached = await getFromCache<T>(key)
    if (cached === null) return null
    const result = migrate(cached)
    if (result.ok) return result.data
    if (result.remove) await removeFromCache(key)
    return null
}
