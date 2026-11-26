/**
 * Durable PostgreSQL-backed session & token revocation (Track C).
 *
 * Node.js runtime ONLY — NEVER import this file from Edge middleware
 * (`src/middleware.ts`). Edge middleware reads the Upstash Redis mirror
 * (`src/lib/session-blocklist.ts` & `src/lib/auth/revocation-check.ts`).
 *
 * Design invariants:
 *  1. Single-device logout writes durably to `public.revoked_session_tokens`
 *     FIRST inside a single atomic `withPlatformAdmin` transaction, then
 *     mirrors to Upstash Redis (`blocklist:sid:<sid>` & `blocklist:sess:<sha256>`)
 *     and stamps `redis_synced_at = now()` on successful Redis mirror.
 *  2. Paired Next.js (`xl-session`, `xl-driver-session`) and Go (`backendToken`)
 *     tokens share one UUIDv4 `sid` (JWT `jti`), persisted as `sid:<uuid>` along
 *     with `tok:<sha256>` for legacy/standalone token compatibility.
 *  3. Reads execute under `withTenantRls(prisma, tenantId, ...)` so Tenant A can
 *     NEVER inspect Tenant B's revocation records under PostgreSQL FORCE RLS.
 *  4. Active outbox + sentinel rehydration:
 *     - `instrumentation-node.ts` calls `startRevocationSyncLoop()` on boot,
 *       mirroring active PostgreSQL revocations into Redis and setting the
 *       hydration sentinel `revocation:hydrated:v1`.
 *     - Whenever a Redis write fails during logout or bulk revocation, rows
 *       remain `redis_synced_at IS NULL` and `scheduleRevocationRedisSync()`
 *       drains them as soon as Redis recovers (supplemented by the 15 s loop).
 *     - On any Node.js durable hit, Redis is self-healed immediately.
 *  5. In production (`NODE_ENV === 'production'`), a PostgreSQL revocation read
 *     failure fails closed (`revoked: true`).
 */

