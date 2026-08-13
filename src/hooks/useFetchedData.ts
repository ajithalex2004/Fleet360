/**
 * useFetchedData — session-scoped fetch cache for the admin pages.
 *
 * Why this exists:
 *   The /admin/* pages fetch the same data on every mount. The server
 *   already has Data Cache (unstable_cache + s-maxage) so the origin
 *   is fast, but the client still re-fetches on every navigation:
 *   mount → fetch → render → unmount → re-mount → fetch again.
 *
 *   This hook adds an in-memory session cache (Map, lives for the JS
 *   runtime) so:
 *     - within a session, a second call to the same URL returns the
 *       cached promise immediately (no re-fetch, no flicker)
 *     - on tab close, the cache is gone (no stale data across sessions)
 *     - a manual `invalidate(url)` or `invalidatePrefix('/api/admin/roles')`
 *       lets a mutation route (PUT /api/admin/roles/[id]/permissions)
 *       force a re-fetch
 *
 *   Pair with the API-level Cache-Control: the server is fast AND the
 *   client doesn't re-fetch when nothing changed.
 *
 * When NOT to use it:
 *   - Real-time data (audit logs, live counters) — pass a `ttlMs` to
 *     bound the cache lifetime
 *   - Mutations (POST/PUT/DELETE) — use plain `fetch`
 *   - User-specific data that the same tab can have different views of
 *     (the cache is keyed by URL only, not by user)
 */

'use client';

import { useEffect, useSyncExternalStore, useCallback } from 'react';

type Snapshot = { data: unknown; error: unknown; loading: boolean };

type CacheEntry = {
  promise?: Promise<unknown>;
  data?: unknown;
  error?: unknown;
  // Stable snapshot reference. We replace this object only when data
  // or error change, so useSyncExternalStore's getSnapshot() can
  // return the SAME reference until then. React compares snapshots
  // with Object.is; a new object literal each call triggers the
  // "result of getSnapshot should be cached" infinite-loop warning.
  snapshot: Snapshot;
};

// URL → cache entry
const cache = new Map<string, CacheEntry>();

// Subscribers per URL — notify them when the cache mutates.
const subs = new Map<string, Set<() => void>>();

function notify(url: string) {
  subs.get(url)?.forEach(fn => fn());
}

// Module-level stable snapshot for the "no entry yet" case. Same
// reference returned every time getSnapshot is called when no fetch
// is in flight for this URL.
const EMPTY: Snapshot = { data: undefined, error: undefined, loading: true };

function buildSnapshot(entry: { data?: unknown; error?: unknown }): Snapshot {
  return {
    data: entry.data,
    error: entry.error,
    loading: entry.data === undefined && entry.error === undefined,
  };
}

/**
 * Get-or-create the cached fetch for a URL. If the URL is already
 * in-flight or resolved, return the existing promise. Otherwise start
 * a new fetch and cache the promise.
 */
function getOrCreate<T>(url: string, init?: RequestInit): Promise<T> {
  const existing = cache.get(url);
  if (existing?.promise) return existing.promise as Promise<T>;

  const entry: CacheEntry = {
    snapshot: EMPTY, // overwritten when the fetch resolves
  };

  const promise = fetch(url, init)
    .then(async (res) => {
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        entry.error = err;
        entry.snapshot = buildSnapshot(entry);
        notify(url);
        throw err;
      }
      const data = await res.json();
      entry.data = data;
      entry.snapshot = buildSnapshot(entry);
      notify(url);
      return data;
    })
    .catch((err) => {
      entry.error = err;
      entry.snapshot = buildSnapshot(entry);
      notify(url);
      throw err;
    });

  entry.promise = promise;
  cache.set(url, entry);
  notify(url);
  return promise as Promise<T>;
}

/**
 * Imperative version of useFetchedData — use this in event handlers
 * (e.g. selectRole) where you just need the JSON, not a subscription.
 * Same session-scoped cache, same invalidation rules.
 */
export function fetchOnce<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  return getOrCreate<T>(url, init);
}

/**
 * Invalidate cached entries. Either pass exact URLs or use `invalidatePrefix`
 * to bust everything under a path (e.g. after a write to /api/admin/roles).
 */
export function invalidate(url: string): void {
  cache.delete(url);
  notify(url);
}

export function invalidatePrefix(prefix: string): void {
  for (const url of cache.keys()) {
    if (url.startsWith(prefix)) {
      cache.delete(url);
      notify(url);
    }
  }
}

export function invalidateAll(): void {
  cache.clear();
  for (const url of subs.keys()) notify(url);
}

/**
 * Subscribe to a URL's cache entry. Returns the current data, error,
 * and loading state. Re-renders when the entry changes.
 *
 * Usage:
 *   const { data, error, loading } = useFetchedData<Role[]>('/api/admin/roles');
 *   if (loading) return <Spinner />;
 *   if (error)   return <Error err={error} />;
 *   return <List roles={data} />;
 *
 * Passing `null` or `undefined` is allowed — the hook returns the EMPTY
 * snapshot and skips the fetch. Useful when the URL depends on a
 * selection (e.g. the selected route id for headway rules).
 */
export function useFetchedData<T = unknown>(url: string | null | undefined): {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
} {
  // useSyncExternalStore gives us a stable subscription to the cache
  // map. getSnapshot returns entry.snapshot — a stable reference that
  // is only replaced when data/error change. This satisfies React's
  // requirement that getSnapshot be referentially stable.
  const safeUrl = url ?? '__none__';
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!subs.has(safeUrl)) subs.set(safeUrl, new Set());
    subs.get(safeUrl)!.add(onStoreChange);
    return () => { subs.get(safeUrl)?.delete(onStoreChange); };
  }, [safeUrl]);

  const getSnapshot = useCallback(() => {
    if (!url) return EMPTY;
    const entry = cache.get(url);
    return entry ? entry.snapshot : EMPTY;
  }, [url]);

  const getServerSnapshot = useCallback(() => EMPTY, []);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!url) return;
    // Kick off the fetch if not already in flight.
    getOrCreate<T>(url);
  }, [url]);

  const refresh = useCallback(() => {
    if (!url) return;
    invalidate(url);
    getOrCreate<T>(url);
  }, [url]);

  return { ...snapshot, data: snapshot.data as T | undefined, refresh };
}
