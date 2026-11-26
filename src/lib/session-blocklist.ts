/**
 * Session revocation blocklist backed by Upstash Redis (Edge-safe hot path).
 *
 * Durable persistence lives in PostgreSQL `revoked_session_tokens`
 * (`src/lib/auth/durable-session-revocation.ts`). Upstash Redis mirrors both
 * the shared session identifier (`blocklist:sid:<sid>`) and the raw token
 * fingerprint (`blocklist:sess:<sha256>`) so Edge middleware can reject
 * revoked tokens in sub-millisecond time without a TCP Postgres socket.
 *
 * Key formats:
 *   blocklist:sess:<SHA-256 hex of raw token>
 *   blocklist:sid:<UUIDv4 session id (matches JWT jti)>
 * TTL: remaining token lifetime (auto-expires when the token expires).
 */

import { getRedis } from '@/lib/upstash';

export const SESSION_TOKEN_KEY_PREFIX = 'blocklist:sess:';
export const SESSION_SID_KEY_PREFIX = 'blocklist:sid:';
/**
 * Redis hydration sentinel written by `rehydrateRevocationsToRedis()` once
 * active PostgreSQL revocations have been mirrored into Redis. In production,
 * its absence indicates a cold/flushed/restarted Redis cache and causes Edge
 * verification to fail closed until hydration completes.
 */
export const REVOCATION_HYDRATED_KEY = 'revocation:hydrated:v1';

// ── helpers ───────────────────────────────────────────────────────────────────

/** SHA-256 lowercase hex fingerprint of an opaque token string (Edge-safe). */
export async function tokenFingerprint(token: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── public API ────────────────────────────────────────────────────────────────

export type RevokeSessionResult =
  | { ok: true; persisted: 'redis' | 'unconfigured' }
  | { ok: false; persisted: 'failed'; error: string };

async function writeRedisKeys(keys: string[], ttlSec: number): Promise<RevokeSessionResult> {
  const redis = getRedis();
  if (!redis) {
    return { ok: true, persisted: 'unconfigured' };
  }

  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    const writes = Promise.all(keys.map(key => redis.set(key, '1', { ex: ttlSec })));
    // Prevent late rejection after timeout from becoming UnhandledPromiseRejection.
    writes.catch(() => {});
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error('Redis revocation write timed out after 2000ms')), 2_000);
    });
    await Promise.race([writes, timeout]);
    return { ok: true, persisted: 'redis' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[session-blocklist] revokeSession failed:', err);
    return { ok: false, persisted: 'failed', error: message };
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

/**
 * Mirror a revoked token (and optional shared `sid`) to the Redis blocklist.
 *
 * @param token      The raw xl-session (or backend JWT) token string.
 * @param expiresAt  Unix epoch ms when the token expires.
 * @param sid        Optional shared UUIDv4 session id (`sid` / JWT `jti`).
 */
export async function revokeSession(
  token: string,
  expiresAt: number,
  sid?: string | null,
): Promise<RevokeSessionResult> {
  const ttlSec = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  const keys = [SESSION_TOKEN_KEY_PREFIX + (await tokenFingerprint(token))];
  const cleanSid = typeof sid === 'string' ? sid.trim() : '';
  if (cleanSid) {
    keys.push(SESSION_SID_KEY_PREFIX + cleanSid);
  }
  return writeRedisKeys(keys, ttlSec);
}

/**
 * Mirror a single pre-formatted blocklist key (`blocklist:sid:...` or
 * `blocklist:sess:...`) to Redis. Used by durable-revocation self-healing
 * backfill and rehydration after Redis outages.
 */
export async function revokeSessionKeyInRedis(
  redisKey: string,
  expiresAt: number,
): Promise<RevokeSessionResult> {
  const ttlSec = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  return writeRedisKeys([redisKey], ttlSec);
}

function unavailable(why: unknown): boolean {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[session-blocklist] isSessionRevoked failed (allowing outside production):', why);
    return false;
  }
  console.error('[session-blocklist] isSessionRevoked failed; refusing the token (fail closed):', why);
  return true;
}

