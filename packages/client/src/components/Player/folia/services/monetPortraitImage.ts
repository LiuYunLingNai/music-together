import type { StoredMonetPortraitImage } from '../types'

/**
 * monet 自定义封面（海报人像）的本地持久化（IndexedDB）。
 *
 * 移植自上游 `services/monetPortraitImage.ts`（其底座 `visualizerImageAsset.ts`
 * 是 Dexie 单键存取）—— 与 `cappellaImagePacks.ts` 同构：Blob 存
 * `mt-folia-assets`、失败一律静默降级（资产缺失只让 monet 的 'custom'
 * 来源回退到专辑封面，不影响其它功能）。区别是 monet 只存**一张**图，
 * 键值对而非列表。
 */

const DATABASE_NAME = 'mt-folia-assets'
const DATABASE_VERSION = 1
const MONET_PORTRAIT_IMAGE_KEY = 'monet_portrait_image'

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']

function withDatabase<T>(run: (store: IDBObjectStore) => T | undefined): Promise<T | null> {
  return new Promise((resolve) => {
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
      if (!request.result.objectStoreNames.contains('assets')) {
        request.result.createObjectStore('assets')
      }
    }
    request.onerror = () => resolve(null)
    request.onsuccess = () => {
      const database = request.result
      try {
        const transaction = database.transaction('assets', 'readwrite')
        const outcome = run(transaction.objectStore('assets'))
        transaction.oncomplete = () => {
          database.close()
          resolve(outcome ?? null)
        }
        transaction.onerror = () => {
          database.close()
          resolve(null)
        }
        transaction.onabort = () => {
          database.close()
          resolve(null)
        }
      } catch {
        database.close()
        resolve(null)
      }
    }
  })
}

export async function loadStoredMonetPortraitImage(): Promise<StoredMonetPortraitImage | null> {
  const stored = await withDatabase((store) => store.get(MONET_PORTRAIT_IMAGE_KEY) as unknown as StoredMonetPortraitImage | undefined)
  if (!stored || !(stored.blob instanceof Blob) || typeof stored.name !== 'string') return null
  return stored
}

export async function saveStoredMonetPortraitImage(image: StoredMonetPortraitImage): Promise<void> {
  await withDatabase((store) => {
    store.put(image, MONET_PORTRAIT_IMAGE_KEY)
  })
}

export async function clearStoredMonetPortraitImage(): Promise<void> {
  await withDatabase((store) => {
    store.delete(MONET_PORTRAIT_IMAGE_KEY)
  })
}

export const isSupportedMonetPortraitFile = (file: File) => {
  const lowerName = file.name.toLowerCase()
  const hasSupportedExtension = SUPPORTED_IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
  return file.type.startsWith('image/') || hasSupportedExtension
}

export const buildStoredMonetPortraitImage = (file: File): StoredMonetPortraitImage => ({
  id: `${Date.now()}-${file.name}`,
  name: file.name,
  mimeType: file.type || 'application/octet-stream',
  blob: file,
})
