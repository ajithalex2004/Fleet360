/**
 * Session revocation fails closed in production.
 *
 * The edge middleware learns about revocations (deactivated users, changed
 * roles, sign-out everywhere, logged-out tokens) only from Redis. When a
 * Redis check failed or timed out it used to allow the session, so a revoked
 * session kept working for as long as Redis was unreachable. In production
 * it is now refused unless a recent answer is cached; outside production it
 * is still allowed, with a warning.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const redis = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'error' | 'hang',
  notBefore: 0,
  blocked: false,
}));

vi.mock('@/lib/upstash', () => ({
  getRedis: () => ({
    mget: async () => {
      if (redis.mode === 'error') throw new Error('ECONNRESET');
      if (redis.mode === 'hang') return new Promise(() => {});
      return [redis.notBefore || null, null, null];
    },
    get: async () => {
      if (redis.mode === 'error') throw new Error('ECONNRESET');
      if (redis.mode === 'hang') return new Promise(() => {});
      return redis.blocked ? '1' : null;
    },
  }),
}));

// tests/setup.ts loads these modules (and the real Redis client) before this
// file's mocks exist; import fresh copies that see the mocks.
let clearRevocationCache: typeof import('@/lib/auth/revocation-check').clearRevocationCache;
let isRevokedSince: typeof import('@/lib/auth/revocation-check').isRevokedSince;
let STALE_GRACE_MS: number;
let isSessionRevoked: typeof import('@/lib/session-blocklist').isSessionRevoked;

beforeAll(async () => {
  vi.resetModules();
  ({ clearRevocationCache, isRevokedSince, STALE_GRACE_MS } = await import('@/lib/auth/revocation-check'));
  ({ isSessionRevoked } = await import('@/lib/session-blocklist'));
});

const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

beforeEach(() => {
  redis.mode = 'ok';
  redis.notBefore = 0;
  redis.blocked = false;
  clearRevocationCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('isRevokedSince', () => {
  it('reports a real revocation', async () => {
    redis.notBefore = 2_000;
    expect(await isRevokedSince('u', 't', 1_000, 10_000)).toBe(true);
    expect(await isRevokedSince('u', 't', 3_000, 10_000 + 70_000)).toBe(false);
  });

  it('refuses the session in production when Redis errors and nothing is cached', async () => {
    env.NODE_ENV = 'production';
    redis.mode = 'error';
    expect(await isRevokedSince('u', 't', Date.now())).toBe(true);
  });

  it('refuses the session in production when Redis times out', async () => {
    env.NODE_ENV = 'production';
    redis.mode = 'hang';
    vi.useFakeTimers();
    const pending = isRevokedSince('u', 't', Date.now());
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await pending).toBe(true);
  });

  it('uses a recent cached answer when Redis fails, in production too', async () => {
    env.NODE_ENV = 'production';
    const t0 = 1_000_000;
    expect(await isRevokedSince('u', 't', t0 - 1, t0)).toBe(false);   // cached: not revoked
    redis.mode = 'error';
    const later = t0 + 120_000;                                        // past the 60 s recheck
    expect(await isRevokedSince('u', 't', t0 - 1, later)).toBe(false);
    // Too old to stand in: refused.
    expect(await isRevokedSince('u', 't', t0 - 1, t0 + STALE_GRACE_MS + 1)).toBe(true);
  });

  it('still allows outside production', async () => {
    env.NODE_ENV = 'development';
    redis.mode = 'error';
    expect(await isRevokedSince('u', 't', Date.now())).toBe(false);
  });
});

describe('isSessionRevoked (logged-out token blocklist)', () => {
  it('reports a blocked token and passes an unblocked one', async () => {
    redis.blocked = true;
    expect(await isSessionRevoked('tok')).toBe(true);
    redis.blocked = false;
    expect(await isSessionRevoked('tok')).toBe(false);
  });

  it('refuses the token in production when Redis errors', async () => {
    env.NODE_ENV = 'production';
    redis.mode = 'error';
    expect(await isSessionRevoked('tok')).toBe(true);
  });

  it('refuses the token in production when Redis times out', async () => {
    env.NODE_ENV = 'production';
    redis.mode = 'hang';
    // Real time: the token is fingerprinted with crypto.subtle before the
    // 1 s timeout is armed, which fake timers cannot step over.
    expect(await isSessionRevoked('tok')).toBe(true);
  }, 5_000);

  it('still allows outside production', async () => {
    env.NODE_ENV = 'development';
    redis.mode = 'error';
    expect(await isSessionRevoked('tok')).toBe(false);
  });
});
