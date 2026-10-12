import type { TemperaLayerImage } from '../types'

// The room renderer receives image assets from the host; no Electron storage dependency.
export async function loadTemperaLayerImageBlobs(placements: TemperaLayerImage[]): Promise<Map<string, Blob>> {
  if (!placements.length || typeof indexedDB === 'undefined') return new Map()
  return new Promise((resolve) => {
    const request = indexedDB.open('mt-folia-images', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('images')
    request.onerror = () => resolve(new Map())
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('images', 'readonly')
      const result = new Map<string, Blob>()
      for (const placement of placements) {
        const read = transaction.objectStore('images').get(placement.id)
        read.onsuccess = () => { if (read.result instanceof Blob) result.set(placement.id, read.result) }
      }
      transaction.oncomplete = () => { database.close(); resolve(result) }
      transaction.onerror = () => { database.close(); resolve(new Map()) }
    }
  })
}
