/**
 * API-contract test for the GPS-ingest + ETA endpoints. Invokes the route
 * handlers directly (no dev server) against a seeded shipment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { POST as trackingPOST } from '@/app/api/logistics/shipments/[id]/tracking/route';
import { GET as etaGET } from '@/app/api/logistics/shipments/[id]/eta/route';

const prisma = new PrismaClient();
const TENANT = randomUUID();
const SHIP = randomUUID();
const DEST = { lat: 25.3600, lng: 55.3100 };

function postReq(id: string, body: unknown, tenant: string | null = TENANT): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (tenant !== null) headers.set('x-tenant-id', tenant);
  return new NextRequest(`http://localhost/api/logistics/shipments/${id}/tracking`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}
function getReq(id: string, tenant: string | null = TENANT): NextRequest {
  const headers = new Headers();
  if (tenant !== null) headers.set('x-tenant-id', tenant);
  return new NextRequest(`http://localhost/api/logistics/shipments/${id}/eta`, { headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders
       (id, tenant_id, shipment_no, status, currency, destination_name, delivery_window_to, created_at, updated_at)
     VALUES ($1,$2,$3,'DISPATCHED','AED','Dubai WH','2026-06-22T12:00:00Z'::timestamptz, NOW(), NOW())`,
    SHIP, TENANT, `ETAAPI-${SHIP.slice(0, 6)}`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_stops (tenant_id, shipment_order_id, sequence_no, stop_type, latitude, longitude, created_at, updated_at)
     VALUES ($1,$2,2,'DELIVERY',$3,$4,NOW(),NOW())`,
    TENANT, SHIP, DEST.lat, DEST.lng,
  );
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_tracking_events WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, SHIP).catch(() => {});
  await prisma.$disconnect();
});

describe('GPS ingest + ETA API', () => {
  it('rejects unauthenticated ingest', async () => {
    const res = await trackingPOST(postReq(SHIP, { latitude: 25.27, longitude: 55.31 }, null), ctx(SHIP));
    expect(res.status).toBe(401);
  });

  it('rejects an ingest without coordinates', async () => {
    const res = await trackingPOST(postReq(SHIP, { eventType: 'GPS_PING' }), ctx(SHIP));
    expect(res.status).toBe(400);
  });

  it('ingests a sequence of pings and returns a live ETA', async () => {
    // Three pings moving north over 4 minutes.
    const pings = [
      { latitude: 25.2700, longitude: 55.31, occurredAt: '2026-06-22T08:00:00Z' },
      { latitude: 25.2745, longitude: 55.31, occurredAt: '2026-06-22T08:02:00Z' },
      { latitude: 25.2790, longitude: 55.31, occurredAt: '2026-06-22T08:04:00Z' },
    ];
    let lastEta: string | null = null;
    for (const p of pings) {
      const res = await trackingPOST(postReq(SHIP, p), ctx(SHIP));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ingested).toBe(true);
      if (body.eta?.etaAt) lastEta = body.eta.etaAt;
    }
    expect(lastEta).toBeTruthy();
  }, 90_000);

  it('GET /eta returns the current prediction', async () => {
    const res = await etaGET(getReq(SHIP), ctx(SHIP));
    expect(res.status).toBe(200);
    const eta = await res.json();
    expect(eta.method).toBeTruthy();
    expect(['observed-speed', 'lane-average', 'default-speed', 'planned', 'arrived']).toContain(eta.method);
    expect(eta).toHaveProperty('etaAt');
    expect(eta).toHaveProperty('remainingKm');
  }, 60_000);

  it('GET /eta returns 404 for an unknown shipment', async () => {
    const res = await etaGET(getReq(randomUUID()), ctx(randomUUID()));
    expect(res.status).toBe(404);
  }, 30_000);
});