import { prisma } from '@/lib/prisma';
import { SessionRevokedError, withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { getRedis } from '@/lib/upstash';
import * as sessionBlocklist from '@/lib/session-blocklist';
import { clearRevocationCache, revocationKeys } from '@/lib/auth/revocation-check';
import { verifySession, type VerifiedSession } from '@/lib/tenant-session';

export { SessionRevokedError };

export const DURABLE_SID_PREFIX = 'sid:';
export const DURABLE_TOK_PREFIX = 'tok:';

const SESSION_TOKEN_KEY_PREFIX = 'blocklist:sess:';
const SESSION_SID_KEY_PREFIX = 'blocklist:sid:';
const REVOCATION_HYDRATED_KEY = 'revocation:hydrated:v1';

const DEFAULT_PRUNE_BATCH = 100;
const MIRROR_TTL_SECONDS = 25 * 60 * 60;
const SYNC_LOOP_INTERVAL_MS = 15_000;

/**
 * In non-production unit tests that explicitly stub `@/lib/prisma` as `{}` while
 * mocking `withTenantRls` to assert business-logic transaction boundaries, skip
 * opening an extra `withTenantRls` transaction. In production (`NODE_ENV === 'production'`)
 * this ALWAYS returns false so durable checks never bypass fail-closed enforcement.
 */
function isEmptyTestPrismaStub(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const p = prisma as { $transaction?: unknown; $queryRawUnsafe?: unknown } | null | undefined;
  return !p || (typeof p.$transaction !== 'function' && typeof p.$queryRawUnsafe !== 'function');
}

/** Local SHA-256 hex digest (safe even when unit tests partially mock `@/lib/session-blocklist`). */
async function computeTokenSha256(rawToken: string): Promise<string> {
  if (typeof sessionBlocklist.tokenFingerprint === 'function') {
    return sessionBlocklist.tokenFingerprint(rawToken);
  }
  const buf = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawToken),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function mirrorSingleKeyToRedis(
  redisKey: string,
  expiresAtMs: number,
): Promise<{ ok: boolean; persisted: 'redis' | 'unconfigured' | 'failed' }> {
  if (typeof sessionBlocklist.revokeSessionKeyInRedis === 'function') {
    return sessionBlocklist.revokeSessionKeyInRedis(redisKey, expiresAtMs);
  }
  const redis = getRedis();
  if (!redis) return { ok: true, persisted: 'unconfigured' };
  const ttlSec = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
  try {
    await redis.set(redisKey, '1', { ex: ttlSec });
    return { ok: true, persisted: 'redis' };
  } catch {
    return { ok: false, persisted: 'failed' };
  }
}

export interface DurableRevocationEntry {
  tokenKey: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
  reason: string;
}

export type DurableRevokeResult =
  | { ok: true; persistedCount: number }
  | { ok: false; error: string };

export interface DurableRevocationCheckResult {
  revoked: boolean;
  source: 'none' | 'token' | 'scope' | 'error';
  expiresAtMs?: number;
  error?: string;
}

/** Build canonical PostgreSQL `token_key` identifiers for a session/JWT. */
export async function buildRevocationTokenKeys(
  rawToken?: string | null,
  sid?: string | null,
): Promise<string[]> {
  const keys: string[] = [];
  const cleanSid = typeof sid === 'string' ? sid.trim() : '';
  if (cleanSid) {
    keys.push(`${DURABLE_SID_PREFIX}${cleanSid}`);
  }
  const cleanTok = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (cleanTok) {
    keys.push(`${DURABLE_TOK_PREFIX}${await computeTokenSha256(cleanTok)}`);
  }
  return keys;
}

/** Convert a PostgreSQL `token_key` (`sid:...` or `tok:...`) to its Redis blocklist key. */
export function durableKeyToRedisKey(tokenKey: string): string | null {
  if (tokenKey.startsWith(DURABLE_SID_PREFIX)) {
    return `${SESSION_SID_KEY_PREFIX}${tokenKey.slice(DURABLE_SID_PREFIX.length)}`;
  }
  if (tokenKey.startsWith(DURABLE_TOK_PREFIX)) {
    return `${SESSION_TOKEN_KEY_PREFIX}${tokenKey.slice(DURABLE_TOK_PREFIX.length)}`;
  }
  return null;
}

/**
 * Atomically persist one or more session/token revocation rows to PostgreSQL
 * (`revoked_session_tokens`) under `withPlatformAdmin`.
 *
 * Idempotent on concurrent calls (`ON CONFLICT (token_key) DO NOTHING`).
 * Fails honestly on DB errors so callers can surface HTTP 503.
 */
export async function revokeSessionTokensDurable(
  entries: readonly DurableRevocationEntry[],
): Promise<DurableRevokeResult> {
  if (entries.length === 0) {
    return { ok: true, persistedCount: 0 };
  }

  const unique = new Map<string, DurableRevocationEntry>();
  for (const e of entries) {
    if (!e.tokenKey || !e.userId || !e.tenantId) continue;
    if (!unique.has(e.tokenKey)) {
      unique.set(e.tokenKey, e);
    }
  }
  const batch = Array.from(unique.values());
  if (batch.length === 0) {
    return { ok: true, persistedCount: 0 };
  }

  try {
    await withPlatformAdmin(
      prisma,
      async (tx) => {
        for (const item of batch) {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.revoked_session_tokens (token_key, user_id, tenant_id, expires_at, reason)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (token_key) DO NOTHING`,
            item.tokenKey,
            item.userId,
            item.tenantId,
            item.expiresAt,
            item.reason,
          );
        }
      },
      { skipSessionRevocationGuard: true },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[durable-revocation] PostgreSQL write failed:', err);
    return { ok: false, error: message };
  }

  // Opportunistic bounded expired-row pruning (runs in its own best-effort tx
  // AFTER the revocation has committed so cleanup never blocks or rolls back logout).
  void pruneExpiredRevokedSessionTokens(DEFAULT_PRUNE_BATCH).catch(() => {});

  return { ok: true, persistedCount: batch.length };
}

/**
 * Stamp `redis_synced_at = now()` on revocation rows successfully mirrored to
 * Upstash Redis so the outbox sync loop skips already-mirrored rows.
 */
export async function markRevocationTokensSynced(tokenKeys: readonly string[]): Promise<void> {
  if (tokenKeys.length === 0 || isEmptyTestPrismaStub()) return;
  try {
    await withPlatformAdmin(
      prisma,
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE public.revoked_session_tokens
              SET redis_synced_at = now()
            WHERE token_key = ANY($1::text[])
              AND redis_synced_at IS NULL`,
          Array.from(new Set(tokenKeys)),
        ),
      { skipSessionRevocationGuard: true },
    );
  } catch {
    // Best-effort bookkeeping; leaving redis_synced_at NULL merely causes a safe idempotent retry.
  }
}

/**
 * Bounded deletion of expired rows from `revoked_session_tokens` so the table
 * stays small without long-running locks. Never deletes active revocations.
 */
export async function pruneExpiredRevokedSessionTokens(
  limit = DEFAULT_PRUNE_BATCH,
): Promise<number> {
  const safeLimit = Math.max(1, Math.min(5_000, Math.floor(limit)));
  const deleted = await withPlatformAdmin(
    prisma,
    (tx) =>
      tx.$executeRawUnsafe(
        `DELETE FROM public.revoked_session_tokens
          WHERE token_key IN (
            SELECT token_key
              FROM public.revoked_session_tokens
             WHERE expires_at < now()
             ORDER BY expires_at ASC
             LIMIT $1
          )`,
        safeLimit,
      ),
    { skipSessionRevocationGuard: true },
  );
  return typeof deleted === 'number' ? deleted : Number(deleted) || 0;
}

/**
 * Authoritative PostgreSQL revocation check (both per-token `revoked_session_tokens`
 * and bulk `session_revocations`). Executes strictly inside the caller's tenant
 * RLS context (`withTenantRls`) so cross-tenant reads are impossible.
 *
 * When a PostgreSQL-only revocation is detected (e.g. logged out during a Redis
 * outage, after Redis recovers with an empty cache), best-effort self-heals
 * the missing Redis keys so subsequent Edge middleware checks block immediately.
 */
export async function isSessionRevokedInPostgres(params: {
  rawToken?: string | null;
  sid?: string | null;
  userId: string;
  tenantId: string;
  issuedAtMs: number;
}): Promise<DurableRevocationCheckResult> {
  const { rawToken, sid, userId, tenantId, issuedAtMs } = params;
  if (!userId || !tenantId) {
    return { revoked: true, source: 'error', error: 'Missing userId or tenantId' };
  }
  if (isEmptyTestPrismaStub()) {
    return { revoked: false, source: 'none' };
  }

  try {
    const tokenKeys = await buildRevocationTokenKeys(rawToken, sid);

    const check = await withTenantRls(
      prisma,
      tenantId,
      async (tx) => {
        if (tokenKeys.length > 0) {
          const tokenRows = await tx.$queryRawUnsafe<
            Array<{ token_key?: string; expires_at?: Date | string }>
          >(
            `SELECT token_key, expires_at
               FROM public.revoked_session_tokens
              WHERE token_key = ANY($1::text[])
                AND expires_at > now()
              LIMIT 1`,
            tokenKeys,
          );
          const hit = Array.isArray(tokenRows)
            ? tokenRows.find(
                (row) => row && typeof row.token_key === 'string' && row.token_key.length > 0,
              )
            : undefined;
          if (hit?.token_key) {
            const expMs = new Date(hit.expires_at ?? Date.now() + 60_000).getTime();
            return {
              revoked: true as const,
              source: 'token' as const,
              matchedKey: hit.token_key,
              expiresAtMs: Number.isFinite(expMs) ? expMs : Date.now() + 60_000,
            };
          }
        }

        const scopeRows = await tx.$queryRawUnsafe<
          Array<{ user_id?: string | null; tenant_id?: string | null; not_before?: Date | string | null }>
        >(
          `SELECT user_id, tenant_id, not_before
             FROM public.session_revocations
            WHERE (user_id = $1 AND tenant_id IS NULL)
               OR (user_id IS NULL AND tenant_id = $2)
               OR (user_id = $1 AND tenant_id = $2)
            ORDER BY not_before DESC
            LIMIT 1`,
          userId,
          tenantId,
        );
        const scopeHit = Array.isArray(scopeRows)
          ? scopeRows.find((row) => row && row.not_before != null)
          : undefined;
        if (scopeHit?.not_before != null) {
          const nbfMs = new Date(scopeHit.not_before).getTime();
          if (Number.isFinite(nbfMs) && issuedAtMs < nbfMs) {
            return {
              revoked: true as const,
              source: 'scope' as const,
              scopeUserId: scopeHit.user_id ?? null,
              scopeTenantId: scopeHit.tenant_id ?? null,
              notBeforeMs: nbfMs,
            };
          }
        }

        return { revoked: false as const, source: 'none' as const };
      },
      { skipSessionRevocationGuard: true },
    );

    if (check.revoked && check.source === 'token') {
      const backfillKeys = new Set<string>(tokenKeys);
      if (check.matchedKey) backfillKeys.add(check.matchedKey);
      const jobs = Array.from(backfillKeys).map(async (k) => {
        const redisKey = durableKeyToRedisKey(k);
        if (!redisKey) return null;
        const r = await mirrorSingleKeyToRedis(redisKey, check.expiresAtMs).catch(() => ({
          ok: false,
          persisted: 'failed' as const,
        }));
        return r.ok && r.persisted === 'redis' ? k : null;
      });
      void Promise.all(jobs)
        .then((results) => {
          const synced = results.filter((k): k is string => typeof k === 'string');
          if (synced.length > 0) return markRevocationTokensSynced(synced);
        })
        .catch(() => {});
      return { revoked: true, source: 'token', expiresAtMs: check.expiresAtMs };
    }

    if (check.revoked && check.source === 'scope' && typeof check.notBeforeMs === 'number') {
      const redis = getRedis();
      if (redis) {
        let scopeRedisKey: string | null = null;
        if (check.scopeUserId && check.scopeTenantId) {
          scopeRedisKey = revocationKeys(check.scopeUserId, check.scopeTenantId)[2];
        } else if (check.scopeUserId) {
          scopeRedisKey = revocationKeys(check.scopeUserId, '_')[0];
        } else if (check.scopeTenantId) {
          scopeRedisKey = revocationKeys('_', check.scopeTenantId)[1];
        }
        if (scopeRedisKey) {
          void redis
            .set(scopeRedisKey, check.notBeforeMs, { ex: MIRROR_TTL_SECONDS })
            .then(() => clearRevocationCache())
            .catch(() => {});
        }
      }
      return { revoked: true, source: 'scope' };
    }

    return { revoked: check.revoked, source: check.source };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[durable-revocation] PostgreSQL check failed; refusing session (fail closed):',
        err,
      );
      return { revoked: true, source: 'error', error: message };
    }
    console.warn(
      '[durable-revocation] PostgreSQL check failed (allowing outside production):',
      err,
    );
    return { revoked: false, source: 'error', error: message };
  }
}

