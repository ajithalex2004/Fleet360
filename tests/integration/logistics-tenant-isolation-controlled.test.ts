/**
 * Logistics — Controlled Non-Empty Tenant Isolation Integration Test.
 *
 * Fulfills Check 1:
 * - Uses controlled staging records for Tenant A and Tenant B.
 * - Confirms Tenant A sees its expected shipment, driver, and vehicle data, while
 *   Tenant B cannot access those records (and vice-versa).
 * - Proves non-empty isolated reads (distinguishes correct isolation from empty tables).
 * - Verifies connection pool isolation under sequential alternating requests:
 *   Tenant A -> Tenant B -> Tenant A -> Tenant B -> Tenant A across pooled connections.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

const hasDb = Boolean(process.env.DATABASE_URL);
const runId = Date.now().toString();

if (hasDb && !process.env.RUNTIME_DIRECT_DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is set but RUNTIME_DIRECT_DATABASE_URL is not — this suite ' +
      'requires it explicitly and has no built-in default connection string.'
  );
}
// Placeholder is only ever used when hasDb is false, in which case
// describe.skipIf below skips every test and this URL is never connected to.
const appDbUrl = process.env.RUNTIME_DIRECT_DATABASE_URL || 'postgresql://unset:unset@localhost:5432/unset';

const appPrisma = new PrismaClient({ datasources: { db: { url: appDbUrl } } });

const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();

const vehAId = crypto.randomUUID();
const vehBId = crypto.randomUUID();

const drvAId = crypto.randomUUID();
const drvBId = crypto.randomUUID();

const shpAId = crypto.randomUUID();
const shpBId = crypto.randomUUID();

const shpNoA = `SHP-ISO-A-${runId.slice(-6)}`;
const shpNoB = `SHP-ISO-B-${runId.slice(-6)}`;

describe.skipIf(!hasDb)('Logistics Tenant Isolation (Controlled Staging Records)', () => {
  beforeAll(async () => {
    // 1. Create Tenant A and Tenant B
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: `Isolation Tenant A ${runId}`, code: `iso-a-${runId}` },
        { id: tenantB, name: `Isolation Tenant B ${runId}`, code: `iso-b-${runId}` },
      ],
    });

    // 2. Seed controlled records for Tenant A (using Tenant A RLS scope)
    await withTenantRls(appPrisma, tenantA, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO vehicles (id, tenant_id, make, model, license_plate, vehicle_usage, status, updated_at)
         VALUES ($1, $2, 'Toyota', 'HiAce', $3, 'LOGISTICS', 'AVAILABLE', NOW())`,
        vehAId, tenantA, `ISO-A-${runId.slice(-4)}`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name, license_number, status, updated_at)
         VALUES ($1, $2, 'Alice', 'TenantA', $3, 'ACTIVE', NOW())`,
        drvAId, tenantA, `LIC-A-${runId.slice(-4)}`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, notes, status, booking_mode, marketplace_status)
         VALUES ($1, $2, $3, 'Controlled Shipment Tenant A', 'DRAFT', 'SPOT', 'PRIVATE')`,
        shpAId, tenantA, shpNoA
      );
    });

    // 3. Seed controlled records for Tenant B (using Tenant B RLS scope)
    await withTenantRls(appPrisma, tenantB, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO vehicles (id, tenant_id, make, model, license_plate, vehicle_usage, status, updated_at)
         VALUES ($1, $2, 'Volvo', 'FH16', $3, 'LOGISTICS', 'AVAILABLE', NOW())`,
        vehBId, tenantB, `ISO-B-${runId.slice(-4)}`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO drivers (id, tenant_id, first_name, last_name, license_number, status, updated_at)
         VALUES ($1, $2, 'Bob', 'TenantB', $3, 'ACTIVE', NOW())`,
        drvBId, tenantB, `LIC-B-${runId.slice(-4)}`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, notes, status, booking_mode, marketplace_status)
         VALUES ($1, $2, $3, 'Controlled Shipment Tenant B', 'DRAFT', 'SPOT', 'PRIVATE')`,
        shpBId, tenantB, shpNoB
      );
    });
  });

  afterAll(async () => {
    // Clean up controlled test records
    await appPrisma.$disconnect();
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id IN ($1, $2)`, shpAId, shpBId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM drivers WHERE id IN ($1, $2)`, drvAId, drvBId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM vehicles WHERE id IN ($1, $2)`, vehAId, vehBId).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } }).catch(() => {});
  });

  it('proves Tenant A reads its non-empty controlled records and sees ZERO of Tenant B records', async () => {
    await withTenantRls(appPrisma, tenantA, async (tx) => {
      // 1. Vehicles
      const vehicles = await tx.$queryRawUnsafe<Array<{ id: string; make: string }>>(
        `SELECT id, make FROM vehicles WHERE id IN ($1, $2)`,
        vehAId, vehBId
      );
      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe(vehAId);
      expect(vehicles[0].make).toBe('Toyota');

      // 2. Drivers
      const drivers = await tx.$queryRawUnsafe<Array<{ id: string; first_name: string }>>(
        `SELECT id, first_name FROM drivers WHERE id IN ($1, $2)`,
        drvAId, drvBId
      );
      expect(drivers).toHaveLength(1);
      expect(drivers[0].id).toBe(drvAId);
      expect(drivers[0].first_name).toBe('Alice');

      // 3. Shipments
      const shipments = await tx.$queryRawUnsafe<Array<{ id: string; shipment_no: string }>>(
        `SELECT id, shipment_no FROM logistics_shipment_orders WHERE id IN ($1, $2)`,
        shpAId, shpBId
      );
      expect(shipments).toHaveLength(1);
      expect(shipments[0].id).toBe(shpAId);
      expect(shipments[0].shipment_no).toBe(shpNoA);
    });
  });

  it('proves Tenant B reads its non-empty controlled records and sees ZERO of Tenant A records', async () => {
    await withTenantRls(appPrisma, tenantB, async (tx) => {
      // 1. Vehicles
      const vehicles = await tx.$queryRawUnsafe<Array<{ id: string; make: string }>>(
        `SELECT id, make FROM vehicles WHERE id IN ($1, $2)`,
        vehAId, vehBId
      );
      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe(vehBId);
      expect(vehicles[0].make).toBe('Volvo');

      // 2. Drivers
      const drivers = await tx.$queryRawUnsafe<Array<{ id: string; first_name: string }>>(
        `SELECT id, first_name FROM drivers WHERE id IN ($1, $2)`,
        drvAId, drvBId
      );
      expect(drivers).toHaveLength(1);
      expect(drivers[0].id).toBe(drvBId);
      expect(drivers[0].first_name).toBe('Bob');

      // 3. Shipments
      const shipments = await tx.$queryRawUnsafe<Array<{ id: string; shipment_no: string }>>(
        `SELECT id, shipment_no FROM logistics_shipment_orders WHERE id IN ($1, $2)`,
        shpAId, shpBId
      );
      expect(shipments).toHaveLength(1);
      expect(shipments[0].id).toBe(shpBId);
      expect(shipments[0].shipment_no).toBe(shpNoB);
    });
  });

  it('proves connection pool isolation under sequential alternating requests: A -> B -> A -> B -> A', async () => {
    const sequence = [
      { tenant: tenantA, expectedVeh: vehAId, expectedDrv: drvAId, expectedShp: shpAId, forbiddenShp: shpBId, label: 'A (step 1)' },
      { tenant: tenantB, expectedVeh: vehBId, expectedDrv: drvBId, expectedShp: shpBId, forbiddenShp: shpAId, label: 'B (step 2)' },
      { tenant: tenantA, expectedVeh: vehAId, expectedDrv: drvAId, expectedShp: shpAId, forbiddenShp: shpBId, label: 'A (step 3)' },
      { tenant: tenantB, expectedVeh: vehBId, expectedDrv: drvBId, expectedShp: shpBId, forbiddenShp: shpAId, label: 'B (step 4)' },
      { tenant: tenantA, expectedVeh: vehAId, expectedDrv: drvAId, expectedShp: shpAId, forbiddenShp: shpBId, label: 'A (step 5)' },
    ];

    for (const step of sequence) {
      await withTenantRls(appPrisma, step.tenant, async (tx) => {
        // Query vehicles
        const v = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM vehicles WHERE id IN ($1, $2)`,
          vehAId, vehBId
        );
        expect(v, `Vehicles leaked in step ${step.label}`).toHaveLength(1);
        expect(v[0].id).toBe(step.expectedVeh);

        // Query drivers
        const d = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM drivers WHERE id IN ($1, $2)`,
          drvAId, drvBId
        );
        expect(d, `Drivers leaked in step ${step.label}`).toHaveLength(1);
        expect(d[0].id).toBe(step.expectedDrv);

        // Query shipments
        const s = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM logistics_shipment_orders WHERE id IN ($1, $2)`,
          shpAId, shpBId
        );
        expect(s, `Shipments leaked in step ${step.label}`).toHaveLength(1);
        expect(s[0].id).toBe(step.expectedShp);

        // Verify prohibited record is absent
        const forbidden = s.find(row => row.id === step.forbiddenShp);
        expect(forbidden, `Found cross-tenant record ${step.forbiddenShp} during step ${step.label}`).toBeUndefined();
      });
    }
  });

  it('fails closed when no tenant context is provided (bare connection without tenant context)', async () => {
    // A bare query without setting app.tenant_id must return 0 rows for both tenants' records
    const shipments = await appPrisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM logistics_shipment_orders WHERE id IN ($1, $2)`,
      shpAId, shpBId
    );
    expect(shipments).toHaveLength(0);

    const vehicles = await appPrisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM vehicles WHERE id IN ($1, $2)`,
      vehAId, vehBId
    );
    expect(vehicles).toHaveLength(0);

    const drivers = await appPrisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM drivers WHERE id IN ($1, $2)`,
      drvAId, drvBId
    );
    expect(drivers).toHaveLength(0);
  });
});
