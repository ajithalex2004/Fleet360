/**
 * Tenant isolation tests — RLS layer.
 *
 * Complements tests/integration/tenant-isolation.test.ts (which tests
 * the HTTP layer). This file tests the database layer directly:
 *
 *   - Does the RLS policy actually fire?
 *   - Does a query with no tenant context return zero rows (the
 *     "killer test" that proves forgotten withTenantRls() wrappers
 *     cannot leak data)?
 *   - Do UPDATE, DELETE, INSERT all respect the policy?
 *   - Does the WITH CHECK constraint prevent a buggy INSERT from
 *     stamping the wrong tenant_id on a new row?
 *
 * Uses the helpers in src/lib/rls.ts (the team's existing RLS
 * approach). Pairs with prisma/migrations/20260803000000_rls_tenant_isolation_all_tables
 * which extends the policy to every tenant-scoped table.
 *
 * Prerequisites:
 *   - DATABASE_URL points at a Postgres database with the
 *     20260803000000_rls_tenant_isolation_all_tables migration applied.
 *   - The base prisma client (used for setup) connects as the table
 *     owner. Because the migration uses FORCE ROW LEVEL SECURITY, the
 *     owner IS subject to RLS. Test setup uses withPlatformAdmin() to
 *     set the '*' wildcard so it can write across tenants.
 *   - The prisma client inside the RLS tests uses withTenantRls() /
 *     withPlatformAdmin() wrappers to set the GUC explicitly. Any test
 *     that calls tenantPrisma without a wrapper should expect zero
 *     rows back (proves the policy fires).
 *
 * For Vitest, this file is automatically picked up by the
 * tests glob in vitest.config.mjs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin, withSystemJob, withWebhookTenant } from '@/lib/rls';

interface RoleVerificationRow {
  current_user: string;
  rolcanlogin: boolean;
  rolbypassrls: boolean;
  rolsuper: boolean;
}

let isolationAssertionsExecuted = 0;

beforeEach(() => {
  isolationAssertionsExecuted++;
});

// ── Test fixtures ───────────────────────────────────────────────────────────

// Every UNIQUE-constrained fixture value must carry this suffix.
//
// vehicles.license_plate is unique GLOBALLY, not per tenant. The plates below
// were hardcoded 'A-001' / 'A-002' / 'B-001' while the tenant ids were
// timestamped, so the suite was single-use: a second run died in beforeAll with
// 23505 before reaching any assertion. That is invisible while nothing runs the
// suite, and becomes a permanent red the moment CI runs it twice.
//
// The random component matters as much as the clock: two jobs in a CI matrix
// can start inside the same millisecond.
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();

let vehicleA1: string;
let vehicleA2: string;
let vehicleB1: string;
let driverA1: string;
let driverB1: string;

beforeAll(async () => {
  // Preflight: independently verify the active PostgreSQL connection role.
  const roles = await basePrisma.$queryRawUnsafe<RoleVerificationRow[]>(`
    SELECT
      current_user,
      rolcanlogin,
      rolbypassrls,
      rolsuper
    FROM pg_roles
    WHERE rolname = current_user
  `);

  const role = roles[0];
  if (!role) {
    throw new Error('RLS Isolation Preflight Failed: Unable to resolve current_user from pg_roles');
  }

  if (role.rolbypassrls === true) {
    throw new Error(
      `RLS Isolation Preflight Failed: Connected role "${role.current_user}" has rolbypassrls = true. ` +
        `The cross-tenant isolation suite MUST run under a non-bypass role (fleet360_app) to genuinely prove RLS enforcement.`,
    );
  }

  if (role.rolsuper === true) {
    throw new Error(
      `RLS Isolation Preflight Failed: Connected role "${role.current_user}" has rolsuper = true. ` +
        `Superuser roles bypass RLS policies.`,
    );
  }

  if (!role.rolcanlogin) {
    throw new Error(`RLS Isolation Preflight Failed: Connected role "${role.current_user}" cannot log in.`);
  }

  // Setup runs as super-admin so it can write across both tenants.
  // Without withPlatformAdmin, the test would fail at the first insert
  // because the policy filters by app.tenant_id (which is unset on the
  // raw prisma client).
  await withPlatformAdmin(basePrisma, async (tx) => {
    await tx.tenant.createMany({
      data: [
        {
          id: tenantA,
          name: 'Isolation Test Tenant A',
          code: `ISO-A-${Date.now()}`,
          domain: `iso-a-${Date.now()}.example.com`,
          plan: 'ENTERPRISE',
          isActive: true,
        },
        {
          id: tenantB,
          name: 'Isolation Test Tenant B',
          code: `ISO-B-${Date.now()}`,
          domain: `iso-b-${Date.now()}.example.com`,
          plan: 'ENTERPRISE',
          isActive: true,
        },
      ],
    });


    vehicleA1 = `veh-a1-${crypto.randomUUID()}`;
    vehicleA2 = `veh-a2-${crypto.randomUUID()}`;
    vehicleB1 = `veh-b1-${crypto.randomUUID()}`;
    await tx.vehicle.createMany({
      data: [
        {
          id: vehicleA1,
          tenantId: tenantA,
          make: 'Toyota',
          model: 'Yaris',
          licensePlate: `A-001-${crypto.randomUUID().slice(0, 8)}`,
          vin: `VIN-A1-${crypto.randomUUID()}`,
          status: 'ACTIVE',
          deletedAt: null,
          updatedAt: new Date(),
        } as never,
        {
          id: vehicleA2,
          tenantId: tenantA,
          make: 'Honda',
          model: 'Civic',
          licensePlate: `A-002-${crypto.randomUUID().slice(0, 8)}`,
          vin: `VIN-A2-${crypto.randomUUID()}`,
          status: 'ACTIVE',
          deletedAt: null,
          updatedAt: new Date(),
        } as never,
        {
          id: vehicleB1,
          tenantId: tenantB,
          make: 'Ford',
          model: 'Focus',
          licensePlate: `B-001-${crypto.randomUUID().slice(0, 8)}`,
          vin: `VIN-B1-${crypto.randomUUID()}`,
          status: 'ACTIVE',
          deletedAt: null,
          updatedAt: new Date(),
        } as never,
      ],
    });

    driverA1 = `drv-a1-${crypto.randomUUID()}`;
    driverB1 = `drv-b1-${crypto.randomUUID()}`;
    await tx.driver.createMany({
      data: [
        {
          id: driverA1,
          tenantId: tenantA,
          firstName: 'Alice',
          lastName: 'A',
          email: `alice-a-${crypto.randomUUID()}@test.example.com`,
          contactNumber: '+971500000001',
          status: 'ACTIVE',
          deletedAt: null,
          updatedAt: new Date(),
        } as never,
        {
          id: driverB1,
          tenantId: tenantB,
          firstName: 'Bob',
          lastName: 'B',
          email: `bob-b-${crypto.randomUUID()}@test.example.com`,
          contactNumber: '+971500000002',
          status: 'ACTIVE',
          deletedAt: null,
          updatedAt: new Date(),
        } as never,
      ],
    });
  });
}, 60_000);

afterAll(async () => {
  expect(isolationAssertionsExecuted).toBeGreaterThanOrEqual(22);
  // Cleanup also runs as super-admin so it can delete across tenants.
  //
  // CHILDREN BEFORE PARENTS, and every model this file creates must appear
  // here. leaseInquiry was missing: the WITH CHECK tests create lease
  // inquiries, lease_inquiries carries a foreign key to tenants, so the tenant
  // delete failed with 23503 and the rows stayed. Nothing noticed, because
  // deleteMany does not raise for the rows it could not reach and the failure
  // was swallowed by the surrounding transaction rolling back at the end.
  //
  // The residue is not merely untidy. Those tenants and their vehicles sit in
  // the database looking like real data, and the next run's plate collision
  // was a direct consequence.
  //
  // If a test starts creating a new model, add it here, above the tenant
  // delete. The tenant delete failing with 23503 is the signal that something
  // is missing.
  const scope = { tenantId: { in: [tenantA, tenantB] } };
  await withPlatformAdmin(basePrisma, async (tx) => {
    await tx.leaseInquiry.deleteMany({ where: scope });
    await tx.vehicle.deleteMany({ where: scope });
    await tx.driver.deleteMany({ where: scope });
    await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  });

  // Prove the cleanup actually worked rather than assuming it did. A silent
  // failure here is what left the previous run's rows behind.
  const orphans = await withPlatformAdmin(basePrisma, async (tx) =>
    tx.tenant.count({ where: { id: { in: [tenantA, tenantB] } } }),
  );
  if (orphans > 0) {
    throw new Error(
      `afterAll left ${orphans} test tenant(s) in the database. A child table ` +
        `references them and is not in the delete list above — check for a 23503 ` +
        `foreign-key violation and add the missing model.`,
    );
  }

  await basePrisma.$disconnect();
}, 60_000);

// ── Tests ───────────────────────────────────────────────────────────────────

describe('withTenantRls / withPlatformAdmin', () => {
  it('withPlatformAdmin lets setup code insert across tenants', async () => {
    // This is implicitly tested by beforeAll. As a smoke test, the
    // super-admin role should be able to read all rows.
    const count = await withPlatformAdmin(basePrisma, async (tx) => {
      return tx.vehicle.count({ where: { tenantId: { in: [tenantA, tenantB] } } });
    });
    // 3 vehicles total across the two tenants (2 for A, 1 for B).
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('withTenantRls for tenant A only sees A rows', async () => {
    const ids = await withTenantRls(basePrisma, tenantA, async (tx) => {
      const visible = await tx.vehicle.findMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
        select: { id: true },
      });
      return visible.map((v: { id: string }) => v.id);
    });
    expect(ids).toContain(vehicleA1);
    expect(ids).toContain(vehicleA2);
    expect(ids).not.toContain(vehicleB1);
  });
});

describe('RLS: SELECT isolation', () => {
  it('A sees only A vehicles, never B vehicles', async () => {
    const ids = await withTenantRls(basePrisma, tenantA, async (tx) => {
      const visible = await tx.vehicle.findMany({ select: { id: true } });
      return visible.map((v: { id: string }) => v.id);
    });
    expect(ids).toContain(vehicleA1);
    expect(ids).toContain(vehicleA2);
    expect(ids).not.toContain(vehicleB1);
  });

  it('A cannot find B by id — direct lookup returns null', async () => {
    const found = await withTenantRls(basePrisma, tenantA, async (tx) => {
      return tx.vehicle.findUnique({ where: { id: vehicleB1 } });
    });
    expect(found).toBeNull();
  });

  it('A cannot find B by id even with explicit where: { tenantId: A }', async () => {
    // Even with a where clause that "looks right", RLS still hides B's row.
    // This is the property that makes tenant leaks impossible: the policy
    // fires regardless of what the application code does.
    const found = await withTenantRls(basePrisma, tenantA, async (tx) => {
      return tx.vehicle.findFirst({
        where: { id: vehicleB1, tenantId: tenantA } as never,
      });
    });
    expect(found).toBeNull();
  });

  it('B sees only B vehicles', async () => {
    const ids = await withTenantRls(basePrisma, tenantB, async (tx) => {
      const visible = await tx.vehicle.findMany({ select: { id: true } });
      return visible.map((v: { id: string }) => v.id);
    });
    expect(ids).toContain(vehicleB1);
    expect(ids).not.toContain(vehicleA1);
    expect(ids).not.toContain(vehicleA2);
  });
});

describe('RLS: UPDATE isolation', () => {
  it('A cannot update B vehicles (UPDATE affects 0 rows)', async () => {
    const result = await withTenantRls(basePrisma, tenantA, async (tx) => {
      return tx.vehicle.updateMany({
        where: { id: vehicleB1 } as never,
        data: { model: 'HACKED' } as never,
      });
    });
    expect(result.count).toBe(0);
    // Verify B's row is unchanged using super-admin.
    const stillThere = await withPlatformAdmin(basePrisma, async (tx) => {
      return tx.vehicle.findUnique({ where: { id: vehicleB1 } });
    });
    expect(stillThere?.model).toBe('Focus');
    expect(stillThere?.model).not.toBe('HACKED');
  });
});

describe('RLS: DELETE isolation', () => {
  it('A cannot delete B vehicles (DELETE affects 0 rows)', async () => {
    const result = await withTenantRls(basePrisma, tenantA, async (tx) => {
      return tx.vehicle.deleteMany({
        where: { id: vehicleB1 } as never,
      });
    });
    expect(result.count).toBe(0);
    // Verify B's row still exists.
    const stillThere = await withPlatformAdmin(basePrisma, async (tx) => {
      return tx.vehicle.findUnique({ where: { id: vehicleB1 } });
    });
    expect(stillThere).not.toBeNull();
  });
});

describe('RLS: the killer test — no tenant context = no rows', () => {
  it('a raw prisma query (no wrapper) returns zero rows on a tenant-scoped table', async () => {
    // The whole point of this whole exercise. Because the migration uses
    // FORCE ROW LEVEL SECURITY, the table owner is also subject to RLS.
    // A raw prisma call without setting app.tenant_id returns zero rows
    // (the GUC is unset, the policy has no '*' wildcard match, and
    // there are no tenant_id IS NULL rows for this fixture).
    //
    // If a future PR adds a route handler that calls prisma.vehicle
    // without withTenantRls(), it will silently return zero rows. The
    // route will look broken (empty list), but it won't leak.
    const visible = await basePrisma.vehicle.findMany();
    expect(visible).toEqual([]);
  });
});

describe('withPlatformAdmin: cross-tenant reads', () => {
  it('super-admin can read across tenants', async () => {
    const ids = await withPlatformAdmin(basePrisma, async (tx) => {
      const all = await tx.vehicle.findMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
        select: { id: true },
      });
      return all.map((v: { id: string }) => v.id);
    });
    expect(ids).toContain(vehicleA1);
    expect(ids).toContain(vehicleA2);
    expect(ids).toContain(vehicleB1);
  });
});

// ── withWebhookTenant — webhook creates booking only inside resolved tenant ──

describe('withWebhookTenant: create booking only inside resolved tenant', () => {
  it('returns null when the tenant cannot be identified', async () => {
    // The Stripe webhook scenario: customer ID we don't know about → 503.
    const result = await withWebhookTenant(
      basePrisma,
      async () => null,  // identify returns null
      async () => {
        // This should never run. If it does, the test will fail because
        // the test below expects 0 creates; this throw makes the failure loud.
        throw new Error('handleFn ran without a resolved tenant');
      },
    );
    expect(result).toBeNull();
  });

  it('identifies the tenant and creates the booking inside the tenant scope', async () => {
    // Use lease_inquiry (tenant-scoped) as a stand-in for "booking".
    // The test verifies:
    //   1. The identify function ran (and could see all tenants via '*')
    //   2. The handle function ran inside the resolved tenant's tx
    //   3. The created row's tenantId is the resolved tenant
    //   4. The row is visible inside the tenant (RLS passes) but NOT
    //      visible from another tenant.
    const inquiryNumber = `WB-${Date.now()}`;

    const inquiryId = await withWebhookTenant(
      basePrisma,
      // Identify: pretend the inbound payload told us the tenant via its slug.
      // In real life this would be a Stripe customer ID or phone lookup.
      async (tx) => {
        const t = await tx.tenant.findUnique({ where: { id: tenantA } });
        return t?.id ?? null;
      },
      // Handle: create the booking inside the resolved tenant.
      async ({ tx, tenantId }) => {
        const created = await tx.leaseInquiry.create({
          data: {
            inquiryNumber,
            customerName: 'Webhook Test Customer',
            customerEmail: 'webhook-test@example.com',
            status: 'NEW',
            tenantId,
          },
        });
        return created.id;
      },
    );

    expect(inquiryId).toBeTruthy();
    expect(inquiryId).not.toBeNull();

    // 1. Verify the row exists with the right tenantId (super-admin sees everything).
    const found = await withPlatformAdmin(basePrisma, async (tx) => {
      return tx.leaseInquiry.findUnique({ where: { id: inquiryId! } });
    });
    expect(found?.tenantId).toBe(tenantA);
    expect(found?.inquiryNumber).toBe(inquiryNumber);

    // 2. Verify tenant A can see it.
    const seenByA = await withTenantRls(basePrisma, tenantA, async (tx) => {
      return tx.leaseInquiry.findUnique({ where: { id: inquiryId! } });
    });
    expect(seenByA).not.toBeNull();

    // 3. Verify tenant B CANNOT see it (RLS hides it).
    const seenByB = await withTenantRls(basePrisma, tenantB, async (tx) => {
      return tx.leaseInquiry.findUnique({ where: { id: inquiryId! } });
    });
    expect(seenByB).toBeNull();
  });

  it('a booking cannot be created against a wrong tenant from inside the webhook wrap', async () => {
    // Even if some buggy code passes tenantB as the tenantId into the
    // create call, RLS WITH CHECK should reject it (the GUC is tenantA,
    // but the row's tenantId is tenantB).
    const inquiryNumber = `WB-WRONG-${Date.now()}`;

    await expect(
      withWebhookTenant(
        basePrisma,
        async (tx) => (await tx.tenant.findUnique({ where: { id: tenantA } }))?.id ?? null,
        async ({ tx }) => {
          // Intentionally stamp the row with tenantB. RLS WITH CHECK
          // should reject this on commit.
          await tx.leaseInquiry.create({
            data: {
              inquiryNumber,
              customerName: 'Sneaky Customer',
              status: 'NEW',
              tenantId: tenantB,  // <-- mismatch with the GUC
            },
          });
        },
      ),
    ).rejects.toThrow();

    // Confirm the row never landed.
    const landed = await withPlatformAdmin(basePrisma, async (tx) => {
      return tx.leaseInquiry.findFirst({ where: { inquiryNumber } });
    });
    expect(landed).toBeNull();
  });
});

// ── withSystemJob — cron iterates all tenants ───────────────────────────────

describe('withSystemJob: iterate every active tenant', () => {
  it('calls the per-tenant fn once per active tenant', async () => {
    const seenTenants: string[] = [];

    const results = await withSystemJob(
      basePrisma,
      async ({ tx, tenantId }) => {
        // While inside the per-tenant wrap, the tx should be tenant-scoped.
        // The smoke check: count rows for THIS tenant only.
        const myVehicles = await tx.vehicle.count({ where: { tenantId } });
        const myDrivers = await tx.driver.count({ where: { tenantId } });
        seenTenants.push(tenantId);
        return { vehicles: myVehicles, drivers: myDrivers };
      },
    );

    // Should have iterated at least our two test tenants.
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(seenTenants).toContain(tenantA);
    expect(seenTenants).toContain(tenantB);

    // Each per-tenant result should have the counts for THAT tenant only.
    const aResult = results.find(r => r.tenantId === tenantA);
    const bResult = results.find(r => r.tenantId === tenantB);
    expect(aResult?.result.vehicles).toBeGreaterThanOrEqual(2);
    expect(bResult?.result.vehicles).toBeGreaterThanOrEqual(1);
  }, 90_000);

  it('the per-tenant callback runs in a tenant-scoped tx (cannot see other tenants)', async () => {
    // Stronger property: inside the withSystemJob callback, the tx
    // is scoped to ONE tenant. A cross-tenant findMany returns 0 rows
    // for other tenants (same as withTenantRls).
    const results = await withSystemJob(
      basePrisma,
      async ({ tx, tenantId }) => {
        const aVehicles = await tx.vehicle.count({ where: { tenantId: tenantA } });
        const bVehicles = await tx.vehicle.count({ where: { tenantId: tenantB } });
        return { tenantId, aVehicles, bVehicles };
      },
    );

    // When iterating tenantA's callback, the tx should only see A's vehicles.
    // When iterating tenantB's callback, only B's.
    for (const r of results) {
      if (r.tenantId === tenantA) {
        // Inside A's scope, can see A's vehicles, cannot see B's.
        expect(r.result.aVehicles).toBeGreaterThanOrEqual(2);
        expect(r.result.bVehicles).toBe(0);
      } else if (r.tenantId === tenantB) {
        // Inside B's scope, can see B's vehicles, cannot see A's.
        expect(r.result.bVehicles).toBeGreaterThanOrEqual(1);
        expect(r.result.aVehicles).toBe(0);
      }
    }
  }, 90_000);

  it('limits iteration to a single tenant when tenantHeader is set', async () => {
    // When a logged-in user triggers a sweep for their own tenant, only
    // that tenant should be processed. This is the manual-sweep path.
    const results = await withSystemJob(
      basePrisma,
      async ({ tx, tenantId }) => {
        return tx.vehicle.count({ where: { tenantId } });
      },
      { tenantHeader: tenantA },
    );

    expect(results.length).toBe(1);
    expect(results[0].tenantId).toBe(tenantA);
  });
});

// ── Cross-table smoke — multiple tenant-scoped tables ──────────────────────

describe('RLS applies to every tenant-scoped table', () => {
  // This catches the "we forgot to enable RLS on a new table" regression.
  // The RLS migration is data-driven (information_schema), so if a new
  // tenant-scoped table is added without a tenant_id column, it'll
  // still be picked up — but the test verifies the policy actually fires
  // on the smoke tables.

  const tenantScopedTables = [
    'vehicle',
    'driver',
    'leaseInquiry',
  ] as const;

  for (const model of tenantScopedTables) {
    it(`${model}: tenant A finds 0 rows with no context`, async () => {
      // The "killer test" applied to each table — proves RLS is wired
      // and the policy fires for every model that has a tenant_id column.
      const result = await (basePrisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[model].findMany();
      expect(result).toEqual([]);
    });

    it(`${model}: tenant A reads its own rows but never tenant B's`, async () => {
      const result = await withTenantRls(basePrisma, tenantA, async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any)[model].findMany({ select: { id: true, tenantId: true } });
      });
      const ids = (result as Array<{ id: string; tenantId: string }>).map(r => r.id);
      // Either zero rows (no test data for this table) or all rows
      // belong to tenant A.
      for (const r of result as Array<{ id: string; tenantId: string }>) {
        expect(r.tenantId).toBe(tenantA);
      }
      expect(ids.every(id => typeof id === 'string')).toBe(true);
    });
  }
});
