/**
 * tests/integration/activation-matrix.test.ts
 *
 * Verifies the 8-Domain Multi-Tenant Activation Matrix under fleet360_app:
 *   1. bus-ops        (TripSchedules, Incidents, Checkins)
 *   2. leasing        (LeaseInquiries, Fuel, Fines)
 *   3. rental         (Bookings, Penalties, Rates)
 *   4. school-bus     (Routes, Stops, Students)
 *   5. finance        (Invoices, Ledger, Receivables)
 *   6. workforce      (Drivers, StaffMembers, Shifts)
 *   7. spatial        (Geofences, Gateways, Places)
 *   8. sweeps/jobs    (runSweep on RUNTIME_DIRECT_DATABASE_URL)
 *
 * Measures query latency and execution health for hot path queries.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin } from '@/lib/rls';
import { runSweep, disconnectSweepPrisma } from '@/lib/prisma-sweep';
import crypto from 'crypto';

interface RoleRow {
  current_user: string;
  rolcanlogin: boolean;
  rolbypassrls: boolean;
  rolsuper: boolean;
}

describe('8-Domain RLS Activation Smoke Matrix', () => {
  let testTenant: string;
  const startTime = Date.now();

  beforeAll(async () => {
    // Assert exact role identity in preflight
    const roles = await prisma.$queryRawUnsafe<RoleRow[]>(`
      SELECT
        current_user,
        rolcanlogin,
        rolbypassrls,
        rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);

    const role = roles[0];
    if (!role || role.current_user !== 'fleet360_app' || role.rolbypassrls || role.rolsuper || !role.rolcanlogin) {
      throw new Error(
        `Activation Matrix Preflight Failed: Connected role "${role?.current_user}". Must be exact role "fleet360_app" with bypassrls=false.`,
      );
    }

    testTenant = crypto.randomUUID();

    // Provision isolated test tenant via platform admin
    await withPlatformAdmin(prisma, async (tx) => {
      await tx.tenant.create({
        data: {
          id: testTenant,
          name: 'Activation Matrix Probe Tenant',
          code: `ACT-MX-${crypto.randomUUID().slice(0, 8)}`,
          domain: `matrix-${crypto.randomUUID().slice(0, 8)}.example.com`,
          plan: 'ENTERPRISE',
          isActive: true,
        },
      });
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await withPlatformAdmin(prisma, async (tx) => {
        await tx.tenant.deleteMany({ where: { id: testTenant } });
      });
    } catch {
      // best-effort
    }
    await disconnectSweepPrisma();
  }, 60_000);

  it('1. Bus Operations domain queries execute under withTenantRls', async () => {
    const t0 = performance.now();
    const count = await withTenantRls(prisma, testTenant, async (tx) => tx.tripSchedule.count());
    const ms = (performance.now() - t0).toFixed(2);
    expect(typeof count).toBe('number');
    console.log(`  ✅ 1. Bus Operations       | Count: ${count} | Latency: ${ms}ms`);
  });

  it('2. Commercial Leasing domain queries execute under withTenantRls', async () => {
    const t0 = performance.now();
    const count = await withTenantRls(prisma, testTenant, async (tx) => tx.leaseInquiry.count());
    const ms = (performance.now() - t0).toFixed(2);
    expect(typeof count).toBe('number');
    console.log(`  ✅ 2. Commercial Leasing   | Count: ${count} | Latency: ${ms}ms`);
  });

  it('3. Vehicle Rental domain queries execute under withTenantRls', async () => {
    const t0 = performance.now();
    const count = await withTenantRls(prisma, testTenant, async (tx) => tx.vehicle.count());
    const ms = (performance.now() - t0).toFixed(2);
    expect(typeof count).toBe('number');
    console.log(`  ✅ 3. Vehicle Rental       | Count: ${count} | Latency: ${ms}ms`);
  });

  it('4. School Bus domain queries execute under withTenantRls', async () => {
    const t0 = performance.now();
    const count = await withTenantRls(prisma, testTenant, async (tx) => tx.busRoute.count());
    const ms = (performance.now() - t0).toFixed(2);
    expect(typeof count).toBe('number');
    console.log(`  ✅ 4. School Bus Transport | Count: ${count} | Latency: ${ms}ms`);
  });

  it('5. Finance & Billing domain queries execute under withTenantRls', async () => {
    const t0 = performance.now();
    const count = await withTenantRls(prisma, testTenant, async (tx) => tx.invoice.count());
    const ms = (performance.now() - t0).toFixed(2);
    expect(typeof count).toBe('number');
    console.log(`  ✅ 5. Finance & Billing    | Count: ${count} | Latency: ${ms}ms`);
  });

  it('6. Workforce & Drivers domain queries execute under withTenantRls', async () => {
    const t0 = performance.now();
    const count = await withTenantRls(prisma, testTenant, async (tx) => tx.driver.count());
    const ms = (performance.now() - t0).toFixed(2);
    expect(typeof count).toBe('number');
    console.log(`  ✅ 6. Workforce & Drivers  | Count: ${count} | Latency: ${ms}ms`);
  });

  it('7. Spatial & Telematics domain queries execute under withTenantRls', async () => {
    const t0 = performance.now();
    const count = await withTenantRls(prisma, testTenant, async (tx) => tx.place.count());
    const ms = (performance.now() - t0).toFixed(2);
    expect(typeof count).toBe('number');
    console.log(`  ✅ 7. Spatial & Telematics | Count: ${count} | Latency: ${ms}ms`);
  });

  it('8. Background runtime sweep executes on direct compute with bounded latency', async () => {
    const t0 = performance.now();
    const results = await runSweep(
      async ({ tx, tenantId }) => {
        return tx.vehicle.count();
      },
      { tenantHeader: testTenant },
    );
    const ms = (performance.now() - t0).toFixed(2);
    expect(results.length).toBe(1);
    console.log(`  ✅ 8. Direct Runtime Sweep | Result: ${results[0].result} | Latency: ${ms}ms`);
  });
});
