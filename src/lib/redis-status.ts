/**
 * Upstash Redis status for the platform admin Platform info page
 * (/api/admin/info): configured, reachable (PING), round-trip time.
 *
 * Redis carries the session-revocation mirror (sign-outs and role changes
 * reaching Next.js within 60 s), the per-token session blocklist and shared
 * rate limits; without it those fall back to per-instance or no-op.
 * Reports the host only, never the token.
 */
import { getRedis } from '@/lib/upstash';

export const REDIS_PING_TIMEOUT_MS = 2_000;

export interface RedisStatus {
  configured: boolean;
  reachable: boolean;
  roundTripMs: number | null;
  /** Hostname of UPSTASH_REDIS_REST_URL, when set. */
  host: string | null;
  error: string | null;
  checkedAt: string;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid URL';
  }
}

export async function redisStatus(now: () => number = () => performance.now()): Promise<RedisStatus> {
  const checkedAt = new Date().toISOString();
  const host = hostOf(process.env.UPSTASH_REDIS_REST_URL);
  const redis = getRedis();
  if (!redis) {
    return {
      configured: false, reachable: false, roundTripMs: null, host, checkedAt,
      error: 'UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN are not set on this service.',
    };
  }
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no reply within ${REDIS_PING_TIMEOUT_MS} ms`)), REDIS_PING_TIMEOUT_MS);
      }),
    ]);
    const roundTripMs = Math.round((now() - started) * 10) / 10;
    if (String(reply).toUpperCase() !== 'PONG') {
      return { configured: true, reachable: false, roundTripMs, host, checkedAt, error: `unexpected reply to PING: ${String(reply).slice(0, 40)}` };
    }
    return { configured: true, reachable: true, roundTripMs, host, checkedAt, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Upstash errors name the problem (unauthorized, DNS, timeout); keep it short.
    return { configured: true, reachable: false, roundTripMs: null, host, checkedAt, error: message.slice(0, 200) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