/**
 * Full Node.js session verification: validates HMAC + expiry + Redis hot cache
 * via `verifySession`, then verifies against durable PostgreSQL revocation
 * tables (`revoked_session_tokens` + `session_revocations`).
 */
export async function verifySessionDurable(token: string): Promise<VerifiedSession | null> {
  const session = await verifySession(token);
  if (!session) return null;

  const durable = await isSessionRevokedInPostgres({
    rawToken: token,
    sid: session.sid,
    userId: session.userId,
    tenantId: session.tenantId,
    issuedAtMs: session.issuedAt,
  });
  if (durable.revoked) return null;

  return session;
}

/**
 * Node.js durable equivalent of `getVerifiedRequestSession` for routes that
 * verify the `xl-session` cookie directly.
 */
export async function getVerifiedRequestSessionDurable(request: {
  headers: Headers;
}): Promise<VerifiedSession | null> {
  const cookies = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith('xl-session='));
  if (cookies.length !== 1) return null;

  const raw = cookies[0].slice('xl-session='.length);
  const session = await verifySessionDurable(raw);
  if (
    !session ||
    typeof session.userId !== 'string' ||
    !session.userId ||
    typeof session.tenantId !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(session.tenantId)
  ) {
    return null;
  }
  return session;
}

export interface RehydrateOptions {
  /** Max rows to mirror per table per sweep (default 500, capped at 2000). */
  limit?: number;
  /**
   * When true AND `revocation:hydrated:v1` is already present in Redis, only
   * drain token rows where `redis_synced_at IS NULL` (outbox mode). When the
   * sentinel is missing (cold/flushed Redis), always runs a full active sweep.
   */
  onlyUnsyncedIfHydrated?: boolean;
}

