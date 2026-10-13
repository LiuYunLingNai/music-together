import type { StoredCappellaAvatarImage, StoredCappellaEmojiImage } from '../types'

/**
 * cappella 自定义表情包 / 头像的本地持久化（IndexedDB）。
 *
 * 移植自上游 `services/cappellaEmojiPack.ts` / `cappellaAvatarPack.ts`：
 * Blob 存 IndexedDB、启动时异步恢复、导入时校验扩展名/MIME。上游的
 * `services/db.ts`（Dexie 多表缓存）是 Electron 应用级设施，这里收敛为
 * 独立的 `mt-folia-assets` 库 —— 与 `services/temperaLayerImages.ts` 的
 * `mt-folia-images` 同构：单 objectStore、键值对、失败一律静默降级
 * （资产缺失只影响 cappella 的 'custom' 源回退，不影响任何其它功能）。
 */

const DATABASE_NAME = 'mt-folia-assets'
const DATABASE_VERSION = 1
const EMOJI_PACK_KEY = 'cappella_custom_emoji_pack'
const AVATAR_PACK_KEY = 'cappella_custom_avatar_pack'

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

export async function loadStoredCappellaImagePack(kind: 'emoji' | 'avatar'): Promise<Array<StoredCappellaEmojiImage | StoredCappellaAvatarImage>> {
  const stored = await withDatabase((store) => store.get(kind === 'emoji' ? EMOJI_PACK_KEY : AVATAR_PACK_KEY))
  if (!Array.isArray(stored)) return []
  return stored.filter((entry) => entry?.blob instanceof Blob && typeof entry.name === 'string')
}

export async function saveStoredCappellaImagePack(
  kind: 'emoji' | 'avatar',
  images: Array<StoredCappellaEmojiImage | StoredCappellaAvatarImage>,
): Promise<void> {
  await withDatabase((store) => {
    store.put(images, kind === 'emoji' ? EMOJI_PACK_KEY : AVATAR_PACK_KEY)
  })
}

export async function clearStoredCappellaImagePack(kind: 'emoji' | 'avatar'): Promise<void> {
  await withDatabase((store) => {
    store.delete(kind === 'emoji' ? EMOJI_PACK_KEY : AVATAR_PACK_KEY)
  })
}

const isSupportedCappellaImageFile = (file: File) => {
  const lowerName = file.name.toLowerCase()
  const hasSupportedExtension = SUPPORTED_IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
  return file.type.startsWith('image/') || hasSupportedExtension
}

export const buildStoredCappellaImagePack = (files: File[]): StoredCappellaEmojiImage[] =>
  files
    .filter(isSupportedCappellaImageFile)
    .map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      blob: file,
    }))
