/**
 * Is a session revoked? Sessions record when they were issued (iat); a
 * revocation (src/lib/auth/session-revocation.ts) records "not valid
 * before" for a user, a tenant, or a user in one tenant. A session issued
 * before any of the three applicable moments is revoked.
 *
 * Read from the Redis mirror, three keys in one MGET, cached per process for
 * REVOCATION_RECHECK_MS: a revocation reaches every instance within that
 * interval.
 *
 * When Redis is configured but a check fails or times out, the last answer
 * for that user and tenant is used if it is under STALE_GRACE_MS old.
 * Without one, production refuses the session (fail closed): it used to
 * allow it, so a revoked session — a deactivated user, a removed role —
 * kept working for as long as Redis was unreachable. Development still
 * allows, with a warning. When Redis is not configured at all the check is
 * a no-op; /api/health reports that as degraded.
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

/** How old a cached answer may be and still stand in for a failed check. */
export const STALE_GRACE_MS = 10 * 60_000;

const cache = new Map<string, { notBefore: number; fetchedAt: number }>();

/** A not-before that revokes every session: the check could not be made. */
const REFUSE = Number.MAX_SAFE_INTEGER;

function unavailable(hit: { notBefore: number; fetchedAt: number } | undefined, now: number, why: unknown): number {
  if (hit && now - hit.fetchedAt < STALE_GRACE_MS) return hit.notBefore;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[revocation] check failed (allowing outside production):', why);
    return 0;
  }
  console.error('[revocation] check failed; refusing the session (fail closed):', why);
  return REFUSE;
}
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
    if (!values) return unavailable(hit, now, 'timed out');
    const notBefore = Math.max(0, ...values.map((v) => Number(v) || 0));
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(cacheKey, { notBefore, fetchedAt: now });
    return notBefore;
  } catch (err) {
    return unavailable(hit, now, err);
  }
}

/** True when a session of `userId` in `tenantId` issued at `issuedAtMs` has been revoked. */
export async function isRevokedSince(userId: string, tenantId: string, issuedAtMs: number, now = Date.now()): Promise<boolean> {
  const notBefore = await notBeforeFor(userId, tenantId, now);
  return notBefore > 0 && issuedAtMs < notBefore;
}
