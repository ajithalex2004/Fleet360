/**
 * API-contract tests for the planner endpoints.
 *
 * Invokes the route handlers directly (no dev server needed) with
 * constructed NextRequest objects. Verifies auth gating, status codes, and
 * body shapes. The underlying service logic is covered separately in
 * route-optimizer-service.test.ts; here we test the HTTP wrapper.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ensureRouteOptimizerSchema } from '@/lib/logistics/route-optimizer-schema';

import { POST as optimizePOST } from '@/app/api/logistics/planner/optimize/route';
import { GET as plansGET } from '@/app/api/logistics/planner/plans/route';
import { GET as planGET } from '@/app/api/logistics/planner/plans/[id]/route';
import { POST as commitPOST } from '@/app/api/logistics/planner/plans/[id]/commit/route';
import { POST as discardPOST } from '@/app/api/logistics/planner/plans/[id]/discard/route';

const prisma = new PrismaClient();
const TENANT = `papi-${randomUUID().slice(0, 8)}`;
const USER = 'planner-api-test';
const vehicleIds: string[] = [];
const shipmentIds: string[] = [];

const DEPOT = { lat: 25.20, lng: 55.27 };

function req(url: string, opts: { method?: string; tenant?: string | null; body?: unknown } = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.tenant !== null) headers.set('x-tenant-id', opts.tenant ?? TENANT);
  headers.set('x-user-id', USER);
  return new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function seedVehicle(): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO vehicles (id, license_plate, vehicle_usage, status,
       payload_capacity_kg, payload_capacity_cbm, depot_latitude, depot_longitude, cost_per_km,
       created_at, updated_at)
     VALUES ($1, $2, 'LOGISTICS', 'AVAILABLE', 2000, 50, $3, $4, 2.5, NOW(), NOW())`,
    id, `PA-${id.slice(0,6)}`, DEPOT.lat, DEPOT.lng,
  );
  vehicleIds.push(id);
  return id;
}

async function seedShipment(): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency,
       total_weight_kg, total_volume_cbm, created_at, updated_at)
     VALUES ($1, $2, $3, 'PENDING', 'AED', 300, 5, NOW(), NOW())`,
    id, TENANT, `PA-SHP-${id.slice(0,6)}`,
  );
  shipmentIds.push(id);
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_stops (id, tenant_id, shipment_order_id, sequence_no, stop_type,
       address, latitude, longitude, service_duration_minutes, created_at, updated_at)
     VALUES
       ($1, $2, $3, 1, 'PICKUP',   'P', 25.25, 55.30, 15, NOW(), NOW()),
       ($4, $2, $3, 2, 'DELIVERY', 'D', 25.30, 55.35, 15, NOW(), NOW())`,
    randomUUID(), TENANT, id, randomUUID(),
  );
  return id;
}

beforeAll(async () => { await ensureRouteOptimizerSchema(); }, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_assignments WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_route_plans WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  if (shipmentIds.length) await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = ANY($1::text[])`, shipmentIds).catch(() => {});
  if (vehicleIds.length) await prisma.$executeRawUnsafe(`DELETE FROM vehicles WHERE id = ANY($1::text[])`, vehicleIds).catch(() => {});
  await prisma.$disconnect();
});

describe('planner API contract', () => {
  it('optimize rejects unauthenticated requests', async () => {
    const res = await optimizePOST(req('/api/logistics/planner/optimize', {
      method: 'POST', tenant: null, body: { vehicleIds: ['x'], shipmentIds: ['y'] },
    }));
    expect(res.status).toBe(401);
  });

  it('optimize rejects empty vehicle list with 400', async () => {
    const res = await optimizePOST(req('/api/logistics/planner/optimize', {
      method: 'POST', body: { vehicleIds: [], shipmentIds: ['y'] },
    }));
    expect(res.status).toBe(400);
  });

  it('runs the full optimize → list → get → commit flow', async () => {
    const vId = await seedVehicle();
    const sId = await seedShipment();

    // optimize
    const optRes = await optimizePOST(req('/api/logistics/planner/optimize', {
      method: 'POST',
      body: { vehicleIds: [vId], shipmentIds: [sId], config: { distanceProvider: 'haversine' } },
    }));
    expect(optRes.status).toBe(200);
    const optBody = await optRes.json();
    expect(optBody.planId).toBeTruthy();
    expect(optBody.status).toBe('COMPLETED');
    const planId = optBody.planId;

    // list — our plan should appear
    const listRes = await plansGET(req('/api/logistics/planner/plans'));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.plans.some((p: { id: string }) => p.id === planId)).toBe(true);

    // get single
    const getRes = await planGET(
      req(`/api/logistics/planner/plans/${planId}`),
      { params: Promise.resolve({ id: planId }) },
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.status).toBe('DRAFT');

    // commit
    const commitRes = await commitPOST(
      req(`/api/logistics/planner/plans/${planId}/commit`, { method: 'POST' }),
      { params: Promise.resolve({ id: planId }) },
    );
    expect(commitRes.status).toBe(200);
    const commitBody = await commitRes.json();
    expect(commitBody.ok).toBe(true);
    expect(commitBody.assignmentsCreated).toBe(1);
  }, 60_000);

  it('get returns 404 for an unknown plan id', async () => {
    const res = await planGET(
      req(`/api/logistics/planner/plans/${randomUUID()}`),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(res.status).toBe(404);
  });

  it('discard archives a draft plan', async () => {
    const vId = await seedVehicle();
    const sId = await seedShipment();
    const optRes = await optimizePOST(req('/api/logistics/planner/optimize', {
      method: 'POST',
      body: { vehicleIds: [vId], shipmentIds: [sId], config: { distanceProvider: 'haversine' } },
    }));
    const { planId } = await optRes.json();

    const discardRes = await discardPOST(
      req(`/api/logistics/planner/plans/${planId}/discard`, { method: 'POST' }),
      { params: Promise.resolve({ id: planId }) },
    );
    expect(discardRes.status).toBe(200);

    const getRes = await planGET(
      req(`/api/logistics/planner/plans/${planId}`),
      { params: Promise.resolve({ id: planId }) },
    );
    const body = await getRes.json();
    expect(body.status).toBe('DISCARDED');
  }, 60_000);
});
