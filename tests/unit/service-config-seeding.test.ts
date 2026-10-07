/**
 * tests/unit/service-config-seeding.test.ts
 *
 * A new tenant's first Admin > Tenants > Ticket Types load reads all
 * seven ticket types in parallel. Each read used to seed the tenant's
 * service catalogue on its own; the racing inserts hit the
 * service_rules unique index and the page showed "Failed to load matrix".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ exec: [] as string[], execResult: 1 }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => (sql.includes('COUNT(*)') ? [{ count: BigInt(0) }] : []),
    $executeRawUnsafe: async (sql: string) => { db.exec.push(sql); return db.execResult; },
  },
}));
const scopes = vi.hoisted(() => ({
  ensureRootScope: vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return 'root-scope'; }),
}));
vi.mock('@/lib/service-config/scopes-schema', () => scopes);

import { ensureSeededForTenant } from '@/lib/service-config/schema';
import { seedRulesIfAbsent } from '@/lib/service-config/rules-schema';

beforeEach(() => { db.exec = []; db.execResult = 1; scopes.ensureRootScope.mockClear(); });

describe('ensureSeededForTenant', () => {
  it('seeds a tenant once when called concurrently', async () => {
    await Promise.all(Array.from({ length: 7 }, () => ensureSeededForTenant('tenant-a')));
    expect(scopes.ensureRootScope).toHaveBeenCalledTimes(1);
    await ensureSeededForTenant('tenant-a');
    expect(scopes.ensureRootScope).toHaveBeenCalledTimes(1);
  });

  it('retries on a later call when seeding failed', async () => {
    scopes.ensureRootScope.mockRejectedValueOnce(new Error('db down'));
    await expect(ensureSeededForTenant('tenant-b')).rejects.toThrow('db down');
    await ensureSeededForTenant('tenant-b');
    expect(scopes.ensureRootScope).toHaveBeenCalledTimes(2);
  });
});

describe('seedRulesIfAbsent', () => {
  it('skips a rule another request inserted first', async () => {
    db.execResult = 0;
    expect(await seedRulesIfAbsent('type-1', 'approval', {}, 'root-scope')).toBe(false);
    expect(db.exec[0]).toContain('ON CONFLICT DO NOTHING');
  });
});
