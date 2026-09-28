/**
 * Redis status on the Platform info page: configured, reachable (PING),
 * round-trip time, host only (never the token).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

const redis = vi.hoisted(() => ({ client: null as null | { ping: () => Promise<string> } }));
vi.mock('@/lib/upstash', () => ({ getRedis: () => redis.client }));

let redisStatus: typeof import('@/lib/redis-status').redisStatus;
beforeAll(async () => {
  vi.resetModules();
  ({ redisStatus } = await import('@/lib/redis-status'));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); redis.client = null; });

describe('redisStatus', () => {
  it('not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const s = await redisStatus();
    expect(s).toMatchObject({ configured: false, reachable: false, roundTripMs: null, host: null });
    expect(s.error).toMatch(/not set/);
  });

  it('connected: PONG with the round trip, host only', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://eu1-fleet-12345.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret-token-value');
    redis.client = { ping: async () => 'PONG' };
    const clock = [100, 112.34];
    const s = await redisStatus(() => clock.shift()!);
    expect(s).toMatchObject({ configured: true, reachable: true, roundTripMs: 12.3, host: 'eu1-fleet-12345.upstash.io', error: null });
    expect(JSON.stringify(s)).not.toContain('secret-token-value');
  });

  it('configured but failing: reports the error', async () => {
    redis.client = { ping: async () => { throw new Error('Unauthorized: invalid token'); } };
    expect(await redisStatus()).toMatchObject({ configured: true, reachable: false, roundTripMs: null, error: 'Unauthorized: invalid token' });
  });

  it('no reply: times out after 2 s', async () => {
    vi.useFakeTimers();
    redis.client = { ping: () => new Promise<string>(() => {}) };
    const pending = redisStatus();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toMatchObject({ configured: true, reachable: false, error: 'no reply within 2000 ms' });
  });
});
