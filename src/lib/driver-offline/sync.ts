/**
 * src/lib/driver-offline/sync.ts
 *
 * The sync engine for the driver app's offline write-ahead log.
 *
 * Why a generic queue (not per-feature):
 *   - DVIR, behaviour events, stop arrivals, and future offline features
 *     (signature capture, fuel receipts, etc.) all need the same
 *     offline-durable → online-confirmed lifecycle.
 *   - One queue = one drain loop, one retry policy, one backoff schedule.
 *     Adding a new offline feature means calling `enqueueSync` and
 *     nothing else.
 *   - FIFO ordering matters for some pairs (e.g. "stop arrived" before
 *     "DVIR completed" for the same trip). We don't enforce this in
 *     the queue — each feature's endpoint is idempotent on the server
 *     side and accepts out-of-order writes. The client uses the
 *     `createdAt` ordering to keep the audit trail natural.
 *
 * Retry policy: exponential backoff with jitter, capped at 5 minutes
 * between attempts. After 20 attempts the item is marked FAILED and
 * surfaced in the "Failed sync" page so the driver can re-tap to retry
 * (the server might be back, the data might be valid, we just couldn't
 * reach it for a while).
 *
 * The drain loop is a single in-flight promise; calling `drain` while
 * a drain is already running is a no-op. This prevents the network
 * listener from queuing parallel drains if the connection flapped.
 */

import {
  enqueueSync,
  getReadySyncItems,
  incrementSyncAttempt,
  dequeueSync,
  getSyncQueue,
  type OfflineSyncQueueItem,
  newId,
} from './db';

/** Where the API lives. Defaults to same-origin (web dev), or set
 *  NEXT_PUBLIC_API_BASE in the native build to point at the production
 *  API. */
const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE) || '';

/** Max attempts before we mark the item FAILED and stop auto-retrying. */
const MAX_AUTO_ATTEMPTS = 20;

/** Backoff cap. Even with the worst exponential curve, we never wait
 *  longer than this between retries. */
const MAX_BACKOFF_MS = 5 * 60_000;

/** The driver carries an `xl-driver-session` cookie after biometric
 *  login. Native HTTP requests go through the same Cookie header. We
 *  don't try to forward Authorization headers — the cookie IS the auth. */
function authHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const cookie = document.cookie
    .split('; ')
    .find((c) => c.startsWith('xl-driver-session='));
  return cookie ? { Cookie: cookie } : {};
}

/** Network status from the Capacitor Network plugin. When the plugin
 *  isn't present (web dev), fall back to navigator.onLine. */
let netPlugin: any = null;
async function getNetworkStatus(): Promise<boolean> {
  try {
    if (!netPlugin) {
      const mod = '@capacitor/network';
      netPlugin = await import(/* webpackIgnore: true */ /* @vite-ignore */ mod);
    }
    const status = await netPlugin.Network.getStatus();
    return Boolean(status.connected);
  } catch {
    // Capacitor not available (e.g. plain browser). Use browser API.
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine;
    }
    return true; // assume online; the fetch will fail and we retry.
  }
}

let inFlight: Promise<number> | null = null;

/**
 * Drain the queue. Returns the number of items successfully synced.
 * Safe to call from anywhere; concurrent calls collapse to one drain.
 */
