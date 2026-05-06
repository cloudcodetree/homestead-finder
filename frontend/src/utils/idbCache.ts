/**
 * Tiny IndexedDB-backed cache for JSON assets. ~40 lines, no
 * dependencies. Used by `useJsonAsset` to render from cache on
 * second visit while a fresh fetch revalidates in the background.
 *
 * Repeat-visit speed:
 *   - First visit: fetch over network (current behavior).
 *   - Second visit: instant render from IDB (sub-100ms typically),
 *     then a background fetch updates the cache when the new bytes
 *     arrive. SWR-style.
 *
 * Invalidation: TTL-based. Cached entries are considered "fresh" for
 * `freshMs`. After that, callers still get the cached value
 * synchronously (better than a spinner) but a network fetch is
 * scheduled to refresh.
 *
 * Falls through cleanly when IDB is unavailable (private-mode Safari,
 * very old browsers) — every operation resolves to null/no-op.
 */

const DB_NAME = 'hf-cache';
const DB_VERSION = 1;
const STORE = 'json';

interface CachedEntry<T> {
  value: T;
  cachedAt: number;
}

const open = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });

export const idbGet = async <T>(key: string): Promise<CachedEntry<T> | null> => {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CachedEntry<T>) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

export const idbSet = async <T>(key: string, value: T): Promise<void> => {
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ value, cachedAt: Date.now() } as CachedEntry<T>, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};
