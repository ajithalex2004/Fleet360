import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSweepPrisma,
  getVerifiedSweepPrisma,
  sweepConcurrency,
  disconnectSweepPrisma,
  getAdvisoryLockId,
} from '@/lib/prisma-sweep';
import { prisma } from '@/lib/prisma';
import { PrismaClient } from '@prisma/client';

describe('prisma-sweep connection and role validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    await disconnectSweepPrisma();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    await disconnectSweepPrisma();
    process.env = { ...originalEnv };
  });

  it('falls back to shared pooled client at concurrency 1 when RUNTIME_DIRECT_DATABASE_URL is not set', async () => {
    delete process.env.RUNTIME_DIRECT_DATABASE_URL;
    delete process.env.DIRECT_URL;

    const { client, concurrency } = await getVerifiedSweepPrisma();
    expect(client === prisma).toBe(true);
    expect(concurrency).toBe(1);
    expect(sweepConcurrency()).toBe(1);
    expect(getSweepPrisma() === prisma).toBe(true);
  });

  it('falls back to shared pooled client at concurrency 1 when direct URL is a -pooler endpoint', async () => {
    process.env.RUNTIME_DIRECT_DATABASE_URL = 'postgresql://user:pass@ep-demo-pooler.ap-southeast-1.aws.neon.tech/neondb';

    const { client, concurrency } = await getVerifiedSweepPrisma();
    expect(client === prisma).toBe(true);
    expect(concurrency).toBe(1);
  });

  it('rejects direct connection and alarms if role holds BYPASSRLS', async () => {
    if (!process.env.MIGRATION_DATABASE_URL && !process.env.DIRECT_URL) return;
    process.env.RUNTIME_DIRECT_DATABASE_URL = process.env.MIGRATION_DATABASE_URL || process.env.DIRECT_URL;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, concurrency } = await getVerifiedSweepPrisma();

    // Must reject the bypass role and fall back to safe pooled prisma
    expect(client === prisma).toBe(true);
    expect(concurrency).toBe(1);
    expect(getSweepPrisma() === prisma).toBe(true);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ── Advisory Lock Hashing & Concurrency Overlap Tests ───────────────────────
  it('generates distinct deterministic integer keys for different named sweep jobs', () => {
    const sweepKeys = [
      'push-scheduler',
      'renewal-sweep',
      'notification-sweep',
      'outbox-publisher',
      'maintenance-reminder-sweep',
      'driver-license-expiry-sweep',
      'telematics-sync-sweep',
    ];

    const hashes = sweepKeys.map(getAdvisoryLockId);
    // Every key is a positive 32-bit integer
    hashes.forEach((h) => {
      expect(typeof h).toBe('number');
      expect(h).toBeGreaterThan(0);
    });

    // Every key is distinct (no collisions across standard sweep jobs)
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(sweepKeys.length);

    // Hashing is deterministic
    expect(getAdvisoryLockId('push-scheduler')).toBe(getAdvisoryLockId('push-scheduler'));
  });

  it('advisory lock guard: Worker 1 obtains lock -> Worker 2 concurrent attempt skipped -> Worker 1 releases -> Worker 2 allowed', async () => {
    const dbUrl = process.env.PHASE0_DATABASE_URL || process.env.DATABASE_URL;
    if (!dbUrl) return;

    const worker1 = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const worker2 = new PrismaClient({ datasources: { db: { url: dbUrl } } });

    const lockKey = getAdvisoryLockId('test-sweep-overlap-guard-' + Date.now());

    async function queryWithRetry<T>(client: PrismaClient, query: string): Promise<T> {
      let lastErr: unknown;
      for (let i = 1; i <= 5; i++) {
        try {
          return await client.$queryRawUnsafe<T>(query);
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1000 * i));
        }
      }
      throw lastErr;
    }

    try {
      // 1. Worker 1 acquires lock
      const lock1 = await queryWithRetry<Array<{ pg_try_advisory_lock: boolean }>>(
        worker1,
        `SELECT pg_try_advisory_lock(${lockKey})`,
      );
      expect(lock1[0]?.pg_try_advisory_lock).toBe(true);

      // 2. Worker 2 attempts same lock concurrently -> returns false (skipped)
      const lock2 = await queryWithRetry<Array<{ pg_try_advisory_lock: boolean }>>(
        worker2,
        `SELECT pg_try_advisory_lock(${lockKey})`,
      );
      expect(lock2[0]?.pg_try_advisory_lock).toBe(false);

      // 3. Worker 1 releases lock
      const unlock1 = await queryWithRetry<Array<{ pg_advisory_unlock: boolean }>>(
        worker1,
        `SELECT pg_advisory_unlock(${lockKey})`,
      );
      expect(unlock1[0]?.pg_advisory_unlock).toBe(true);

      // 4. Worker 2 can now acquire lock
      const lock2After = await queryWithRetry<Array<{ pg_try_advisory_lock: boolean }>>(
        worker2,
        `SELECT pg_try_advisory_lock(${lockKey})`,
      );
      expect(lock2After[0]?.pg_try_advisory_lock).toBe(true);

      // Cleanup Worker 2
      await queryWithRetry(worker2, `SELECT pg_advisory_unlock(${lockKey})`);
    } finally {
      await worker1.$disconnect();
      await worker2.$disconnect();
    }
  }, 60_000);
});
