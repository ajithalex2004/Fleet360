/**
 * Is a session revoked? Sessions record when they were issued (iat); a
 * revocation (src/lib/auth/session-revocation.ts) records "not valid
 * before" for a user, a tenant, or a user in one tenant. A session issued
 * before any of the three applicable moments is revoked.
 *
 * Read from the Redis mirror, three keys in one MGET, cached per process for
 * REVOCATION_RECHECK_MS: a revocation reaches every instance within that
 * interval. Redis unavailable or erroring degrades to "not revoked" (the
 * 24-hour session lifetime still applies) with a warning, like the
 * per-token blocklist: an outage must not sign everyone out.
 *
 * Edge-runtime safe: used by verifySession() in middleware.
 */
import { getRedis } from '@/lib/upstash';

/** How stale a revocation check may be: the revocation interval. */
export const REVOCATION_RECHECK_MS = 60_000;

export const revocationKeys = (userId: string, tenantId: string) => [
  `sess:nbf:u:${userId}`,
  `sess:nbf:t:${tenantId}`,
  `sess:nbf:ut:${userId}:${tenantId}`,
];

const cache = new Map<string, { notBefore: number; fetchedAt: number }>();
const MAX_CACHE_ENTRIES = 10_000;

/** Tests only. */
export function clearRevocationCache(): void {
  cache.clear();
}

async function notBeforeFor(userId: string, tenantId: string, now: number): Promise<number> {
  const cacheKey = `${userId}:${tenantId}`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.fetchedAt < REVOCATION_RECHECK_MS) return hit.notBefore;

  const redis = getRedis();
  if (!redis) return 0;
  try {
    const lookup = redis.mget<(string | number | null)[]>(...revocationKeys(userId, tenantId));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000));
    const values = await Promise.race([lookup, timeout]);
    if (!values) return hit?.notBefore ?? 0;
    const notBefore = Math.max(0, ...values.map((v) => Number(v) || 0));
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(cacheKey, { notBefore, fetchedAt: now });
    return notBefore;
  } catch (err) {
    console.warn('[revocation] check failed (allowing):', err);
    return hit?.notBefore ?? 0;
  }
}

/** True when a session of `userId` in `tenantId` issued at `issuedAtMs` has been revoked. */
export async function isRevokedSince(userId: string, tenantId: string, issuedAtMs: number, now = Date.now()): Promise<boolean> {
  const notBefore = await notBeforeFor(userId, tenantId, now);
  return notBefore > 0 && issuedAtMs < notBefore;
}
