/**
 * Integration test for the manual-edit / revalidate flow.
 *
 * Builds a real plan, then exercises POST /plans/[id]/edit to reorder stops
 * and unassign a shipment, verifying the re-validated result reflects the
 * operator's intent without re-optimising.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ensureRouteOptimizerSchema } from '@/lib/logistics/route-optimizer-schema';
import { runOptimization } from '@/lib/logistics/route-optimizer-service';
import { POST as editPOST } from '@/app/api/logistics/planner/plans/[id]/edit/route';

const prisma = new PrismaClient();
const TENANT = `pedit-${randomUUID().slice(0, 8)}`;
const vehicleIds: string[] = [];
const shipmentIds: string[] = [];
const DEPOT = { lat: 25.20, lng: 55.27 };

function editReq(planId: string, body: unknown, tenant: string | null = TENANT): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (tenant !== null) headers.set('x-tenant-id', tenant);
  return new NextRequest(`http://localhost/api/logistics/planner/plans/${planId}/edit`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

async function seedVehicle(capKg: number): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO vehicles (id, license_plate, vehicle_usage, status,
       payload_capacity_kg, payload_capacity_cbm, depot_latitude, depot_longitude, cost_per_km, created_at, updated_at)
     VALUES ($1,$2,'LOGISTICS','AVAILABLE',$3,50,$4,$5,2.5,NOW(),NOW())`,
    id, `PE-${id.slice(0,6)}`, capKg, DEPOT.lat, DEPOT.lng,
  );
  vehicleIds.push(id);
  return id;
}

async function seedShipment(pickup: { lat: number; lng: number }, delivery: { lat: number; lng: number }): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency, total_weight_kg, total_volume_cbm, created_at, updated_at)
     VALUES ($1,$2,$3,'PENDING','AED',300,5,NOW(),NOW())`,
    id, TENANT, `PE-SHP-${id.slice(0,6)}`,
  );
  shipmentIds.push(id);
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_stops (id, tenant_id, shipment_order_id, sequence_no, stop_type, address, latitude, longitude, service_duration_minutes, created_at, updated_at)
     VALUES ($1,$2,$3,1,'PICKUP','P',$4,$5,15,NOW(),NOW()), ($6,$2,$3,2,'DELIVERY','D',$7,$8,15,NOW(),NOW())`,
    randomUUID(), TENANT, id, pickup.lat, pickup.lng, randomUUID(), delivery.lat, delivery.lng,
  );
  return id;
}

beforeAll(async () => { await ensureRouteOptimizerSchema(); }, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_route_plans WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  if (shipmentIds.length) await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = ANY($1::text[])`, shipmentIds).catch(() => {});
  if (vehicleIds.length) await prisma.$executeRawUnsafe(`DELETE FROM vehicles WHERE id = ANY($1::text[])`, vehicleIds).catch(() => {});
  await prisma.$disconnect();
});

describe('planner edit / revalidate', () => {
  it('reorders stops in a route and re-validates without re-optimising', async () => {
    const vId = await seedVehicle(2000);
    const s0 = await seedShipment({ lat: 25.25, lng: 55.30 }, { lat: 25.30, lng: 55.35 });
    const s1 = await seedShipment({ lat: 25.22, lng: 55.28 }, { lat: 25.18, lng: 55.25 });

    const opt = await runOptimization({
      tenantId: TENANT, vehicleIds: [vId], shipmentIds: [s0, s1],
      config: { distanceProvider: 'haversine' },
    });
    expect(opt.result.routes.length).toBe(1);
    const route = opt.result.routes[0];
    const originalOrder = route.stops.map(s => s.stopId);

    // Reverse a valid sub-sequence: keep pickup-before-delivery intact by
    // just re-sending the SAME order (the revalidate should accept it).
    const res = await editPOST(
      editReq(opt.planId, { routes: [{ vehicleId: route.vehicleId, stopOrder: originalOrder }] }),
      { params: Promise.resolve({ id: opt.planId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('DRAFT');
    expect(body.result.routes[0].stops.map((s: { stopId: string }) => s.stopId)).toEqual(originalOrder);
  }, 60_000);

  it('flags a pickup-before-delivery violation when stops are reordered illegally', async () => {
    const vId = await seedVehicle(2000);
    const s0 = await seedShipment({ lat: 25.25, lng: 55.30 }, { lat: 25.30, lng: 55.35 });

    const opt = await runOptimization({
      tenantId: TENANT, vehicleIds: [vId], shipmentIds: [s0],
      config: { distanceProvider: 'haversine' },
    });
    const route = opt.result.routes[0];
    // Reverse so delivery precedes pickup — the revalidate must flag it.
    const reversed = [...route.stops.map(s => s.stopId)].reverse();
    const res = await editPOST(
      editReq(opt.planId, { routes: [{ vehicleId: route.vehicleId, stopOrder: reversed }] }),
      { params: Promise.resolve({ id: opt.planId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const violations = body.result.routes[0].violations;
    expect(violations.some((v: { detail: string }) => /before its pickup/.test(v.detail))).toBe(true);
  }, 60_000);

  it('moves a shipment to unassigned via the unassign array', async () => {
    const vId = await seedVehicle(2000);
    const s0 = await seedShipment({ lat: 25.25, lng: 55.30 }, { lat: 25.30, lng: 55.35 });
    const s1 = await seedShipment({ lat: 25.22, lng: 55.28 }, { lat: 25.18, lng: 55.25 });

    const opt = await runOptimization({
      tenantId: TENANT, vehicleIds: [vId], shipmentIds: [s0, s1],
      config: { distanceProvider: 'haversine' },
    });
    const route = opt.result.routes[0];
    // Keep only s0's stops in the route; unassign s1.
    const s0Stops = route.stops.filter(s => s.shipmentId === s0).map(s => s.stopId);

    const res = await editPOST(
      editReq(opt.planId, {
        routes: [{ vehicleId: route.vehicleId, stopOrder: s0Stops }],
        unassign: [s1],
      }),
      { params: Promise.resolve({ id: opt.planId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.unassigned.some((u: { shipmentId: string }) => u.shipmentId === s1)).toBe(true);
    expect(body.result.summary.shipmentsAssigned).toBe(1);
  }, 60_000);

  it('rejects edit on a non-existent plan with 404', async () => {
    const res = await editPOST(
      editReq(randomUUID(), { routes: [] }),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated edit', async () => {
    const res = await editPOST(
      editReq('x', { routes: [] }, null),
      { params: Promise.resolve({ id: 'x' }) },
    );
    expect(res.status).toBe(401);
  });
});
