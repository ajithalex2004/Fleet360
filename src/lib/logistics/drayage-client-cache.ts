/**
 * Drayage Client-Side In-Memory Cache
 * Fleet360 Drayage Module
 *
 * Provides instant (<5ms) page transitions and Stale-While-Revalidate (SWR)
 * caching for all Port & Container Drayage sub-pages.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CacheStore {
  data: any | null;
  timestamp: number;
  inflightPromise: Promise<any> | null;
}

const cacheStore: CacheStore = {
  data: null,
  timestamp: 0,
  inflightPromise: null,
};

const DEFAULT_TTL_MS = 25_000; // 25 seconds TTL for background freshness

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
 * Fetch drayage workspace data with instant memory resolution and inflight deduplication.
 */
export async function fetchDrayageWorkspaceCached(options?: {
  forceFresh?: boolean;
  ttlMs?: number;
}): Promise<any> {
  const forceFresh = options?.forceFresh ?? false;
  const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
  const isFresh = cacheStore.data && Date.now() - cacheStore.timestamp < ttl;

  if (!forceFresh && isFresh) {
    return cacheStore.data;
  }

  // Deduplicate inflight requests if one is already running
  if (!forceFresh && cacheStore.inflightPromise) {
    return cacheStore.inflightPromise;
  }

  cacheStore.inflightPromise = (async () => {
    try {
      const res = await fetch('/api/logistics/drayage', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || 'Failed to fetch drayage workspace');
      }
      const data = await res.json();
      cacheStore.data = data;
      cacheStore.timestamp = Date.now();
      return data;
    } finally {
      cacheStore.inflightPromise = null;
    }
  })();

  return cacheStore.inflightPromise;
}
