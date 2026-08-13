/**
 * fetchCached — tiny in-memory SWR-lite for client-side fetches.
 *
 * Solves two problems the logistics dashboard was hitting:
 *
 *   1. Panel remount fires a duplicate fetch. Example: /logistics has three
 *      panels that each `useEffect(fetch, [])` on mount. If you navigate
 *      away and back within a minute, each panel re-fires its fetch — three
 *      round-trips for the same data.
 *
 *   2. Concurrent identical requests go through the wire simultaneously.
 *      If two panels ever do happen to fetch the same URL (or React
 *      StrictMode double-invokes effects in dev), both calls hit the
 *      server and the dev server has to compile + handle them twice.
 *
 * What this does:
 *
 *   - If a fresh result is in the cache (within `ttlMs`), return it
 *     immediately. No network.
 *   - If a request is already in flight for the same URL, return the same
 *     promise. Concurrent callers share one network round-trip.
 *   - Otherwise fire a new fetch, store its promise, and resolve the value
 *     into the cache when it lands.
 *
 * Trade-offs vs full SWR:
 *
 *   - Manual cache (no React hooks, no revalidation-on-focus, no
 *     automatic garbage collection). Fine for a handful of endpoints;
 *     add an LRU if the cache grows.
 *   - Module-level singleton: shared across all callers in the tab. Not
 *     react-tree-scoped — but neither is `fetch` itself, so this matches
 *     user expectations.
 *   - Use `invalidate()` after mutations (POST/PATCH/DELETE) to keep the
 *     cache honest.
 */

interface CacheState {
  promise?: Promise<unknown>;
  data?: unknown;
  ts?: number;
  status: number;
}

const cache = new Map<string, CacheState>();

interface FetchCachedOptions {
  /** Time-to-live in milliseconds. Default 30s — long enough to dedupe
   *  panel remounts, short enough for live data to feel live. */
  ttlMs?: number;
  /** Skip the cache and force a fresh fetch. */
  force?: boolean;
}

const DEFAULT_TTL_MS = 30_000;

/**
 * Fetch JSON with cache + inflight dedupe.
 *
 * @example
 *   const data = await fetchCached<CoverageResponse>(
 *     '/api/logistics/rates/coverage?period=30',
 *   );
 */
export async function fetchCached<T>(
  url: string,
  init: RequestInit = {},
  options: FetchCachedOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  const existing = cache.get(url);

  // Cache hit (and not forced fresh) — return immediately.
  if (
    !options.force &&
    existing?.status === 200 &&
    existing.data !== undefined &&
    existing.ts !== undefined &&
    now - existing.ts < ttlMs
  ) {
    return existing.data as T;
  }

  // An identical request is already in flight — ride it.
  if (existing?.promise) {
    return existing.promise as Promise<T>;
  }

  // New request: store the promise so concurrent callers dedupe to it.
  const promise = (async () => {
    const res = await fetch(url, { cache: 'no-store', ...init });
    if (!res.ok) {
      throw new Error(`fetchCached ${url} failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as T;
    cache.set(url, { data, ts: Date.now(), status: res.status });
    return data;
  })();

  cache.set(url, { promise, status: 0 });

  try {
    return await promise;
  } catch (err) {
    // Don't poison the cache with a rejected promise — clear it so a retry
    // can take a fresh shot.
    if (cache.get(url)?.promise === promise) cache.delete(url);
    throw err;
  }
}

/** Drop cached entries. Pass a URL prefix to drop one family (e.g. after a
 *  mutation against `/api/logistics/stats` you might want to invalidate
 *  every dashboard-derived stats view). */
export function invalidate(urlPrefix?: string): void {
  if (!urlPrefix) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(urlPrefix)) cache.delete(key);
  }
}

/** True if a fresh value for this URL is already cached. Useful for
 *  tests / dev tooling; not normally needed at call sites. */
export function hasCached(url: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const e = cache.get(url);
  if (!e || e.ts === undefined || e.data === undefined) return false;
  return Date.now() - e.ts < ttlMs;
}

/** Read-only view of the cache. Useful for debugging — pass to React
 *  DevTools or to a temporary debug overlay. */
export function cacheSnapshot(): Array<{ url: string; ageMs: number; status: number }> {
  const now = Date.now();
  return [...cache.entries()].map(([url, e]) => ({
    url,
    ageMs: e.ts !== undefined ? now - e.ts : -1,
    status: e.status,
  }));
}