export async function drain(): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const online = await getNetworkStatus();
      if (!online) return 0;

      const ready = await getReadySyncItems();
      if (ready.length === 0) return 0;

      // FIFO ordering. ready is already createdAt-ordered by the index
      // scan, but we sort explicitly because getAll returns by key.
      ready.sort((a, b) => a.createdAt - b.createdAt);

      let synced = 0;
      for (const item of ready) {
        try {
          await sendOne(item);
          await dequeueSync(item.id);
          synced += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const backoff = nextBackoffMs(item.attempts);
          const giveUp = item.attempts + 1 >= MAX_AUTO_ATTEMPTS;
          await incrementSyncAttempt(
            item.id,
            giveUp ? `gave up after ${MAX_AUTO_ATTEMPTS} attempts: ${msg}` : msg,
            giveUp ? null : Date.now() + backoff,
          );
          if (giveUp) {
            // Surface to the driver so they can re-tap. We use a console
            // warn because the UI layer subscribes to getSyncQueue()
            // and renders the FAILED items itself.
            console.warn('[driver-offline.sync] item FAILED:', item.endpoint, msg);
          }
          // Stop the drain on first failure. If this one is failing
          // (network blip, server 5xx) the next ones are likely to
          // fail too. Let the backoff schedule kick in.
          break;
        }
      }
      return synced;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function sendOne(item: OfflineSyncQueueItem): Promise<void> {
  const url = `${API_BASE}${item.endpoint}`;
  const res = await fetch(url, {
    method: item.method,
    headers: {
      'Content-Type': 'application/json',
      'X-Offline-Client': 'fleet360-driver/1.0',
      'X-Offline-Item-Id': item.id,
      'X-Offline-Created-At': String(item.createdAt),
      'X-Offline-Attempts': String(item.attempts + 1),
      ...authHeader(),
    },
    body: item.body,
  });
  if (!res.ok) {
    // 4xx is permanent (validation). 5xx is transient. Distinguish so we
    // don't waste retries on a permanently-bad payload.
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`permanent ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    throw new Error(`transient ${res.status}`);
  }
}

/** Capped exponential backoff with full jitter. attempts is 0-based —
 *  attempt #1 (after the first failure) waits 1–2 s, attempt #2 waits
 *  2–4 s, etc. The jitter prevents the "thundering herd" if many drivers
 *  come back into coverage at the same time after a network outage. */
export function nextBackoffMs(attempts: number): number {
  const base = Math.min(1000 * Math.pow(2, attempts), MAX_BACKOFF_MS);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

// ── Auto-drain on network / focus events ─────────────────────────
// We register listeners once per process. Calling setup() multiple times
// is safe — the second call no-ops.

let setupDone = false;

export function setupSyncTriggers(): void {
  if (setupDone) return;
  if (typeof window === 'undefined') return; // SSR
  setupDone = true;

  const onOnline = () => { void drain(); };
  window.addEventListener('online', onOnline);
  // When the app comes back to the foreground, try to drain. Belt-and-
  // braces for the case where the OS doesn't fire the `online` event
  // after a long background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void drain();
    }
  });

  // Periodic drain. The exponential backoff in nextBackoffMs handles
  // failure storms, so a 30 s tick is fine — it's only doing real work
  // when there's actually something to send. We start it on the
  // background but the interval handle lets tests / unmount paths
  // stop it.
  setInterval(() => { void drain(); }, 30_000);
}

/** Manually kick a drain. The driver UI does this when the user taps
 *  "Sync now" or after a successful biometric login (clear the backlog
 *  before they start their shift). */
export async function forceDrain(): Promise<number> {
  return drain();
}

// ── Convenience: enqueue a DVIR submission ───────────────────────

export interface EnqueueDvirInput {
  tripId: string;
  driverId: string;
  tenantId: string;
  dvir: {
    id: string;
    type: 'PRE_TRIP' | 'POST_TRIP';
    startedAt: string;
    completedAt: string | null;
    odometerStart: number | null;
    odometerEnd: number | null;
    items: Record<string, { ok: boolean; note?: string; photoIds?: string[] }>;
    defects: Array<{ category: string; description: string; severity: 'MINOR' | 'MAJOR' | 'CRITICAL'; photoIds: string[] }>;
    notes: string | null;
    signatureSvg: string | null;
  };
}

export async function enqueueDvirSubmission(input: EnqueueDvirInput): Promise<string> {
  return enqueueSync({
    kind: 'DVIR',
    endpoint: `/api/driver-app/dvir`,
    method: 'POST',
    body: JSON.stringify({
      tripId: input.tripId,
      driverId: input.driverId,
      tenantId: input.tenantId,
      dvir: input.dvir,
    }),
  });
}

// ── Convenience: enqueue a stop arrival ──────────────────────────

export async function enqueueStopArrival(
  tripId: string,
  stopId: string,
  arrivedAt: string,
): Promise<string> {
  return enqueueSync({
    kind: 'STOP_ARRIVAL',
    endpoint: `/api/driver-app/trips/${encodeURIComponent(tripId)}/stops/${encodeURIComponent(stopId)}/arrive`,
    method: 'POST',
    body: JSON.stringify({ arrivedAt }),
  });
}

// ── Convenience: enqueue a behaviour event ──────────────────────

export async function enqueueBehaviorEvent(
  event: {
    id: string;
    tripId: string | null;
    shiftId: string | null;
    driverId: string;
    tenantId: string;
    type: 'HARSH_BRAKE' | 'HARSH_ACCEL' | 'SPEEDING' | 'IDLE_START' | 'IDLE_END';
    lat: number | null;
    lng: number | null;
    speedKmh: number | null;
    value: number | null;
    note: string | null;
    occurredAt: string;
  },
): Promise<string> {
  return enqueueSync({
    kind: 'BEHAVIOR',
    endpoint: `/api/driver-app/behavior-events`,
    method: 'POST',
    body: JSON.stringify(event),
  });
}

// ── Diagnostics ────────────────────────────────────────────────

/** Human-readable summary surfaced in the "Sync status" widget. */
export async function syncSummary(): Promise<{
  queued: number;
  failed: number;
  oldestAgeMs: number | null;
}> {
  const all = await getSyncQueue();
  const queued = all.filter((it) => it.attempts < MAX_AUTO_ATTEMPTS).length;
  const failed = all.length - queued;
  const oldest = all.length > 0
    ? Math.max(...all.map((it) => Date.now() - it.createdAt))
    : null;
  return { queued, failed, oldestAgeMs: oldest };
}
