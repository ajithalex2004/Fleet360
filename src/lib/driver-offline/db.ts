/**
 * src/lib/driver-offline/db.ts
 *
 * IndexedDB schema + thin wrapper for the driver mobile app.
 *
 * Why IndexedDB (not localStorage):
 *   - localStorage is synchronous and capped at ~5 MB. A single DVIR with
 *     three defect photos at 800 KB each is already over the limit.
 *   - localStorage blocks the main thread, which on a 3G connection in
 *     the desert feels like a freeze.
 *   - IndexedDB is async, stores binary (Blob/ArrayBuffer) natively, and
 *     has effectively no per-origin quota for the kind of data we keep
 *     (a few hundred KB of metadata + blobs for one trip).
 *
 * Why a thin wrapper (not Dexie / RxDB / idb-keyval):
 *   - Dexie adds 22 KB gzipped and a query DSL. We need four operations:
 *     put, get, getAll, delete. The DSL is overkill.
 *   - RxDB is great for replication, but the sync model we want is a
 *     write-ahead log (the sync queue in `sync.ts`), not a CRDT. RxDB's
 *     defaults fight us.
 *   - `idb` (the npm package we just installed) is 1.4 KB gzipped and
 *     gives us Promise-based access to IndexedDB. The rest of the
 *     abstraction is ~80 lines below.
 *
 * Schema:
 *   - `trips`            — current driver assignment(s), refreshed on login
 *   - `dvir`             — local DVIRs queued for sync
 *   - `dvir_photos`      — binary blobs (the actual photo data)
 *   - `behavior_events`  — GPS-derived harsh-brake / speeding samples
 *   - `sync_queue`       — generic write-ahead log for any future offline
 *                          write (the architecture is intentionally
 *                          generic so we can add new offline-capable
 *                          features without changing the sync engine).
 *
 * All keys are string. Tenant scoping is done in the API layer; the
 * offline cache stores only what the authenticated driver can see.
 */

import { openDB, type DBSchema, type IDBPDatabase, type StoreNames } from 'idb';

export interface OfflineTrip {
  id: string;
  tenantId: string;
  routeName: string;
  origin: string;
  destination: string;
  scheduledDeparture: string; // ISO
  scheduledArrival: string;   // ISO
  vehicleId: string | null;
  vehiclePlate: string | null;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  stops: OfflineTripStop[];
  cachedAt: number;            // epoch ms
}

export interface OfflineTripStop {
  id: string;
  sequence: number;
  name: string;
  lat: number | null;
  lng: number | null;
  estimatedArrival: string | null;
  arrivedAt: string | null;   // set when the driver taps "Arrived"
}

export interface OfflineDvir {
  id: string;                  // client-generated UUID
  tripId: string;
  driverId: string;
  tenantId: string;
  type: 'PRE_TRIP' | 'POST_TRIP';
  startedAt: string;           // ISO
  completedAt: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  // Map of checklist key → { ok, note, photoIds: string[] }
  // Photo IDs reference rows in the `dvir_photos` store. We don't inline
  // the blobs in the DVIR row because IndexedDB stores structured-clone
  // data and a 2 MB photo in the same row as a 1 KB DVIR row makes
  // the row a hot spot for sync.
  items: Record<string, OfflineDvirItem>;
  defects: OfflineDvirDefect[];
  notes: string | null;
  signatureSvg: string | null; // SVG path of the driver's signature
  status: 'DRAFT' | 'PENDING_SYNC' | 'SYNCED' | 'FAILED';
  // ms-since-epoch when we enqueued it. Drives retry ordering.
  enqueuedAt: number | null;
  lastSyncAttemptAt: number | null;
  lastSyncError: string | null;
}

export interface OfflineDvirItem {
  // `ok: null` means "not yet marked" — the default state. The driver
  // has to actively mark each item. Submit is blocked while any item
  // is null. The boolean form is the only state that can be submitted.
  ok: boolean | null;
  note?: string;
  photoIds?: string[];
}

export interface OfflineDvirDefect {
  category: string;             // e.g. 'brakes', 'tyres'
  description: string;
  severity: 'MINOR' | 'MAJOR' | 'CRITICAL';
  photoIds: string[];
}

export interface OfflineDvirPhoto {
  id: string;                  // client-generated UUID
  dvirId: string;
  itemKey: string | null;      // null for free-form defect photos
  blob: Blob;
  mime: string;                // 'image/jpeg' or 'image/webp'
  size: number;
  takenAt: string;             // ISO
  // Server-side URL after sync. Until SYNCED, this is the local object
  // URL the driver can use to preview their own photo in the form.
  remoteUrl: string | null;
}

