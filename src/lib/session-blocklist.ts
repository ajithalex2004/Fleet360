/**
 * Session revocation blocklist backed by Upstash Redis.
 *
 * When a user logs out (or an admin force-revokes a session), we store a
 * lightweight marker in Redis keyed on the session token fingerprint.  The
 * middleware checks this before accepting the xl-session cookie, so stolen
 * tokens are rejected even while they are cryptographically valid.
 *
 * Key format:  blocklist:sess:<SHA-256 hex of token>
 * TTL:         remaining token lifetime (so the key auto-expires when the
 *              token would have expired anyway — no unbounded growth).
 *
 * Fallback: when Redis is not configured, revocation is a no-op and the
 * check always returns "not blocked".  Logout still clears the cookie, which
 * is the primary defence.  The Redis path is an additional security layer for
 * token theft scenarios (stolen cookie, localStorage exfiltration, etc.).
 */

import { getRedis } from '@/lib/upstash';

const PREFIX = 'blocklist:sess:';

// ── helpers ───────────────────────────────────────────────────────────────────

/** SHA-256 hex fingerprint of an opaque token string. */
async function fingerprint(token: string): Promise<string> {
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

/**
 * Add a token to the blocklist.
 *
 * @param token      The raw xl-session (or backend JWT) token string.
 * @param expiresAt  Unix epoch ms when the token expires.  The Redis key TTL
 *                   is set to this remaining lifetime so the key auto-deletes.
 *
 * Returns an explicit structured result so callers NEVER silently report
 * successful server-side revocation when Redis is configured and write fails.
 */
export async function revokeSession(token: string, expiresAt: number): Promise<RevokeSessionResult> {
  const redis = getRedis();
  if (!redis) {
    return { ok: true, persisted: 'unconfigured' };
  }

  const key    = PREFIX + (await fingerprint(token));
  const ttlSec = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));

  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    const write = redis.set(key, '1', { ex: ttlSec });
    // Prevent late rejection after timeout from becoming UnhandledPromiseRejection.
    write.catch(() => {});
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error('Redis revocation write timed out after 2000ms')), 2_000);
    });
    await Promise.race([write, timeout]);
    return { ok: true, persisted: 'redis' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[session-blocklist] revokeSession failed:', err);
    return { ok: false, persisted: 'failed', error: message };
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

function unavailable(why: unknown): boolean {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[session-blocklist] isSessionRevoked failed (allowing outside production):', why);
    return false;
  }
  console.error('[session-blocklist] isSessionRevoked failed; refusing the token (fail closed):', why);
  return true;
}

/**
 * Returns true if the token has been explicitly revoked.
 *
 * Call this from the session verification path before trusting the token.
 * When Redis is configured but the read fails or times out, production
 * treats the token as revoked (fail closed): allowing it meant a signed-out
 * token stayed usable for as long as Redis was unreachable. Development
 * still allows, with a warning. No Redis configured: no-op (see
 * /api/health).
 */
export async function isSessionRevoked(token: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    const key = PREFIX + (await fingerprint(token));
    const lookup = redis.get(key);
    lookup.catch(() => {});
    // A timeout resolves to undefined, distinct from Redis's null (not set).
    const timeout = new Promise<undefined>((resolve) => {
      timerId = setTimeout(() => resolve(undefined), 1000);
    });
    const val = await Promise.race([lookup, timeout]);
    if (val === undefined) return unavailable('timed out');
    return val !== null;
  } catch (err) {
    return unavailable(err);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}
