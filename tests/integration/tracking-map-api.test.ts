/**
 * Contract test for GET /api/logistics/shipments/[id]/tracking-map — seeds a
 * shipment with stops + GPS pings and asserts the map payload shape.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { GET as mapGET } from '@/app/api/logistics/shipments/[id]/tracking-map/route';

const prisma = new PrismaClient();
const TENANT = randomUUID();
const SHIP = randomUUID();

function req(id: string, tenant: string | null = TENANT): NextRequest {
  const headers = new Headers();
  if (tenant !== null) headers.set('x-tenant-id', tenant);
  return new NextRequest(`http://localhost/api/logistics/shipments/${id}/tracking-map`, { headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency, destination_name, created_at, updated_at)
     VALUES ($1,$2,$3,'DISPATCHED','AED','Dubai WH',NOW(),NOW())`,
    SHIP, TENANT, `MAP-${SHIP.slice(0, 6)}`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER`,
  ).catch(() => {});
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_stops (tenant_id, shipment_order_id, sequence_no, stop_type, latitude, longitude, location_name, geofence_radius_m, created_at, updated_at)
     VALUES
       ($1,$2,1,'PICKUP',25.2700,55.3100,'Jebel Ali',300,NOW(),NOW()),
       ($1,$2,2,'DELIVERY',25.3600,55.3100,'Dubai WH',200,NOW(),NOW())`,
    TENANT, SHIP,
  );
  // Two pings.
  for (const [lat, lng, m] of [[25.2750, 55.31, 1], [25.2900, 55.31, 2]] as Array<[number, number, number]>) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_tracking_events (tenant_id, shipment_order_id, event_type, latitude, longitude, source, occurred_at, created_at)
       VALUES ($1,$2,'GPS_PING',$3,$4,'gps',$5::timestamptz,NOW())`,
      TENANT, SHIP, lat, lng, new Date(Date.UTC(2026, 5, 22, 8, m, 0)).toISOString(),
    );
  }
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_tracking_events WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, SHIP).catch(() => {});
  await prisma.$disconnect();
});

describe('tracking-map API', () => {
  it('rejects unauthenticated', async () => {
    const res = await mapGET(req(SHIP, null), ctx(SHIP));
    expect(res.status).toBe(401);
  });

  it('404 for an unknown shipment', async () => {
    const res = await mapGET(req(randomUUID()), ctx(randomUUID()));
    expect(res.status).toBe(404);
  });

  it('returns stops (with radius), trail, and latest position', async () => {
    const res = await mapGET(req(SHIP), ctx(SHIP));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.shipmentNo).toMatch(/^MAP-/);
    expect(body.stops).toHaveLength(2);
    const pickup = body.stops.find((s: { type: string }) => s.type === 'PICKUP');
    expect(pickup.radiusM).toBe(300);     // per-stop override honoured
    expect(pickup.latitude).toBeCloseTo(25.27);

    expect(body.trail.length).toBe(2);
    // Trail is chronological (oldest first).
    expect(body.trail[0].latitude).toBeCloseTo(25.275);
    // Latest is the most recent ping.
    expect(body.latest.latitude).toBeCloseTo(25.29);
  }, 60_000);
});
