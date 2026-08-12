/**
 * Upstash Redis client — lazy singleton.
 *
 * Returns null (and logs a dev warning) when UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN are not set. This lets the app run in dev/CI
 * without a Redis instance while production deployments get the real store.
 *
 * Import `getRedis` and null-check before every call:
 *
 *   const redis = getRedis();
 *   if (!redis) { ... fallback ... }
 */

import { Redis } from '@upstash/redis';

let _redis: Redis | null | undefined; // undefined = not yet initialised

/**
 * Returns the Upstash Redis client, or null when the env vars are absent.
 * The instance is created once and reused across calls.
 */
export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;

  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[upstash] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — ' +
        'rate limiting and session revocation fall back to in-memory / no-op mode.',
      );
    }
    _redis = null;
    return null;
  }

  _redis = new Redis({ url, token });
  return _redis;
}