export interface OfflineBehaviorEvent {
  id: string;
  tripId: string | null;
  shiftId: string | null;
  driverId: string;
  tenantId: string;
  type: 'HARSH_BRAKE' | 'HARSH_ACCEL' | 'SPEEDING' | 'IDLE_START' | 'IDLE_END';
  // Geolocation at the moment of the event. Optional — the IDLE_START /
  // IDLE_END events are location-agnostic.
  lat: number | null;
  lng: number | null;
  // Reported GPS speed at the time of the event, in km/h
  speedKmh: number | null;
  // The numeric value associated with the event (km/h/s for brake/
  // accel, km/h over the limit for speeding, null for idle)
  value: number | null;
  // Free-form note shown in the UI ("decel 7.3 km/h/s", "+15 over
  // limit", etc). Not editable by the user.
  note: string | null;
  occurredAt: string;
  status: 'PENDING_SYNC' | 'SYNCED' | 'FAILED';
  enqueuedAt: number | null;
  lastSyncError: string | null;
}

export interface OfflineSyncQueueItem {
  id: string;
  kind: 'DVIR' | 'BEHAVIOR' | 'STOP_ARRIVAL' | 'GENERIC';
  // The path the API will accept. e.g. '/api/driver-app/dvir'
  endpoint: string;
  method: 'POST' | 'PATCH';
  // Stringified JSON body. We store the raw body and parse at sync time
  // so a quota error doesn't drop the row mid-flight.
  body: string;
  // ms-since-epoch. Used for FIFO ordering and for the "stale" warning
  // shown in the driver UI ("3 events queued, oldest from 12 min ago").
  createdAt: number;
  // Number of attempts; exponential backoff uses this.
  attempts: number;
  // Last failure message; cleared on success.
  lastError: string | null;
  // When the next retry is allowed. null = ready now.
  notBefore: number | null;
}

interface DriverOfflineDB extends DBSchema {
  trips: {
    key: string;
    value: OfflineTrip;
    indexes: { 'by-status': string; 'by-scheduledDeparture': string };
  };
  dvir: {
    key: string;
    value: OfflineDvir;
    indexes: { 'by-tripId': string; 'by-status': string; 'by-enqueuedAt': number };
  };
  dvir_photos: {
    key: string;
    value: OfflineDvirPhoto;
    indexes: { 'by-dvirId': string };
  };
  behavior_events: {
    key: string;
    value: OfflineBehaviorEvent;
    indexes: { 'by-tripId': string; 'by-status': string; 'by-occurredAt': string };
  };
  sync_queue: {
    key: string;
    value: OfflineSyncQueueItem;
    indexes: { 'by-kind': string; 'by-createdAt': number; 'by-notBefore': number };
  };
}

const DB_NAME = 'fleet360-driver';
const DB_VERSION = 1;

// Module-level singleton. We don't want to open the DB on every call —
// openDB is fast but the schema upgrade path is not. Single connection
// per app session.
let dbPromise: Promise<IDBPDatabase<DriverOfflineDB>> | null = null;

function getDB(): Promise<IDBPDatabase<DriverOfflineDB>> {
  if (dbPromise) return dbPromise;
  dbPromise = openDB<DriverOfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v1 initial schema. Bump DB_VERSION and add new upgrade branches
      // for any v2+ changes.
      if (oldVersion < 1) {
        const trips = db.createObjectStore('trips', { keyPath: 'id' });
        trips.createIndex('by-status', 'status');
        trips.createIndex('by-scheduledDeparture', 'scheduledDeparture');

        const dvir = db.createObjectStore('dvir', { keyPath: 'id' });
        dvir.createIndex('by-tripId', 'tripId');
        dvir.createIndex('by-status', 'status');
        dvir.createIndex('by-enqueuedAt', 'enqueuedAt');

        const photos = db.createObjectStore('dvir_photos', { keyPath: 'id' });
        photos.createIndex('by-dvirId', 'dvirId');

        const beh = db.createObjectStore('behavior_events', { keyPath: 'id' });
        beh.createIndex('by-tripId', 'tripId');
        beh.createIndex('by-status', 'status');
        beh.createIndex('by-occurredAt', 'occurredAt');

        const q = db.createObjectStore('sync_queue', { keyPath: 'id' });
        q.createIndex('by-kind', 'kind');
        q.createIndex('by-createdAt', 'createdAt');
        q.createIndex('by-notBefore', 'notBefore');
      }
    },
    // When the schema doesn't match (e.g. dev moved to v2), close the
    // connection so the next call re-opens. This is safer than blocking
    // on a schema the user is actively iterating.
    blocked() {
      console.warn('[driver-offline] IndexedDB version newer than code supports; closing connection.');
    },
    blocking() {
      console.warn('[driver-offline] Another tab is holding an older schema; reload to continue.');
    },
    terminated() {
      // Reset the singleton so the next call re-opens.
      dbPromise = null;
    },
  });
  return dbPromise;
}

// ── Generic helpers ──────────────────────────────────────────────