function mustRequireRedisInProduction(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  if (process.env.REQUIRE_REDIS_REVOCATION === 'true') return true;
  if (process.env.RAILWAY_ENVIRONMENT_NAME === 'production') return true;
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? '';
  const rawToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? '';
  // Isolated CI / Playwright explicitly disables Upstash via the 'disabled'
  // sentinel (allowed in src/lib/env.ts) while Postgres durable guards remain
  // active. Railway production & REQUIRE_REDIS_REVOCATION=true above still
  // fail closed unconditionally regardless of sentinel values.
  if (rawUrl.toLowerCase() === 'disabled' && rawToken.toLowerCase() === 'disabled') {
    return false;
  }
  // Partial / malformed Upstash config must fail closed rather than degrade silently.
  if (Boolean(rawUrl) || Boolean(rawToken)) {
    return true;
  }
  return false;
}

/**
 * Returns true if the token or its shared `sid` has been explicitly revoked in
 * Redis. In production, any Redis read error, timeout, missing hydration
 * sentinel, or missing/broken Redis config on Railway production fails closed.
 */
export async function isSessionRevoked(token: string, sid?: string | null): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    if (mustRequireRedisInProduction()) {
      return unavailable('Redis not configured in production');
    }
    return false;
  }

  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    const tokenKey = SESSION_TOKEN_KEY_PREFIX + (await tokenFingerprint(token));
    const cleanSid = typeof sid === 'string' ? sid.trim() : '';
    const sidKey = cleanSid ? SESSION_SID_KEY_PREFIX + cleanSid : null;
    const requireHydrated = process.env.NODE_ENV === 'production';

    const keys = sidKey
      ? requireHydrated
        ? [tokenKey, sidKey, REVOCATION_HYDRATED_KEY]
        : [tokenKey, sidKey]
      : requireHydrated
        ? [tokenKey, REVOCATION_HYDRATED_KEY]
        : [tokenKey];

    let lookup: Promise<{ blocked: boolean; hydrated: boolean }>;
    if (keys.length > 1 && typeof redis.mget === 'function') {
      lookup = redis.mget<(string | number | null)[]>(...keys).then((vals) => {
        if (!Array.isArray(vals)) return { blocked: false, hydrated: !requireHydrated };
        const hydratedIdx = requireHydrated ? keys.length - 1 : -1;
        const blockSlice = hydratedIdx >= 0 ? vals.slice(0, hydratedIdx) : vals;
        const blocked = blockSlice.some((v) => v !== null && v !== undefined);
        const hydrated =
          !requireHydrated ||
          (vals[hydratedIdx] !== null && vals[hydratedIdx] !== undefined);
        return { blocked, hydrated };
      });
    } else if (keys.length === 1) {
      lookup = redis.get(tokenKey).then((val) => ({
        blocked: val !== null && val !== undefined,
        hydrated: true,
      }));
    } else {
      lookup = Promise.all(keys.map((k) => redis.get(k))).then((vals) => {
        const hydratedIdx = requireHydrated ? vals.length - 1 : -1;
        const blockSlice = hydratedIdx >= 0 ? vals.slice(0, hydratedIdx) : vals;
        const blocked = blockSlice.some((v) => v !== null && v !== undefined);
        const hydrated =
          !requireHydrated ||
          (vals[hydratedIdx] !== null && vals[hydratedIdx] !== undefined);
        return { blocked, hydrated };
      });
    }
    lookup.catch(() => {});

    // A timeout resolves to undefined, distinct from lookup result.
    const timeout = new Promise<undefined>((resolve) => {
      timerId = setTimeout(() => resolve(undefined), 1000);
    });
    const res = await Promise.race([lookup, timeout]);
    if (res === undefined) return unavailable('timed out');
    if (res.blocked) return true;
    if (!res.hydrated) {
      return unavailable('Redis revocation mirror not hydrated from PostgreSQL');
    }
    return false;
  } catch (err) {
    return unavailable(err);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}
