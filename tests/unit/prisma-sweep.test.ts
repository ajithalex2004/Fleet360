import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSweepPrisma,
  getVerifiedSweepPrisma,
  sweepConcurrency,
  disconnectSweepPrisma,
} from '@/lib/prisma-sweep';
import { prisma } from '@/lib/prisma';

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

  it('verifies non-bypass role on direct compute and grants sweep concurrency 3', async () => {
    if (!process.env.PHASE0_DATABASE_URL) return;
    process.env.RUNTIME_DIRECT_DATABASE_URL = process.env.PHASE0_DATABASE_URL;

    const { client, concurrency } = await getVerifiedSweepPrisma();
    expect(client === prisma).toBe(false);
    expect(concurrency).toBe(3);
    expect(sweepConcurrency()).toBe(3);
    expect(getSweepPrisma() === client).toBe(true);
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
});
