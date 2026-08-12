/**
 * Server-side read cache for reference data.
 *
 * Why this exists:
 *   The /admin/* read APIs (roles, permissions, plans, tenants) are
 *   reference data — same response for every user, changes rarely.
 *   Without caching, every page load runs 2-5 Prisma queries with RLS
 *   context switches, which adds 100-500ms each on a warm connection
 *   and much more on cold start. For an admin navigating between
 *   /admin/roles, /admin/tenants, /admin/users, that stacks to 3-5s
 *   per page — which is the user-reported pain.
 *
 * What it does:
 *   - Wraps a read function with `unstable_cache` so the result is
 *     memoized across requests on the same Node process AND tagged
 *     for the Next.js Data Cache (CDN, ISR, etc.) when revalidatePath
 *     or revalidateTag is called.
 *   - Provides `revalidate(tags)` and `bustTags(tags)` helpers so
 *     write routes can invalidate in O(1) without depending on the
 *     exact cache key.
 *   - Adds the canonical `Cache-Control` header (`s-maxage` for CDN,
 *     `stale-while-revalidate` so the next request doesn't wait).
 *
 * When NOT to use it:
 *   - User-specific data (anything filtered by userId/tenantId that
 *     differs per requester) — `s-maxage` would leak data across users.
 *     For per-user data, use the browser `private` directive only.
 *   - Real-time data (audit logs, live dashboards) — the TTL would
 *     hide fresh data from the user.
 *   - Write operations — these are already one-shot.
 *
 * Pair with the CDN `Cache-Control: public, s-maxage=N, stale-while-revalidate=M`
 * header on the API route. The header controls the CDN behavior; the
 * unstable_cache controls the origin behavior. Together they give
 * microsecond responses at the edge, millisecond at the origin, and
 * the source of truth stays the DB.
 */

import { unstable_cache, revalidateTag } from 'next/cache';

/** Default revalidate window (seconds) for the Next.js Data Cache. */
export const DEFAULT_REVALIDATE_SECONDS = 60;
/** Default stale-while-revalidate window (seconds) for the CDN. */
export const DEFAULT_SWR_SECONDS = 300;

/**
 * Wrap a read function with Next.js Data Cache + tag-based invalidation.
 *
 * @param fn       The async read function (must be self-contained, no closures over request state)
 * @param tags     Tags for cache invalidation. Pick stable names like 'roles', 'permissions', 'plans:public'
 * @param revalidate  Seconds before the cache entry is considered stale. 60s is a good default.
 *
 * Usage:
 *   const getRoles = cacheRead(
 *     (tenantId: string | null) => prisma.role.findMany({ where: ... }),
 *     ['roles'],
 *   );
 *   const roles = await getRoles(null); // cached for 60s
 *
 *   // Invalidate on write:
 *   await revalidateCache(['roles']);
 */
export function cacheRead<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  tags: string[],
  revalidate: number = DEFAULT_REVALIDATE_SECONDS,
): (...args: TArgs) => Promise<TResult> {
  return unstable_cache(fn, tags, { tags, revalidate }) as (...args: TArgs) => Promise<TResult>;
}

/**
 * Invalidate one or more cache tags. Use this from write routes after
 * a mutation so the next read picks up fresh data immediately.
 *
 * Wraps Next.js `revalidateTag` so call sites don't need to import
 * from `next/cache` directly. Returns the same Promise so you can
 * `await` it in a transaction callback.
 */
export async function revalidateCache(tags: string | string[]): Promise<void> {
  const arr = Array.isArray(tags) ? tags : [tags];
  for (const t of arr) revalidateTag(t);
}

/**
 * Build the canonical `Cache-Control` header for a public, cacheable
 * read endpoint. Use `public` (not `private`) so the CDN can store it
 * and serve at the edge. `s-maxage` is the freshness window at the CDN;
 * `stale-while-revalidate` is the window during which the CDN can
 * serve stale while it refetches in the background.
 *
 * Pair with `cacheRead()` on the origin. The two together give you
 * edge-microsecond reads.
 */
export function publicCacheControl(
  sMaxAge: number = DEFAULT_REVALIDATE_SECONDS,
  swr: number = DEFAULT_SWR_SECONDS,
): string {
  return `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
}

/**
 * Build the `Cache-Control` header for tenant-scoped data.
 *
 * Use this — NOT `publicCacheControl` — when the response varies by
 * tenant. The URL alone doesn't carry the tenantId, so a `public` CDN
 * cache would leak data across tenants. `private` tells the CDN to
 * keep its hands off and only let the browser cache the response for
 * this single user. The origin-side `unstable_cache` still gives us
 * microsecond reads for repeated server-rendered requests.
 */
export function privateCacheControl(
  maxAge: number = DEFAULT_REVALIDATE_SECONDS,
  swr: number = DEFAULT_SWR_SECONDS,
): string {
  return `private, max-age=${maxAge}, stale-while-revalidate=${swr}`;
}
