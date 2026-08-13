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

/**
 * Add a token to the blocklist.
 *
 * @param token      The raw xl-session (or backend JWT) token string.
 * @param expiresAt  Unix epoch ms when the token expires.  The Redis key TTL
 *                   is set to this remaining lifetime so the key auto-deletes.
 */
export async function revokeSession(token: string, expiresAt: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return; // degraded mode — no Redis, logout clears cookie

  const key    = PREFIX + (await fingerprint(token));
  const ttlSec = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));

  try {
    await redis.set(key, '1', { ex: ttlSec });
  } catch (err) {
    // Non-fatal — a Redis write failure during logout just means the token
    // won't be in the blocklist.  The cookie is still cleared by the caller.
    console.warn('[session-blocklist] revokeSession failed:', err);
  }
}

/**
 * Returns true if the token has been explicitly revoked.
 *
 * Call this from the session verification path before trusting the token.
 * A Redis read error degrades to "not blocked" (allow) so a Redis outage
 * does not lock out all users.
 */
export async function isSessionRevoked(token: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const key = PREFIX + (await fingerprint(token));
    const val = await redis.get(key);
    return val !== null;
  } catch (err) {
    console.warn('[session-blocklist] isSessionRevoked failed (allowing):', err);
    return false;
  }
}