/** UUID v4 with crypto fallback. Driver app MUST use this — we don't
 *  want to add uuid as a dep on a hot path on a slow Android. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // RFC4122 v4 fallback (Math.random is fine here; this is a client-side
  // row id, not security-sensitive).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Trip cache ───────────────────────────────────────────────────

export async function putTrips(trips: OfflineTrip[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('trips', 'readwrite');
  for (const t of trips) {
    await tx.store.put({ ...t, cachedAt: Date.now() });
  }
  await tx.done;
}

export async function getTrip(id: string): Promise<OfflineTrip | undefined> {
  const db = await getDB();
  return db.get('trips', id);
}

export async function getAllTrips(): Promise<OfflineTrip[]> {
  const db = await getDB();
  return db.getAll('trips');
}

export async function markStopArrived(
  tripId: string,
  stopId: string,
  at: string = new Date().toISOString(),
): Promise<OfflineTrip | undefined> {
  const db = await getDB();
  const tx = db.transaction('trips', 'readwrite');
  const trip = await tx.store.get(tripId);
  if (!trip) {
    await tx.done;
    return undefined;
  }
  const updated: OfflineTrip = {
    ...trip,
    stops: trip.stops.map((s) => (s.id === stopId ? { ...s, arrivedAt: at } : s)),
  };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

// ── DVIR ─────────────────────────────────────────────────────────

export async function putDvir(dvir: OfflineDvir): Promise<void> {
  const db = await getDB();
  await db.put('dvir', dvir);
}

export async function getDvir(id: string): Promise<OfflineDvir | undefined> {
  const db = await getDB();
  return db.get('dvir', id);
}

export async function getDvirByTrip(tripId: string): Promise<OfflineDvir[]> {
  const db = await getDB();
  return db.getAllFromIndex('dvir', 'by-tripId', tripId);
}

export async function getPendingDvir(): Promise<OfflineDvir[]> {
  const db = await getDB();
  return db.getAllFromIndex('dvir', 'by-status', 'PENDING_SYNC');
}

export async function markDvirStatus(
  id: string,
  status: OfflineDvir['status'],
  error: string | null = null,
): Promise<void> {
  const db = await getDB();
  const dvir = await db.get('dvir', id);
  if (!dvir) return;
  await db.put('dvir', {
    ...dvir,
    status,
    lastSyncAttemptAt: Date.now(),
    lastSyncError: error,
  });
}

// ── DVIR photos ─────────────────────────────────────────────────

export async function putDvirPhoto(photo: OfflineDvirPhoto): Promise<void> {
  const db = await getDB();
  await db.put('dvir_photos', photo);
}

export async function getDvirPhoto(id: string): Promise<OfflineDvirPhoto | undefined> {
  const db = await getDB();
  return db.get('dvir_photos', id);
}

export async function getDvirPhotos(dvirId: string): Promise<OfflineDvirPhoto[]> {
  const db = await getDB();
  return db.getAllFromIndex('dvir_photos', 'by-dvirId', dvirId);
}

export async function deleteDvirPhoto(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('dvir_photos', id);
}

// ── Behaviour events ────────────────────────────────────────────

export async function putBehaviorEvent(ev: OfflineBehaviorEvent): Promise<void> {
  const db = await getDB();
  await db.put('behavior_events', ev);
}

export async function getBehaviorEventsByTrip(tripId: string): Promise<OfflineBehaviorEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex('behavior_events', 'by-tripId', tripId);
}

export async function getPendingBehaviorEvents(): Promise<OfflineBehaviorEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex('behavior_events', 'by-status', 'PENDING_SYNC');
}

// ── Generic sync queue ──────────────────────────────────────────

export async function enqueueSync(item: Omit<OfflineSyncQueueItem, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'notBefore'>): Promise<string> {
  const db = await getDB();
  const id = newId();
  const full: OfflineSyncQueueItem = {
    id,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    notBefore: null,
    ...item,
  };
  await db.put('sync_queue', full);
  return id;
}

export async function getSyncQueue(): Promise<OfflineSyncQueueItem[]> {
  const db = await getDB();
  return db.getAll('sync_queue');
}

export async function getReadySyncItems(now: number = Date.now()): Promise<OfflineSyncQueueItem[]> {
  const db = await getDB();
  // IndexedDB doesn't do compound range queries, so we scan and filter.
  // For an offline queue with at most a few hundred items this is fine.
  const all = await db.getAll('sync_queue');
  return all.filter((it) => it.notBefore === null || it.notBefore <= now);
}

export async function incrementSyncAttempt(
  id: string,
  error: string,
  nextNotBefore: number | null,
): Promise<void> {
  const db = await getDB();
  const item = await db.get('sync_queue', id);
  if (!item) return;
  await db.put('sync_queue', {
    ...item,
    attempts: item.attempts + 1,
    lastError: error,
    notBefore: nextNotBefore,
  });
}

export async function dequeueSync(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('sync_queue', id);
}

// ── Maintenance ─────────────────────────────────────────────────

/**
 * Wipe everything. Called on logout so a different driver on the same
 * device can't see the previous driver's queued DVIRs.
 */
export async function wipeAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['trips', 'dvir', 'dvir_photos', 'behavior_events', 'sync_queue'] as StoreNames<DriverOfflineDB>[],
    'readwrite',
  );
  for (const store of ['trips', 'dvir', 'dvir_photos', 'behavior_events', 'sync_queue'] as const) {
    await tx.objectStore(store).clear();
  }
  await tx.done;
}

/**
 * Storage estimate. Surfaced in the "Storage" settings page so a driver
 * with hundreds of unsynced photos knows they need to come back into
 * coverage.
 */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
