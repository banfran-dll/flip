import { BUCKET_MS, type Bucket } from './buckets';

/** IndexedDB persistence for 5-minute buckets. Every call swallows failures (private mode, quota). */
const DB_NAME = 'bzflip';
const STORE = 'buckets';
export const RETENTION_MS = 48 * 3_600_000;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 't' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadBuckets(now = Date.now()): Promise<Bucket[]> {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll(IDBKeyRange.lowerBound(now - RETENTION_MS));
      req.onsuccess = () => {
        const rows = (req.result as Bucket[]).filter((b) => b && b.ids && b.v).sort((a, b) => a.t - b.t);
        db.close();
        resolve(rows);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      resolve([]);
    }
  });
}

export async function saveBucket(bucket: Bucket): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(bucket);
      store.delete(IDBKeyRange.upperBound(bucket.t - RETENTION_MS - BUCKET_MS));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
