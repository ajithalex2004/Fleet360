/**
 * Unit tests for the RLS helpers in src/lib/rls.ts.
 *
 * These tests do NOT need a database. They use a mocked Prisma client
 * to verify:
 *
 *   - withTenantRls issues the right `set_config('app.tenant_id', $1, true)`
 *     and passes a tenant-scoped tx to its callback.
 *   - withPlatformAdmin issues the same with the '*' wildcard.
 *   - withSystemJob queries active tenants and runs the per-tenant
 *     callback under withTenantRls (so the inner tx is tenant-scoped,
 *     not '*').
 *   - withWebhookTenant first calls identify under withPlatformAdmin
 *     (cross-tenant read), then runs handle under withTenantRls
 *     (tenant-scoped write).
 *
 * Why unit tests, not just integration:
 *   - Integration tests need a real DB with the RLS migration applied,
 *     which is slow and not always available in CI.
 *   - Unit tests run in milliseconds and catch regressions like
 *     "someone changed the set_config SQL string" or "someone forgot
 *     the third arg (is_local=true)".
 *
 * If a regression slips past these tests, the integration tests in
 * tests/integration/tenant-isolation-rls.test.ts are the second line
 * of defense.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  withTenantRls,
  withPlatformAdmin,
  withSystemJob,
  withWebhookTenant,
} from '@/lib/rls';

// ── Mock factory ────────────────────────────────────────────────────────────
//
// Build a minimal Prisma-shaped mock that records every call to
// $transaction, $executeRawUnsafe, and tenant.findMany. Each helper
// test asserts on these records.

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface MockTx {
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
  tenant: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  // Allow any model delegate via property access
  [model: string]: unknown;
}

function makeMockPrisma() {
  const calls: RecordedCall[] = [];

  // The mock transaction client passed to the callback. Recursive — calls
  // to $executeRawUnsafe are recorded; calls to other delegates are
  // recorded as their own entries.
  const makeTx = (): MockTx => {
    const tx: MockTx = {
      $executeRawUnsafe: vi.fn((...args: unknown[]) => {
        calls.push({ method: '$executeRawUnsafe', args });
        return Promise.resolve();
      }) as never,
      $queryRawUnsafe: vi.fn((...args: unknown[]) => {
        calls.push({ method: '$queryRawUnsafe', args });
        return Promise.resolve();
      }) as never,
      $transaction: vi.fn((fn: (tx: MockTx) => Promise<unknown>) => {
        calls.push({ method: '$transaction', args: [fn] });
        return fn(makeTx());
      }) as never,
      tenant: {
        findMany: vi.fn((...args: unknown[]) => {
          calls.push({ method: 'tenant.findMany', args });
          return Promise.resolve([{ id: 'tenant-a' }, { id: 'tenant-b' }]);
        }) as never,
        findUnique: vi.fn((args?: { where?: { id?: string } }) => {
          calls.push({ method: 'tenant.findUnique', args: [args] });
          // Honor the id argument so tests can drive the resolution.
          const id = args?.where?.id;
          return Promise.resolve(id ? { id } : null);
        }) as never,
      },
    };
    return tx;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    $transaction: vi.fn((fn: (tx: MockTx) => Promise<unknown>) => {
      calls.push({ method: '$transaction', args: [fn] });
      return fn(makeTx());
    }),
    $executeRawUnsafe: vi.fn((...args: unknown[]) => {
      calls.push({ method: '$executeRawUnsafe', args });
      return Promise.resolve();
    }),
    $queryRawUnsafe: vi.fn((...args: unknown[]) => {
      calls.push({ method: '$queryRawUnsafe', args });
      return Promise.resolve();
    }),
    tenant: {
      findMany: vi.fn((...args: unknown[]) => {
        calls.push({ method: 'tenant.findMany', args });
        return Promise.resolve([{ id: 'tenant-a' }, { id: 'tenant-b' }]);
      }),
      findUnique: vi.fn((args?: { where?: { id?: string } }) => {
        calls.push({ method: 'tenant.findUnique', args: [args] });
        const id = args?.where?.id;
        return Promise.resolve(id ? { id } : null);
      }),
    },
  };
  return { prisma, calls };
}

// ── withTenantRls ───────────────────────────────────────────────────────────

describe('withTenantRls', () => {
  it('opens a $transaction and sets app.tenant_id to the given tenant', async () => {
    const { prisma, calls } = makeMockPrisma();
    await withTenantRls(prisma as never, 'tenant-a', async () => 'ok');

    // The first call is $transaction; inside it, $executeRawUnsafe sets the GUC.
    const txCall = calls.find(c => c.method === '$transaction');
    expect(txCall).toBeDefined();

    // withTenantRls uses a parameterised $1 placeholder and passes the
    // tenantId as the second arg to $executeRawUnsafe. That way the
    // SQL-injection guard (alphanumeric regex) actually matters.
    const setConfig = calls.find(
      c => c.method === '$executeRawUnsafe' &&
        typeof c.args[0] === 'string' &&
        c.args[0].includes("set_config('app.tenant_id'") &&
        c.args[0].includes('$1'),
    );
    expect(setConfig).toBeDefined();
    expect(setConfig?.args[0]).toBe(`SELECT set_config('app.tenant_id', $1, true)`);
    expect(setConfig?.args[1]).toBe('tenant-a');
  });

  it('rejects an empty tenantId', async () => {
    const { prisma } = makeMockPrisma();
    await expect(
      withTenantRls(prisma as never, '', async () => 'ok'),
    ).rejects.toThrow(/non-empty/);
  });

  it('rejects a tenantId with special characters (SQL-injection guard)', async () => {
    const { prisma } = makeMockPrisma();
    await expect(
      withTenantRls(prisma as never, "tenant-a'; DROP TABLE--", async () => 'ok'),
    ).rejects.toThrow(/alphanumeric/);
  });

  it('returns whatever the callback returns', async () => {
    const { prisma } = makeMockPrisma();
    const out = await withTenantRls(prisma as never, 'tenant-a', async () => 42);
    expect(out).toBe(42);
  });
});

// ── withPlatformAdmin ──────────────────────────────────────────────────────

describe('withPlatformAdmin', () => {
  it('sets app.tenant_id to the "*" wildcard (hardcoded in the SQL)', async () => {
    const { prisma, calls } = makeMockPrisma();
    await withPlatformAdmin(prisma as never, async () => 'ok');

    // withPlatformAdmin hardcodes '*' in the SQL string (no parameter) so
    // there's no risk of the wildcard being overridden by a tenant arg.
    const setConfig = calls.find(
      c => c.method === '$executeRawUnsafe' &&
        typeof c.args[0] === 'string' &&
        c.args[0] === `SELECT set_config('app.tenant_id', '*', true)`,
    );
    expect(setConfig).toBeDefined();
    // No second arg — the wildcard is in the SQL.
    expect(setConfig?.args.length).toBe(1);
  });

  it('passes a transaction client to the callback', async () => {
    const { prisma } = makeMockPrisma();
    let receivedTx: unknown = null;
    await withPlatformAdmin(prisma as never, async (tx) => {
      receivedTx = tx;
      return 'ok';
    });
    expect(receivedTx).not.toBeNull();
    expect((receivedTx as { $executeRawUnsafe: unknown }).$executeRawUnsafe).toBeDefined();
  });
});

// ── withSystemJob ─────────────────────────────────────────────────────────

describe('withSystemJob', () => {
  it('queries active tenants and iterates once per tenant', async () => {
    const { prisma, calls } = makeMockPrisma();

    const seenTenants: string[] = [];
    const results = await withSystemJob(
      prisma as never,
      async ({ tx, tenantId }) => {
        seenTenants.push(tenantId);
        return tx.tenant.findMany({ where: { id: tenantId } });
      },
    );

    expect(seenTenants).toEqual(['tenant-a', 'tenant-b']);
    expect(results).toHaveLength(2);
    expect(results[0].tenantId).toBe('tenant-a');
    expect(results[1].tenantId).toBe('tenant-b');
  });

  it('the per-tenant tx has app.tenant_id set to THAT tenant (not "*")', async () => {
    const { prisma, calls } = makeMockPrisma();

    // For each per-tenant wrap, record the GUC value from the latest
    // set_config call. We do this by tracking the most recent set_config
    // call with the $1-parameterised form (which is what withTenantRls
    // uses), so we skip the withPlatformAdmin's hardcoded '*' wrap.
    const gucValuesByTenant: Record<string, string> = {};

    await withSystemJob(
      prisma as never,
      async ({ tx, tenantId }) => {
        await tx.tenant.findMany({});  // any tx op proves we're inside the wrap
        // Find the most recent $1-parameterised set_config call. That's
        // the per-tenant wrap; the hardcoded '*' is from withPlatformAdmin's
        // outer wrap and won't match the $1 pattern.
        const all = calls.filter(
          c => c.method === '$executeRawUnsafe' && typeof c.args[0] === 'string'
            && c.args[0].includes("set_config('app.tenant_id'") &&
            c.args[0].includes('$1'),
        );
        const last = all[all.length - 1];
        if (last) gucValuesByTenant[tenantId] = String(last.args[1] ?? '');
        return { ok: true };
      },
    );

    // Each per-tenant wrap should set the GUC to the actual tenant ID,
    // NOT the '*' wildcard. This is the key correctness property of
    // withSystemJob (vs. the older runSweepAcrossTenants which set '*').
    expect(gucValuesByTenant['tenant-a']).toBe('tenant-a');
    expect(gucValuesByTenant['tenant-b']).toBe('tenant-b');
    expect(gucValuesByTenant['tenant-a']).not.toBe('*');
  });

  it('limits iteration to a single tenant when tenantHeader is set', async () => {
    const { prisma } = makeMockPrisma();
    const seen: string[] = [];
    const results = await withSystemJob(
      prisma as never,
      async ({ tenantId }) => {
        seen.push(tenantId);
        return tenantId;
      },
      { tenantHeader: 'tenant-a' },
    );
    expect(seen).toEqual(['tenant-a']);
    expect(results).toHaveLength(1);
  });

  it('uses an empty tenant filter (no tenants query) when tenantHeader is set', async () => {
    const { prisma, calls } = makeMockPrisma();
    await withSystemJob(
      prisma as never,
      async () => 'ok',
      { tenantHeader: 'tenant-a' },
    );
    // When tenantHeader is set, we should NOT call tenant.findMany.
    const findManyCall = calls.find(c => c.method === 'tenant.findMany');
    expect(findManyCall).toBeUndefined();
  });

  it('propagates callback errors and stops iterating further tenants', async () => {
    const { prisma } = makeMockPrisma();
    const seen: string[] = [];
    await expect(
      withSystemJob(
        prisma as never,
        async ({ tenantId }) => {
          seen.push(tenantId);
          if (tenantId === 'tenant-a') throw new Error('boom');
          return tenantId;
        },
      ),
    ).rejects.toThrow('boom');
    // Should have stopped at the first tenant (no continuation after throw).
    expect(seen).toEqual(['tenant-a']);
  });
});

// ── withWebhookTenant ─────────────────────────────────────────────────────

describe('withWebhookTenant', () => {
  it('runs identify under withPlatformAdmin (cross-tenant read, hardcoded "*")', async () => {
    const { prisma, calls } = makeMockPrisma();

    await withWebhookTenant(
      prisma as never,
      async (tx) => (await tx.tenant.findUnique({ where: { id: 'tenant-a' } }))?.id ?? null,
      async ({ tx, tenantId }) => {
        return tx.tenant.findMany({ where: { id: tenantId } });
      },
    );

    // withPlatformAdmin's set_config is the hardcoded '*' SQL. It should
    // be present and the first set_config call.
    const hardcodedStar = calls.find(
      c => c.method === '$executeRawUnsafe' &&
        typeof c.args[0] === 'string' &&
        c.args[0] === `SELECT set_config('app.tenant_id', '*', true)`,
    );
    expect(hardcodedStar).toBeDefined();
  });

  it('runs handle under withTenantRls (tenant-scoped write, $1 + tenantId)', async () => {
    const { prisma, calls } = makeMockPrisma();

    await withWebhookTenant(
      prisma as never,
      async (tx) => (await tx.tenant.findUnique({ where: { id: 'tenant-a' } }))?.id ?? null,
      async ({ tx, tenantId }) => {
        return tx.tenant.findMany({ where: { id: tenantId } });
      },
    );

    // After the identify (which set '*'), the handle wrap should set
    // the GUC to the resolved tenantId. Look for the $1-parameterised
    // form — that's withTenantRls.
    const perTenant = calls.filter(
      c => c.method === '$executeRawUnsafe' &&
        typeof c.args[0] === 'string' &&
        c.args[0].includes("set_config('app.tenant_id'") &&
        c.args[0].includes('$1'),
    );
    expect(perTenant.length).toBeGreaterThanOrEqual(1);
    // The last per-tenant set_config should be the resolved tenant.
    expect(perTenant[perTenant.length - 1].args[1]).toBe('tenant-a');
  });

  it('returns null and skips handle when identify returns null', async () => {
    const { prisma, calls } = makeMockPrisma();

    const handleCalls: string[] = [];
    const result = await withWebhookTenant(
      prisma as never,
      async () => null,  // tenant not identified
      async () => {
        handleCalls.push('ran');
        return 'should not happen';
      },
    );

    expect(result).toBeNull();
    expect(handleCalls).toEqual([]);
    // Only the platform-admin wrap's hardcoded '*' set_config should
    // be present; no $1-form (no per-tenant wrap ran).
    const setConfigs = calls.filter(
      c => c.method === '$executeRawUnsafe' &&
        typeof c.args[0] === 'string' &&
        c.args[0].includes("set_config('app.tenant_id'"),
    );
    expect(setConfigs).toHaveLength(1);
    expect(setConfigs[0].args[0]).toBe(`SELECT set_config('app.tenant_id', '*', true)`);
  });

  it('passes the resolved tenantId to the handle callback', async () => {
    const { prisma } = makeMockPrisma();
    let received: { tenantId: string | undefined } = { tenantId: undefined };

    await withWebhookTenant(
      prisma as never,
      async (tx) => (await tx.tenant.findUnique({ where: { id: 'tenant-b' } }))?.id ?? null,
      async (ctx) => {
        received = { tenantId: ctx.tenantId };
        return ctx;
      },
    );

    expect(received.tenantId).toBe('tenant-b');
  });
});

// ── Cross-cutting ─────────────────────────────────────────────────────────

describe('RLS helpers do not silently fall through on GUC failure', () => {
  // If the set_config call throws (e.g. permission denied, syntax error),
  // the helper must propagate the error rather than swallow it and run
  // the callback with an unset GUC. This test guards against that
  // regression: a future change that wraps set_config in a try/catch
  // and continues would be caught here.
  it('withTenantRls propagates set_config errors', async () => {
    const { prisma } = makeMockPrisma();
    // Make $executeRawUnsafe throw on the set_config call.
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRawUnsafe: vi.fn().mockRejectedValue(new Error('permission denied')),
        $transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(
      withTenantRls(prisma as never, 'tenant-a', async () => 'ok'),
    ).rejects.toThrow('permission denied');
  });

  it('withPlatformAdmin propagates set_config errors', async () => {
    const { prisma } = makeMockPrisma();
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRawUnsafe: vi.fn().mockRejectedValue(new Error('permission denied')),
        $transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(
      withPlatformAdmin(prisma as never, async () => 'ok'),
    ).rejects.toThrow('permission denied');
  });
});
