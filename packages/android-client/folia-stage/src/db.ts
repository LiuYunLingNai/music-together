// This database contains only visual assets and layout caches, never accounts.
let opened: Promise<IDBDatabase> | undefined;
function database() {
  return (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("music-together-folia-assets", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("assets", mode);
    const request = action(tx.objectStore("assets"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error);
  });
}
export const getFromCache = async <T>(key: string): Promise<T | null> =>
  (await transaction("readonly", (store) => store.get(key))) ?? null;
export const saveToCache = (key: string, value: unknown) =>
  transaction("readwrite", (store) => store.put(value, key));
export const removeFromCache = (key: string) =>
  transaction("readwrite", (store) => store.delete(key));
