/**
 * Proves that GUC tenant context does NOT leak across sequential or concurrent
 * pooled connections, and that withTenantRls is stable across multi-roundtrip
 * transactions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin } from '@/lib/rls';
import crypto from 'crypto';

describe('Pooled connection context isolation', () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    tenantA = crypto.randomUUID();
    tenantB = crypto.randomUUID();

    await withPlatformAdmin(basePrisma, async (tx) => {
      await tx.tenant.createMany({
        data: [
          {
            id: tenantA,
            name: 'Pool Test Tenant A',
            code: `POOL-A-${crypto.randomUUID().slice(0, 8)}`,
            domain: `pool-a-${crypto.randomUUID().slice(0, 8)}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
          {
            id: tenantB,
            name: 'Pool Test Tenant B',
            code: `POOL-B-${crypto.randomUUID().slice(0, 8)}`,
            domain: `pool-b-${crypto.randomUUID().slice(0, 8)}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
        ],
      });
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await withPlatformAdmin(basePrisma, async (tx) => {
        await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
      });
    } catch {
      // Best-effort cleanup
    }
  }, 60_000);

  it('A: set_config is visible inside withTenantRls', async () => {
    const res = await withTenantRls(basePrisma, tenantA, async (tx) => {
      const [{ v }] = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
        `SELECT current_setting('app.tenant_id', true) AS v`,
      );
      return v;
    });
    expect(res).toBe(tenantA);
  });

  it('B: app.tenant_id does NOT persist after transaction commit', async () => {
    // Outside any transaction, current_setting must return null / empty string
    const [{ after }] = await basePrisma.$queryRawUnsafe<Array<{ after: string | null }>>(
      `SELECT current_setting('app.tenant_id', true) AS after`,
    );
    expect(after).not.toBe(tenantA);
    expect(after === null || after === '').toBe(true);
  });

  it('C: 8 concurrent transactions across distinct tenants never observe cross-tenant bleeding', async () => {
    const ids = [tenantA, tenantB, tenantA, tenantB, tenantA, tenantB, tenantA, tenantB];
    const concurrent = await Promise.all(
      ids.map((id, i) =>
        withTenantRls(basePrisma, id, async (tx) => {
          await new Promise((r) => setTimeout(r, (i % 4) * 20));
          const [{ v }] = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
            `SELECT current_setting('app.tenant_id', true) AS v`,
          );
          await new Promise((r) => setTimeout(r, 40));
          const [{ v2 }] = await tx.$queryRawUnsafe<Array<{ v2: string | null }>>(
            `SELECT current_setting('app.tenant_id', true) AS v2`,
          );
          return { expected: id, first: v, second: v2 };
        }),
      ),
    );

    const bled = concurrent.filter((r) => r.first !== r.expected || r.second !== r.expected);
    expect(bled).toHaveLength(0);
  });

  it('D: value is stable across 10 round-trips in one transaction', async () => {
    const reads = await withTenantRls(basePrisma, tenantB, async (tx) => {
      const seen: Array<string | null> = [];
      for (let i = 0; i < 10; i++) {
        const [{ v }] = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
          `SELECT current_setting('app.tenant_id', true) AS v`,
        );
        seen.push(v);
        await new Promise((r) => setTimeout(r, 20));
      }
      return seen;
    });

    expect(reads).toHaveLength(10);
    expect(reads.every((v) => v === tenantB)).toBe(true);
  });
});