let inFlightRehydrate: Promise<{ tokensMirrored: number; scopesMirrored: number; hydratedSentinelSet: boolean }> | null = null;

/**
 * Re-mirror active PostgreSQL revocations back into Upstash Redis after a Redis
 * outage, restart, flush, or single-write miss, then refresh the hydration
 * sentinel (`revocation:hydrated:v1`). Safe to call repeatedly (single-flight).
 */
export async function rehydrateRevocationsToRedis(
  limitOrOpts: number | RehydrateOptions = 500,
): Promise<{ tokensMirrored: number; scopesMirrored: number; hydratedSentinelSet: boolean }> {
  if (inFlightRehydrate) return inFlightRehydrate;

  const opts: RehydrateOptions =
    typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : limitOrOpts;

  const run = (async () => {
    const redis = getRedis();
    if (!redis || isEmptyTestPrismaStub()) {
      return { tokensMirrored: 0, scopesMirrored: 0, hydratedSentinelSet: false };
    }

    let sentinelPresent = false;
    try {
      const val = await redis.get(REVOCATION_HYDRATED_KEY);
      sentinelPresent = val !== null && val !== undefined;
    } catch {
      return { tokensMirrored: 0, scopesMirrored: 0, hydratedSentinelSet: false };
    }

    const outboxOnly = Boolean(opts.onlyUnsyncedIfHydrated && sentinelPresent);
    const batchSize = Math.max(1, Math.min(2_000, Math.floor(opts.limit ?? 500)));
    const maxPages = outboxOnly ? 5 : 50;

    let tokensMirrored = 0;
    let tokenMirrorFailures = 0;
    let truncated = false;
    let cursor = '';

    for (let page = 0; page < maxPages; page++) {
      const tokenRows = await withPlatformAdmin(
        prisma,
        (tx) =>
          outboxOnly
            ? tx.$queryRawUnsafe<Array<{ token_key: string; expires_at: Date | string }>>(
                `SELECT token_key, expires_at
                   FROM public.revoked_session_tokens
                  WHERE expires_at > now()
                    AND redis_synced_at IS NULL
                    AND token_key > $1
                  ORDER BY token_key ASC
                  LIMIT $2`,
                cursor,
                batchSize,
              )
            : tx.$queryRawUnsafe<Array<{ token_key: string; expires_at: Date | string }>>(
                `SELECT token_key, expires_at
                   FROM public.revoked_session_tokens
                  WHERE expires_at > now()
                    AND token_key > $1
                  ORDER BY token_key ASC
                  LIMIT $2`,
                cursor,
                batchSize,
              ),
        { skipSessionRevocationGuard: true },
      );

      const batch = Array.isArray(tokenRows) ? tokenRows : [];
      if (batch.length === 0) break;

      const syncedKeys: string[] = [];
      for (const row of batch) {
        if (!row?.token_key) continue;
        cursor = row.token_key;
        const redisKey = durableKeyToRedisKey(row.token_key);
        const expMs = new Date(row.expires_at).getTime();
        if (!redisKey || !Number.isFinite(expMs) || expMs <= Date.now()) continue;
        const res = await mirrorSingleKeyToRedis(redisKey, expMs);
        if (res.ok && res.persisted === 'redis') {
          tokensMirrored += 1;
          syncedKeys.push(row.token_key);
        } else if (!res.ok) {
          tokenMirrorFailures += 1;
        }
      }

      if (syncedKeys.length > 0) {
        await markRevocationTokensSynced(syncedKeys);
      }

      if (batch.length < batchSize) break;
      if (page === maxPages - 1) truncated = true;
    }

    // Always re-mirror recent bulk `session_revocations` (25h window, small table)
    // even in outbox mode so a transient Redis write-miss on `revokeSessions()`
    // heals on retry and on the 15 s background loop.
    const scopes = await withPlatformAdmin(
      prisma,
      (tx) =>
        tx.$queryRawUnsafe<
          Array<{ user_id: string | null; tenant_id: string | null; not_before: Date | string }>
        >(
          `SELECT user_id, tenant_id, not_before
             FROM public.session_revocations
            WHERE not_before > now() - interval '25 hours'
            ORDER BY not_before DESC
            LIMIT $1`,
          batchSize,
        ),
      { skipSessionRevocationGuard: true },
    );

    let scopesMirrored = 0;
    let scopeMirrorFailures = 0;
    for (const row of Array.isArray(scopes) ? scopes : []) {
      const nbfMs = new Date(row.not_before).getTime();
      if (!Number.isFinite(nbfMs)) continue;
      let key: string;
      if (row.user_id && row.tenant_id) {
        key = revocationKeys(row.user_id, row.tenant_id)[2];
      } else if (row.user_id) {
        key = revocationKeys(row.user_id, '_')[0];
      } else if (row.tenant_id) {
        key = revocationKeys('_', row.tenant_id)[1];
      } else {
        continue;
      }
      try {
        await redis.set(key, nbfMs, { ex: MIRROR_TTL_SECONDS });
        scopesMirrored += 1;
      } catch {
        scopeMirrorFailures += 1;
      }
    }

    // Only stamp the hydration sentinel when EVERY active/unsynced row in this
    // sweep mirrored cleanly without truncation, so Edge never unblocks on a
    // half-hydrated cache.
    let hydratedSentinelSet = sentinelPresent;
    if (!truncated && tokenMirrorFailures === 0 && scopeMirrorFailures === 0) {
      try {
        await redis.set(REVOCATION_HYDRATED_KEY, '1', { ex: MIRROR_TTL_SECONDS });
        hydratedSentinelSet = true;
      } catch {
        hydratedSentinelSet = false;
      }
    }

    return { tokensMirrored, scopesMirrored, hydratedSentinelSet };
  })();

  inFlightRehydrate = run;
  try {
    return await run;
  } finally {
    inFlightRehydrate = null;
  }
}

