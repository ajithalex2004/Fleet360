/**
 * Drayage Client-Side In-Memory Cache + Real-Time SSE Stream Coordinator
 * Fleet360 Drayage Module
 *
 * Provides instant (<5ms) page transitions, ETag / 304 Not Modified conditional
 * revalidation, and a shared EventSource('/api/logistics/drayage/stream')
 * real-time push channel for all Port & Container Drayage sub-pages.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CacheStore {
  data: any | null;
  etag: string | null;
  timestamp: number;
  inflightPromise: Promise<any> | null;
}

const cacheStore: CacheStore = {
  data: null,
  etag: null,
  timestamp: 0,
  inflightPromise: null,
};

const DEFAULT_TTL_MS = 25_000; // 25 seconds TTL for background freshness

type ClientStreamListener = (data: any, event?: any) => void;
const streamListeners = new Set<ClientStreamListener>();
let activeEventSource: EventSource | null = null;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Returns currently cached drayage data synchronously (or null if not yet fetched)
 */
export function getCachedDrayageData(): any | null {
  return cacheStore.data;
}

/**
 * Invalidate the client-side cache so the next fetch reaches the server
 */
export function invalidateDrayageClientCache(): void {
  cacheStore.data = null;
  cacheStore.etag = null;
  cacheStore.timestamp = 0;
  cacheStore.inflightPromise = null;
}

/**
 * Manually update the client cache after a successful mutation
 */
export function updateDrayageClientCache(updater: (prev: any) => any): void {
  if (cacheStore.data) {
    cacheStore.data = updater(cacheStore.data);
    cacheStore.timestamp = Date.now();
  }
}

/**
 * Set the client cache explicitly
 */
export function setDrayageClientCache(data: any): void {
  cacheStore.data = data;
  cacheStore.timestamp = Date.now();
}

/**
 * Fetch drayage workspace data with instant memory resolution, inflight deduplication,
 * and ETag / 304 Not Modified conditional requests.
 */
export async function fetchDrayageWorkspaceCached(options?: {
  forceFresh?: boolean;
  ttlMs?: number;
  scope?: 'full' | 'jobs' | 'master' | 'telemetry';
}): Promise<any> {
  const forceFresh = options?.forceFresh ?? false;
  const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
  const scope = options?.scope ?? 'full';
  const isFresh = cacheStore.data && Date.now() - cacheStore.timestamp < ttl;

  if (!forceFresh && isFresh && scope === 'full') {
    return cacheStore.data;
  }

  // Deduplicate inflight requests if one is already running
  if (!forceFresh && cacheStore.inflightPromise && scope === 'full') {
    return cacheStore.inflightPromise;
  }

  const runFetch = async () => {
    try {
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
      if (!forceFresh && cacheStore.etag && cacheStore.data && scope === 'full') {
        headers['If-None-Match'] = cacheStore.etag;
      }
      const url = scope === 'full' ? '/api/logistics/drayage' : `/api/logistics/drayage?scope=${scope}`;
      const res = await fetch(url, { headers });
      if (res.status === 304 && cacheStore.data) {
        cacheStore.timestamp = Date.now();
        return cacheStore.data;
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || 'Failed to fetch drayage workspace');
      }
      const responseEtag = res.headers.get('etag');
      const data = await res.json();
      if (scope === 'full') {
        cacheStore.data = data;
        cacheStore.etag = responseEtag;
        cacheStore.timestamp = Date.now();
      }
      return data;
    } finally {
      if (scope === 'full') {
        cacheStore.inflightPromise = null;
      }
    }
  };

  if (scope === 'full') {
    cacheStore.inflightPromise = runFetch();
    return cacheStore.inflightPromise;
  }
  return runFetch();
}

function ensureSharedEventSource(): void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  if (activeEventSource) return;

  try {
    const es = new EventSource('/api/logistics/drayage/stream');
    activeEventSource = es;

    es.addEventListener('drayage_update', (msg: MessageEvent) => {
      let evt: any = null;
      try {
        evt = JSON.parse(msg.data);
      } catch {
        return;
      }

      // Fast-path in-place update for live vehicle GPS pings without full DB reload
      if (evt?.type === 'telemetry_ping' && evt.vehicleId && typeof evt.lat === 'number' && typeof evt.lng === 'number') {
        if (cacheStore.data) {
          const updatedVehicles = Array.isArray(cacheStore.data.vehicles)
            ? cacheStore.data.vehicles.map((v: any) =>
                v.id === evt.vehicleId ? { ...v, lat: evt.lat, lng: evt.lng, currentLat: evt.lat, currentLng: evt.lng } : v,
              )
            : cacheStore.data.vehicles;
          const updatedJobs = Array.isArray(cacheStore.data.jobs)
            ? cacheStore.data.jobs.map((j: any) =>
                j.assignedVehicleId === evt.vehicleId ? { ...j, currentLat: evt.lat, currentLng: evt.lng } : j,
              )
            : cacheStore.data.jobs;
          cacheStore.data = {
            ...cacheStore.data,
            vehicles: updatedVehicles,
            jobs: updatedJobs,
          };
          for (const listener of streamListeners) {
            try {
              listener(cacheStore.data, evt);
            } catch {
              // ignore
            }
          }
          return;
        }
      }

      // State mutation -> coalesce burst events within 150ms and fetch fresh workspace
      cacheStore.etag = null;
      cacheStore.timestamp = 0;
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = setTimeout(async () => {
        try {
          const fresh = await fetchDrayageWorkspaceCached({ forceFresh: true });
          for (const listener of streamListeners) {
            try {
              listener(fresh, evt);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore transient network errors
        }
      }, 150);
    });

    es.onerror = () => {
      // Browser EventSource automatically reconnects
    };
  } catch {
    activeEventSource = null;
  }
}

/**
 * Subscribe a UI page to live Server-Sent Events from `/api/logistics/drayage/stream`.
 * Automatically manages a single shared EventSource connection across components.
 */
export function subscribeDrayageLiveUpdates(listener: ClientStreamListener): () => void {
  streamListeners.add(listener);
  ensureSharedEventSource();

  return () => {
    streamListeners.delete(listener);
    if (streamListeners.size === 0 && activeEventSource) {
      try {
        activeEventSource.close();
      } catch {
        // ignore
      }
      activeEventSource = null;
    }
  };
}
