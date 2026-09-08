/**
 * Offline-First Telemetry Buffering & Batch Synchronization Queue
 * Uses browser IndexedDB with fallback queue for offline GPS telemetry caching
 * during tunnel transits, basement loading bays, and network drops.
 */

export interface TelemetryPoint {
  latitude: number;
  longitude: number;
  speed?: number; // km/h
  heading?: number; // degrees
  accuracy?: number; // meters
  timestamp?: string; // ISO 8601 UTC
}

export interface BufferedTelemetryPoint extends TelemetryPoint {
  id: number;
  token: string;
  enqueuedAt: string;
  attempts: number;
}

const DB_NAME = 'fleet360_telemetry_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_telemetry_queue';

// In-memory fallback for environments where IndexedDB is blocked or unavailable
const memoryQueue: BufferedTelemetryPoint[] = [];
let nextMemoryId = 1;

/**
 * Initializes and opens the IndexedDB database
 */
function openTelemetryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in current environment'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('token', 'token', { unique: false });
        store.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Enqueues a telemetry point into the offline queue
 */
export async function enqueueTelemetryPoint(token: string, point: TelemetryPoint): Promise<number> {
  const timestamp = point.timestamp || new Date().toISOString();
  const pointData: Omit<BufferedTelemetryPoint, 'id'> = {
    ...point,
    token,
    timestamp,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
  };

  try {
    const db = await openTelemetryDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(pointData);

      req.onsuccess = () => {
        resolve(req.result as number);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback to in-memory queue
    const memId = nextMemoryId++;
    memoryQueue.push({ id: memId, ...pointData });
    return memId;
  }
}

/**
 * Peeks up to `limit` points from the buffer
 */
export async function peekBufferedTelemetry(limit: number = 50, token?: string): Promise<BufferedTelemetryPoint[]> {
  try {
    const db = await openTelemetryDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        let items: BufferedTelemetryPoint[] = req.result || [];
        if (token) {
          items = items.filter(i => i.token === token);
        }
        resolve(items.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    let items = memoryQueue;
    if (token) {
      items = items.filter(i => i.token === token);
    }
    return items.slice(0, limit);
  }
}

/**
 * Deletes successfully synced points from the buffer
 */
export async function clearBufferedTelemetry(ids: number[]): Promise<void> {
  if (!ids || ids.length === 0) return;

  try {
    const db = await openTelemetryDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    for (const id of ids) {
      const idx = memoryQueue.findIndex(i => i.id === id);
      if (idx >= 0) memoryQueue.splice(idx, 1);
    }
  }
}

/**
 * Returns total count of pending offline points
 */
export async function getBufferedTelemetryCount(token?: string): Promise<number> {
  const points = await peekBufferedTelemetry(1000, token);
  return points.length;
}

/**
 * Flushes all pending buffered points to the server batch endpoint
 */
export async function flushBufferedTelemetryBatch(token: string): Promise<{ flushed: number; remaining: number }> {
  const pending = await peekBufferedTelemetry(100, token);
  if (pending.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  const payloadPoints = pending.map(p => ({
    latitude: p.latitude,
    longitude: p.longitude,
    speed: p.speed,
    heading: p.heading,
    accuracy: p.accuracy,
    timestamp: p.timestamp,
  }));

  try {
    const res = await fetch(`/api/public/partner-driver/${token}/telemetry-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: payloadPoints }),
    });

    if (res.ok) {
      const ids = pending.map(p => p.id);
      await clearBufferedTelemetry(ids);
      const remaining = await getBufferedTelemetryCount(token);
      return { flushed: ids.length, remaining };
    }
  } catch {
    // Sync failed, points remain in buffer for next retry
  }

  const remaining = await getBufferedTelemetryCount(token);
  return { flushed: 0, remaining };
}
