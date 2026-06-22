/**
 * Integration test for the route optimizer service layer.
 *
 * Seeds vehicles + shipments + stops in a unique tenant, runs the full
 * optimize → persist → commit pipeline against real Postgres, and verifies
 * the plan + assignments land correctly.
 *
 * Geocoding is pre-seeded into logistics_geocode_cache so the test doesn't
 * depend on live Mapbox — but the distance matrix still uses haversine when
 * no token (or Mapbox when a token is present). Either way the solver runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ensureRouteOptimizerSchema } from '@/lib/logistics/route-optimizer-schema';
import {
  runOptimization,
  commitPlan,
  getPlan,
  discardPlan,
  listPlans,
} from '@/lib/logistics/route-optimizer-service';

const prisma = new PrismaClient();
const TENANT = `ros-${randomUUID().slice(0, 8)}`;

const vehicleIds: string[] = [];
const shipmentIds: string[] = [];

// GCC coordinates so haversine produces realistic distances.
const DEPOT = { lat: 25.20, lng: 55.27 };  // Dubai
const PTS = [
  { lat: 25.25, lng: 55.30 },  // s0 pickup
  { lat: 25.30, lng: 55.35 },  // s0 delivery
  { lat: 25.22, lng: 55.28 },  // s1 pickup
  { lat: 25.18, lng: 55.25 },  // s1 delivery
];

async function seedVehicle(capacityKg: number, capacityCbm: number): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO vehicles (id, license_plate, vehicle_usage, status,
       payload_capacity_kg, payload_capacity_cbm, depot_latitude, depot_longitude, cost_per_km,
       created_at, updated_at)
     VALUES ($1, $2, 'LOGISTICS', 'AVAILABLE', $3, $4, $5, $6, 2.5, NOW(), NOW())`,
    id, `RO-${id.slice(0,6)}`, capacityKg, capacityCbm, DEPOT.lat, DEPOT.lng,
  );
  vehicleIds.push(id);
  return id;
}

async function seedShipment(idx: number, weightKg: number, volumeCbm: number): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency,
       total_weight_kg, total_volume_cbm, created_at, updated_at)
     VALUES ($1, $2, $3, 'PENDING', 'AED', $4, $5, NOW(), NOW())`,
    id, TENANT, `RO-SHP-${idx}-${id.slice(0,6)}`, weightKg, volumeCbm,
  );
  shipmentIds.push(id);

  const pickup = PTS[idx * 2];
  const delivery = PTS[idx * 2 + 1];
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_stops (id, tenant_id, shipment_order_id, sequence_no, stop_type,
       address, latitude, longitude, service_duration_minutes, created_at, updated_at)
     VALUES
       ($1, $2, $3, 1, 'PICKUP',   $4, $5, $6, 15, NOW(), NOW()),
       ($7, $2, $3, 2, 'DELIVERY', $8, $9, $10, 15, NOW(), NOW())`,
    randomUUID(), TENANT, id, `Pickup ${idx}`, pickup.lat, pickup.lng,
    randomUUID(), `Delivery ${idx}`, delivery.lat, delivery.lng,
  );
  return id;
}

beforeAll(async () => {
  await ensureRouteOptimizerSchema();
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_assignments WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_route_plans WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  if (shipmentIds.length) await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = ANY($1::text[])`, shipmentIds).catch(() => {});
  if (vehicleIds.length) await prisma.$executeRawUnsafe(`DELETE FROM vehicles WHERE id = ANY($1::text[])`, vehicleIds).catch(() => {});
  await prisma.$disconnect();
});

describe('route optimizer service (live DB)', () => {
  it('runs optimize → persist → commit and creates assignments', async () => {
    const vId = await seedVehicle(2000, 50);
    const s0 = await seedShipment(0, 300, 5);
    const s1 = await seedShipment(1, 400, 6);

    // Force haversine so the test never depends on a live Mapbox token.
    const opt = await runOptimization({
      tenantId: TENANT,
      vehicleIds: [vId],
      shipmentIds: [s0, s1],
      createdBy: 'integration-test',
      config: { distanceProvider: 'haversine' },
    });

    expect(opt.planId).toBeTruthy();
    expect(opt.status).toBe('COMPLETED');
    expect(opt.result.summary.shipmentsAssigned).toBe(2);
    expect(opt.result.summary.shipmentsUnassigned).toBe(0);
    expect(opt.result.routes.length).toBeGreaterThanOrEqual(1);

    // Plan persisted as DRAFT
    const fetched = await getPlan(TENANT, opt.planId);
    expect(fetched?.status).toBe('DRAFT');

    // Commit creates assignments
    const commit = await commitPlan(TENANT, opt.planId, 'integration-test');
    expect(commit.assignmentsCreated).toBe(2);

    const after = await getPlan(TENANT, opt.planId);
    expect(after?.status).toBe('COMMITTED');

    // Assignment rows exist and link to the plan
    const assignments = await prisma.$queryRawUnsafe<Array<{ shipment_order_id: string; vehicle_id: string; route_plan_id: string }>>(
      `SELECT shipment_order_id, vehicle_id, route_plan_id
         FROM logistics_assignments WHERE tenant_id = $1 AND route_plan_id = $2`,
      TENANT, opt.planId,
    );
    expect(assignments.length).toBe(2);
    expect(assignments.every(a => a.vehicle_id === vId)).toBe(true);

    // Shipments flipped to ASSIGNED
    const statuses = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT status FROM logistics_shipment_orders WHERE id = ANY($1::text[])`,
      [s0, s1],
    );
    expect(statuses.every(s => s.status === 'ASSIGNED')).toBe(true);
  }, 60_000);

  it('commit is idempotent', async () => {
    const vId = await seedVehicle(2000, 50);
    const s = await seedShipment(0, 200, 3);
    const opt = await runOptimization({
      tenantId: TENANT, vehicleIds: [vId], shipmentIds: [s],
      config: { distanceProvider: 'haversine' },
    });
    await commitPlan(TENANT, opt.planId, 'test');
    const second = await commitPlan(TENANT, opt.planId, 'test');
    expect(second.assignmentsCreated).toBe(0);  // no-op on re-commit
  }, 60_000);

  it('marks a shipment unassigned when no vehicle has capacity', async () => {
    const smallVehicle = await seedVehicle(100, 1);   // tiny truck
    const bigShipment = await seedShipment(1, 5000, 80); // 5t / 80cbm
    const opt = await runOptimization({
      tenantId: TENANT, vehicleIds: [smallVehicle], shipmentIds: [bigShipment],
      config: { distanceProvider: 'haversine' },
    });
    expect(opt.status).toBe('PARTIAL');
    expect(opt.result.summary.shipmentsUnassigned).toBe(1);
  }, 60_000);

  it('discard archives a draft plan', async () => {
    const vId = await seedVehicle(2000, 50);
    const s = await seedShipment(0, 200, 3);
    const opt = await runOptimization({
      tenantId: TENANT, vehicleIds: [vId], shipmentIds: [s],
      config: { distanceProvider: 'haversine' },
    });
    await discardPlan(TENANT, opt.planId);
    const after = await getPlan(TENANT, opt.planId);
    expect(after?.status).toBe('DISCARDED');
  }, 60_000);

  it('listPlans returns recent plans for the tenant', async () => {
    const plans = await listPlans(TENANT, { limit: 50 });
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every(p => typeof p.id === 'string')).toBe(true);
  }, 60_000);

  it('rejects an optimize with no vehicles', async () => {
    await expect(runOptimization({
      tenantId: TENANT, vehicleIds: [], shipmentIds: ['x'],
    })).rejects.toThrow(/vehicle/i);
  });
});
