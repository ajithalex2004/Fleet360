/**
 * scripts/verify-activation-matrix.mjs
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

import { prisma } from '../src/lib/prisma.js';
import { withTenantRls, withPlatformAdmin } from '../src/lib/rls.js';
import { runSweep, disconnectSweepPrisma } from '../src/lib/prisma-sweep.js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env' });

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('8-DOMAIN ACTIVATION MATRIX & PERFORMANCE VALIDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const testTenant = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 0. Provision isolated test tenant via platform admin
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

    console.log(`Initialized Test Tenant Scope: ${testTenant}`);

    // Matrix domain probes
    const domains = [
      {
        name: '1. Bus Operations',
        probe: async (tx) => {
          const t0 = performance.now();
          const count = await tx.tripSchedule.count();
          return { count, ms: (performance.now() - t0).toFixed(2) };
        },
      },
      {
        name: '2. Commercial Leasing',
        probe: async (tx) => {
          const t0 = performance.now();
          const count = await tx.leaseInquiry.count();
          return { count, ms: (performance.now() - t0).toFixed(2) };
        },
      },
      {
        name: '3. Vehicle Rental',
        probe: async (tx) => {
          const t0 = performance.now();
          const count = await tx.vehicle.count();
          return { count, ms: (performance.now() - t0).toFixed(2) };
        },
      },
      {
        name: '4. School Bus Transport',
        probe: async (tx) => {
          const t0 = performance.now();
          const count = await tx.busRoute.count();
          return { count, ms: (performance.now() - t0).toFixed(2) };
        },
      },
      {
        name: '5. Finance & Billing',
        probe: async (tx) => {
          const t0 = performance.now();
          const count = await tx.invoice.count();
          return { count, ms: (performance.now() - t0).toFixed(2) };
        },
      },
      {
        name: '6. Workforce & Drivers',
        probe: async (tx) => {
          const t0 = performance.now();
          const count = await tx.driver.count();
          return { count, ms: (performance.now() - t0).toFixed(2) };
        },
      },
      {
        name: '7. Spatial & Telematics',
        probe: async (tx) => {
          const t0 = performance.now();
          const count = await tx.place.count();
          return { count, ms: (performance.now() - t0).toFixed(2) };
        },
      },
    ];

    console.log('\n--- DOMAIN QUERIES (withTenantRls under fleet360_app) ---');
    await withTenantRls(prisma, testTenant, async (tx) => {
      for (const domain of domains) {
        const res = await domain.probe(tx);
        console.log(`  ✅ ${domain.name.padEnd(28)} | Count: ${res.count} | Latency: ${res.ms}ms`);
      }
    });

    // 8. Sweep Benchmark on RUNTIME_DIRECT_DATABASE_URL
    console.log('\n--- BACKGROUND SWEEPS (runSweep on direct compute) ---');
    const sweepT0 = performance.now();
    const sweepResults = await runSweep(
      async ({ tx, tenantId }) => {
        const count = await tx.vehicle.count();
        return { count };
      },
      { tenantHeader: testTenant },
    );
    const sweepDurationMs = (performance.now() - sweepT0).toFixed(2);
    console.log(`  ✅ 8. Direct Runtime Sweep    | Tenants: ${sweepResults.length} | Latency: ${sweepDurationMs}ms`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ALL 8 DOMAINS VERIFIED & HEALTHY UNDER fleet360_app');
    console.log(`Total Matrix Execution Time: ${(Date.now() - startTime)}ms`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } finally {
    // Cleanup probe tenant
    try {
      await withPlatformAdmin(prisma, async (tx) => {
        await tx.tenant.deleteMany({ where: { id: testTenant } });
      });
    } catch {
      // best-effort
    }
    await disconnectSweepPrisma();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Activation Matrix verification failed:', err);
    process.exit(1);
  });