let retryScheduled = false;

/**
 * Schedule an immediate bounded retry to drain unsynced PostgreSQL revocations
 * into Redis after a transient Redis write failure.
 */
export function scheduleRevocationRedisSync(): void {
  if (retryScheduled || process.env.NODE_ENV === 'test') return;
  retryScheduled = true;
  const delays = [1_500, 5_000, 15_000];

  const attempt = (idx: number) => {
    const timer = setTimeout(() => {
      void rehydrateRevocationsToRedis({ onlyUnsyncedIfHydrated: true })
        .then((res) => {
          if (res.hydratedSentinelSet) {
            retryScheduled = false;
          } else if (idx + 1 < delays.length) {
            attempt(idx + 1);
          } else {
            retryScheduled = false;
          }
        })
        .catch(() => {
          if (idx + 1 < delays.length) {
            attempt(idx + 1);
          } else {
            retryScheduled = false;
          }
        });
    }, delays[idx]);
    (timer as { unref?: () => void }).unref?.();
  };

  attempt(0);
}

let syncLoopStarted = false;

/**
 * Start the background PostgreSQL -> Redis revocation hydration & outbox drain
 * loop (called once on Node.js server boot from `src/instrumentation-node.ts`).
 */
export function startRevocationSyncLoop(): void {
  if (syncLoopStarted) return;
  syncLoopStarted = true;

  // Immediate startup hydration so Redis is warm before traffic lands.
  void rehydrateRevocationsToRedis({ onlyUnsyncedIfHydrated: false })
    .then((res) => {
      if (res.hydratedSentinelSet) {
        console.log(
          `[Startup] Revocation Redis mirror hydrated (tokens=${res.tokensMirrored}, scopes=${res.scopesMirrored})`,
        );
      }
    })
    .catch((err) => {
      console.warn('[Startup] Initial revocation Redis hydration deferred:', err instanceof Error ? err.message : err);
    });

  const interval = setInterval(() => {
    void rehydrateRevocationsToRedis({ onlyUnsyncedIfHydrated: true }).catch(() => {});
  }, SYNC_LOOP_INTERVAL_MS);
  (interval as { unref?: () => void }).unref?.();
}
