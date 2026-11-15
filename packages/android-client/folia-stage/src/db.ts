// Stage-local cache; it never opens the Folia application's library or sessions.
const cache = new Map<string, unknown>();
export const getFromCache = async (key: string) => cache.get(key) ?? null;
export const saveToCache = async (key: string, value: unknown) => {
  cache.set(key, value);
};
export const removeFromCache = async (key: string) => {
  cache.delete(key);
};
