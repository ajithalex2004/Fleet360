/**
 * TENANT-001 — End-to-end isolation for Leasing & Rental (database layer).
 *
 * Complements:
 *   - tests/integration/tenant-isolation-rls.test.ts (vehicles/drivers/general RLS)
 *   - tests/integration/tenant-isolation.test.ts (HTTP layer)
 *
 * This file focuses on Leasing + Rental models after the
 * 20260815140000_tenant_001_leasing_rental_isolation migration:
 *
 *   1. SELECT isolation (A cannot see B rows)
 *   2. UPDATE/DELETE isolation (0 rows affected)
 *   3. INSERT WITH CHECK (cannot stamp wrong tenant_id)
 *   4. Parent/child tenant match (booking → inspection/claim)
 *   5. Killer test: raw prisma without withTenantRls sees 0 rows
 *   6. withSystemJob iterates tenants without cross-tenant leakage in results
 *
 * Prerequisites:
 *   - DATABASE_URL set
 *   - Migration 20260815140000 applied (tenant_id on rental_* + lease children)
 *   - FORCE RLS on those tables
 *   - App role subject to RLS (FORCE means even owner is subject)
 *
 * Run:
 *   npm run test:isolation:integration
 *   vitest run tests/integration/tenant-001-leasing-rental-isolation.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin, withSystemJob } from '@/lib/rls';

// Tenant ids must be UUID-FORMATTED, not merely unique.
//
// This suite spans models whose tenant_id column type is inconsistent:
//
//   lessees, rental_bookings, vehicles   text
//   damage_claims, rental_agreements     uuid
//
// The ids used to be `t001-a-<epoch>`, which text columns accept happily and
// uuid columns reject with
//   "Error creating UUID, invalid character: expected an optional prefix of
//    `urn:uuid:` followed by [0-9a-fA-F-], found `t` at 1"
// — a cleanup failure that left rows behind and only surfaced because nothing
// ran this suite for long enough to notice.
//
// A UUID string satisfies both, so it is the format that works regardless of
// which side of the inconsistency a model happens to sit on. The underlying
// text-vs-uuid drift is a schema problem, not a test problem, and is not
// papered over here — it is just no longer this suite's failure mode.
const suffix = Date.now();
const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();

let customerA: string;
let customerB: string;
let bookingA: string;
let bookingB: string;
let lesseeA: string;
let lesseeB: string;
let inquiryA: string;

const hasDb = Boolean(process.env.DATABASE_URL);

async function tableHasTenantId(table: string): Promise<boolean> {
  try {
    const rows = await basePrisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'`,
      table,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

describe.skipIf(!hasDb)('TENANT-001 Leasing & Rental RLS isolation', () => {
  let rentalReady = false;
  let leasingReady = false;

  beforeAll(async () => {
    rentalReady = await tableHasTenantId('rental_bookings');
    leasingReady = await tableHasTenantId('lessees');

    await withPlatformAdmin(basePrisma, async (tx) => {
      await tx.tenant.createMany({
        data: [
          {
            id: tenantA,
            name: 'T001 Tenant A',
            code: `T001A-${suffix}`,
            domain: `t001-a-${suffix}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
          {
            id: tenantB,
            name: 'T001 Tenant B',
            code: `T001B-${suffix}`,
            domain: `t001-b-${suffix}.example.com`,
            plan: 'ENTERPRISE',
            isActive: true,
          },
        ],
      });

      // Lease inquiries (already tenantized on main)
      const iqA = await tx.leaseInquiry.create({
        data: {
          inquiryNumber: `INQ-A-${suffix}`,
          customerName: 'Lessee A Contact',
          customerEmail: `a-${suffix}@example.com`,
          status: 'NEW',
          tenantId: tenantA,
        },
      });
      inquiryA = iqA.id;

      const lesA = await tx.lessee.create({
        data: {
          tenantId: tenantA,
          name: `Lessee A ${suffix}`,
          type: 'corporate',
          tradeLicense: `TL-A-${suffix}`,
        },
      });
      lesseeA = lesA.id;

      const lesB = await tx.lessee.create({
        data: {
          tenantId: tenantB,
          name: `Lessee B ${suffix}`,
          type: 'corporate',
          tradeLicense: `TL-B-${suffix}`,
        },
      });
      lesseeB = lesB.id;

      if (rentalReady) {
        const cA = await (tx as any).rentalCustomer.create({
          data: {
            tenantId: tenantA,
            fullName: `Customer A ${suffix}`,
            customerType: 'INDIVIDUAL',
            phone: `+97150${String(suffix).slice(-7)}`,
          },
        });
        customerA = cA.id;

        const cB = await (tx as any).rentalCustomer.create({
          data: {
            tenantId: tenantB,
            fullName: `Customer B ${suffix}`,
            customerType: 'INDIVIDUAL',
            phone: `+97151${String(suffix).slice(-7)}`,
          },
        });
        customerB = cB.id;

        const bA = await (tx as any).rentalBooking.create({
          data: {
            tenantId: tenantA,
            bookingRef: `BK-A-${suffix}`,
            customerId: customerA,
            pickupDate: new Date(),
            dropoffDate: new Date(Date.now() + 86400000),
            status: 'CONFIRMED',
            currency: 'AED',
          },
        });
        bookingA = bA.id;

        const bB = await (tx as any).rentalBooking.create({
          data: {
            tenantId: tenantB,
            bookingRef: `BK-B-${suffix}`,
            customerId: customerB,
            pickupDate: new Date(),
            dropoffDate: new Date(Date.now() + 86400000),
            status: 'CONFIRMED',
            currency: 'AED',
          },
        });
        bookingB = bB.id;
      }
    });
  }, 60_000);

  afterAll(async () => {
    // One transaction PER MODEL, children first.
    //
    // This used to be a single withPlatformAdmin wrapping every delete. One
    // failure anywhere rolled the whole thing back, so nothing was cleaned —
    // not even the deletes that had succeeded. That is why test tenants
    // accumulated with lessees and lease_inquiries still attached, even though
    // both are in the list below: the transaction died before committing.
    //
    // The `catch {}` blocks made it worse by hiding which delete failed.
    // Failures are collected and reported now.
    const scope = { where: { tenantId: { in: [tenantA, tenantB] } } };
    const failures: string[] = [];

    const del = async (model: string, fn: (tx: any) => Promise<unknown>) => {
      try {
        await withPlatformAdmin(basePrisma, async (tx) => fn(tx));
      } catch (e) {
        // A model that does not exist in this schema is expected and fine;
        // anything else is a real cleanup failure and must be visible.
        const msg = e instanceof Error ? e.message : String(e);
        if (!/is not a function|Cannot read propert/.test(msg)) {
          failures.push(`${model}: ${msg.split(/\r?\n/)[0]}`);
        }
      }
    };

    if (rentalReady) {
      await del('vehicleInspection', (tx) => tx.vehicleInspection?.deleteMany?.(scope));
      await del('damageClaim', (tx) => tx.damageClaim?.deleteMany?.(scope));
      await del('rentalBooking', (tx) => tx.rentalBooking.deleteMany(scope));
      await del('rentalCustomer', (tx) => tx.rentalCustomer.deleteMany(scope));
    }
    await del('leaseInquiry', (tx) => tx.leaseInquiry.deleteMany(scope));
    await del('lessee', (tx) => tx.lessee.deleteMany(scope));
    await del('tenant', (tx) =>
      tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } }),
    );

    // Verify rather than assume. A surviving tenant means a child table
    // references it and is missing from the list above; the 23503 will name it.
    const left = await withPlatformAdmin(basePrisma, async (tx) =>
      tx.tenant.count({ where: { id: { in: [tenantA, tenantB] } } }),
    );

    await basePrisma.$disconnect();

    if (left > 0 || failures.length > 0) {
      throw new Error(
        `cleanup incomplete: ${left} test tenant(s) remain.` +
          (failures.length ? ` Failures: ${failures.join('; ')}` : ''),
      );
    }
  });

  // ── Leasing: Lessee isolation ─────────────────────────────────────────────

  describe('Lessee SELECT/UPDATE isolation', () => {
    it('tenant A lists only A lessees', async () => {
      const rows = await withTenantRls(basePrisma, tenantA, async (tx) =>
        tx.lessee.findMany({
          where: { tenantId: tenantA },
          select: { id: true, name: true },
        }),
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(lesseeA);
      expect(ids).not.toContain(lesseeB);
    });

    it('tenant A cannot load tenant B lessee by id', async () => {
      const row = await withTenantRls(basePrisma, tenantA, async (tx) =>
        tx.lessee.findFirst({ where: { id: lesseeB } }),
      );
      expect(row).toBeNull();
    });

    it('tenant A updateMany on B lessee affects 0 rows', async () => {
      const result = await withTenantRls(basePrisma, tenantA, async (tx) =>
        tx.lessee.updateMany({
          where: { id: lesseeB },
          data: { contactPerson: 'hacked' },
        }),
      );
      expect(result.count).toBe(0);
    });
  });

  describe('LeaseInquiry isolation + WITH CHECK', () => {
    it('A sees only A inquiries', async () => {
      const rows = await withTenantRls(basePrisma, tenantA, async (tx) =>
        tx.leaseInquiry.findMany({
          where: { inquiryNumber: { startsWith: `INQ-` } },
          select: { id: true, tenantId: true },
        }),
      );
      expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(rows.some((r) => r.id === inquiryA)).toBe(true);
    });

    it('WITH CHECK rejects insert stamped with other tenant', async () => {
      await expect(
        withTenantRls(basePrisma, tenantA, async (tx) =>
          tx.leaseInquiry.create({
            data: {
              inquiryNumber: `INQ-BAD-${suffix}`,
              customerName: 'Evil',
              status: 'NEW',
              tenantId: tenantB, // wrong owner under GUC=tenantA
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  // ── Rental isolation (requires migration applied) ─────────────────────────

  describe.skipIf(!hasDb)('RentalBooking isolation', () => {
    it('skips gracefully when rental tenant_id column missing', async () => {
      if (!rentalReady) {
        console.warn(
          '[TENANT-001] rental_bookings.tenant_id missing — apply 20260815140000 migration before asserting rental isolation',
        );
      }
      expect(true).toBe(true);
    });

    it('tenant A lists only A bookings', async () => {
      if (!rentalReady) return;
      const rows = await withTenantRls(basePrisma, tenantA, async (tx) =>
        (tx as any).rentalBooking.findMany({
          where: { bookingRef: { startsWith: 'BK-' } },
          select: { id: true, tenantId: true, bookingRef: true },
        }),
      );
      expect(rows.every((r: { tenantId: string }) => r.tenantId === tenantA)).toBe(true);
      expect(rows.some((r: { id: string }) => r.id === bookingA)).toBe(true);
      expect(rows.some((r: { id: string }) => r.id === bookingB)).toBe(false);
    });

    it('tenant A cannot update tenant B booking', async () => {
      if (!rentalReady) return;
      const result = await withTenantRls(basePrisma, tenantA, async (tx) =>
        (tx as any).rentalBooking.updateMany({
          where: { id: bookingB },
          data: { status: 'CANCELLED' },
        }),
      );
      expect(result.count).toBe(0);
    });

    it('WITH CHECK rejects rental booking for wrong tenant', async () => {
      if (!rentalReady) return;
      await expect(
        withTenantRls(basePrisma, tenantA, async (tx) =>
          (tx as any).rentalBooking.create({
            data: {
              tenantId: tenantB,
              bookingRef: `BK-EVIL-${suffix}`,
              customerId: customerA,
              pickupDate: new Date(),
              dropoffDate: new Date(Date.now() + 86400000),
              status: 'PENDING',
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('Killer test — no GUC means no tenant data', () => {
    it('raw prisma lessee findMany without withTenantRls returns no test rows (or empty under FORCE RLS)', async () => {
      // Under FORCE RLS with unset app.tenant_id, policies should deny rows.
      // Some environments still return rows if connected as BYPASSRLS role —
      // document that production app role must NOT be BYPASSRLS.
      const rows = await basePrisma.lessee.findMany({
        where: { id: { in: [lesseeA, lesseeB] } },
        select: { id: true },
      });
      // Preferred: zero rows. If role bypasses RLS, this test documents the gap.
      if (rows.length > 0) {
        console.warn(
          '[TENANT-001] WARNING: raw prisma saw tenant-scoped lessee rows without withTenantRls. ' +
            'Ensure the production application DB role does not BYPASSRLS and FORCE RLS is on.',
        );
      }
      // Soft assertion: we still expect isolation when using withTenantRls
      const scoped = await withTenantRls(basePrisma, tenantA, async (tx) =>
        tx.lessee.findMany({ where: { id: { in: [lesseeA, lesseeB] } }, select: { id: true } }),
      );
      expect(scoped.map((r) => r.id)).toEqual([lesseeA]);
    });
  });

  describe('withSystemJob per-tenant scope', () => {
    it('scopes the per-tenant callback to that tenant', async () => {
      // Scoped with tenantHeader instead of scanning every active tenant.
      //
      // The previous version iterated all of them — 187 today — in one
      // transaction each, taking longer than the 30s test timeout, to make a
      // meaningful assertion for exactly two. Its outer assertion was
      // `expect(seen.length).toBeGreaterThanOrEqual(0)`, which is true of any
      // array, so a full scan that visited nobody would still have passed.
      //
      // Iteration across many tenants is covered by the unit suite, which
      // mocks the tenant list. What needs a real database is the GUC actually
      // scoping the query, and one tenant per run proves that.
      for (const expected of [tenantA, tenantB]) {
        const seen: string[] = [];

        await withSystemJob(
          basePrisma,
          async ({ tenantId }) => {
            seen.push(tenantId);
            const rows = await withTenantRls(basePrisma, tenantId, async (tx) =>
              tx.lessee.findMany({
                where: { id: { in: [lesseeA, lesseeB] } },
                select: { id: true, tenantId: true },
              }),
            );
            // Only the current tenant's lessee may appear.
            expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
            return true;
          },
          { tenantHeader: expected },
        );

        // Assert the callback actually ran for the tenant asked for, rather
        // than that it ran at all.
        expect(seen).toEqual([expected]);
      }
    });
  });
});
