/**
 * Contract test for GET /api/logistics/planner/inputs.
 *
 * Verifies the vehicle/shipment selection feed only returns solver-usable
 * rows: vehicles need payload capacity + depot; shipments need both a
 * pickup and delivery stop.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ensureRouteOptimizerSchema } from '@/lib/logistics/route-optimizer-schema';
import { GET as inputsGET } from '@/app/api/logistics/planner/inputs/route';

const prisma = new PrismaClient();
const TENANT = `pin-${randomUUID().slice(0, 8)}`;
const cleanup = { vehicles: [] as string[], shipments: [] as string[] };

function req(type: string, tenant: string | null = TENANT): NextRequest {
  const headers = new Headers();
  if (tenant !== null) headers.set('x-tenant-id', tenant);
  return new NextRequest(`http://localhost/api/logistics/planner/inputs?type=${type}`, { headers });
}

beforeAll(async () => { await ensureRouteOptimizerSchema(); }, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  if (cleanup.shipments.length) await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = ANY($1::text[])`, cleanup.shipments).catch(() => {});
  if (cleanup.vehicles.length) await prisma.$executeRawUnsafe(`DELETE FROM vehicles WHERE id = ANY($1::text[])`, cleanup.vehicles).catch(() => {});
  await prisma.$disconnect();
});

describe('planner inputs endpoint', () => {
  it('rejects unauthenticated', async () => {
    const res = await inputsGET(req('vehicles', null));
    expect(res.status).toBe(401);
  });

  it('returns only vehicles with payload capacity AND depot', async () => {
    // Eligible vehicle
    const good = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO vehicles (id, license_plate, vehicle_usage, payload_capacity_kg, depot_latitude, depot_longitude, created_at, updated_at)
       VALUES ($1, 'GOOD-1', 'LOGISTICS', 2000, 25.2, 55.3, NOW(), NOW())`,
      good,
    );
    // Ineligible: has capacity but no depot
    const noDepot = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO vehicles (id, license_plate, vehicle_usage, payload_capacity_kg, created_at, updated_at)
       VALUES ($1, 'NODEPOT-1', 'LOGISTICS', 2000, NOW(), NOW())`,
      noDepot,
    );
    cleanup.vehicles.push(good, noDepot);

    const res = await inputsGET(req('vehicles'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.vehicles.map((v: { id: string }) => v.id);
    expect(ids).toContain(good);
    expect(ids).not.toContain(noDepot);
  }, 30_000);

  it('returns only shipments that have both pickup and delivery stops', async () => {
    // Complete shipment
    const complete = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency, created_at, updated_at)
       VALUES ($1, $2, 'COMPLETE-1', 'PENDING', 'AED', NOW(), NOW())`,
      complete, TENANT,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_shipment_stops (id, tenant_id, shipment_order_id, sequence_no, stop_type, created_at, updated_at)
       VALUES ($1,$2,$3,1,'PICKUP',NOW(),NOW()), ($4,$2,$3,2,'DELIVERY',NOW(),NOW())`,
      randomUUID(), TENANT, complete, randomUUID(),
    );
    // Pickup-only shipment (incomplete)
    const pickupOnly = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency, created_at, updated_at)
       VALUES ($1, $2, 'INCOMPLETE-1', 'PENDING', 'AED', NOW(), NOW())`,
      pickupOnly, TENANT,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_shipment_stops (id, tenant_id, shipment_order_id, sequence_no, stop_type, created_at, updated_at)
       VALUES ($1,$2,$3,1,'PICKUP',NOW(),NOW())`,
      randomUUID(), TENANT, pickupOnly,
    );
    cleanup.shipments.push(complete, pickupOnly);

    const res = await inputsGET(req('shipments'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.shipments.map((s: { id: string }) => s.id);
    expect(ids).toContain(complete);
    expect(ids).not.toContain(pickupOnly);
  }, 30_000);

  it('returns 400 for an unknown type', async () => {
    const res = await inputsGET(req('garbage'));
    expect(res.status).toBe(400);
  });
});
