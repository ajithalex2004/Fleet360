/**
 * Integration test for evaluateShipmentGeofences — seeds a shipment with
 * pickup + delivery stops, then drives GPS pings across the geofence
 * boundaries and asserts the right exceptions are raised.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { evaluateShipmentGeofences } from '@/lib/logistics/geofence-service';
import { ensureGeofenceSchema } from '@/lib/logistics/geofence-schema';

const prisma = new PrismaClient();
const TENANT = randomUUID();
const SHIP = randomUUID();

// Corridor runs north along lng 55.31 from pickup (A) to delivery (B), ~10km.
const PICKUP = { lat: 25.2700, lng: 55.3100 };
const DELIVERY = { lat: 25.3600, lng: 55.3100 };

let t = 0;
async function ping(lat: number, lng: number) {
  // Each ping a minute after the last so ordering is deterministic.
  t += 1;
  const at = new Date(Date.UTC(2026, 5, 22, 8, t, 0)).toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_tracking_events (tenant_id, shipment_order_id, event_type, latitude, longitude, source, occurred_at, created_at)
     VALUES ($1,$2,'GPS_PING',$3,$4,'gps',$5::timestamptz,NOW())`,
    TENANT, SHIP, lat, lng, at,
  );
}

beforeAll(async () => {
  await ensureGeofenceSchema();
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency, created_at, updated_at)
     VALUES ($1,$2,$3,'DISPATCHED','AED',NOW(),NOW())`,
    SHIP, TENANT, `GF-${SHIP.slice(0, 6)}`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_stops (tenant_id, shipment_order_id, sequence_no, stop_type, latitude, longitude, location_name, geofence_radius_m, created_at, updated_at)
     VALUES
       ($1,$2,1,'PICKUP',$3,$4,'Jebel Ali',200,NOW(),NOW()),
       ($1,$2,2,'DELIVERY',$5,$6,'Dubai WH',200,NOW(),NOW())`,
    TENANT, SHIP, PICKUP.lat, PICKUP.lng, DELIVERY.lat, DELIVERY.lng,
  );
}, 60_000);

beforeEach(async () => {
  // Each scenario starts with a clean slate of pings + exceptions.
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_tracking_events WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_exceptions WHERE tenant_id = $1`, TENANT).catch(() => {});
  t = 0;
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_exceptions WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_tracking_events WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, SHIP).catch(() => {});
  await prisma.$disconnect();
});

async function openExceptionsOfType(type: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*) AS c FROM logistics_shipment_exceptions
      WHERE tenant_id = $1 AND shipment_order_id = $2 AND exception_type = $3 AND status = 'OPEN'`,
    TENANT, SHIP, type,
  );
  return Number(rows[0].c);
}

describe('evaluateShipmentGeofences (live DB)', () => {
  it('raises GEOFENCE_ARRIVED_PICKUP when the truck enters the pickup zone', async () => {
    await ping(25.2740, 55.3100);   // prev: ~440m N of pickup → outside 200m
    await ping(25.2705, 55.3100);   // curr: ~55m N → inside

    const r = await evaluateShipmentGeofences({ tenantId: TENANT, shipmentOrderId: SHIP, suppressNotifications: true });
    expect(r.events.some(e => e.type === 'ENTER')).toBe(true);
    expect(r.raised).toBeGreaterThanOrEqual(1);
    expect(await openExceptionsOfType('GEOFENCE_ARRIVED_PICKUP')).toBe(1);
  }, 60_000);

  it('does not re-raise while the truck stays inside the zone', async () => {
    await ping(25.2740, 55.3100);   // outside
    await ping(25.2705, 55.3100);   // inside → ENTER
    await evaluateShipmentGeofences({ tenantId: TENANT, shipmentOrderId: SHIP, suppressNotifications: true });

    await ping(25.2702, 55.3100);   // still inside → no transition
    const r2 = await evaluateShipmentGeofences({ tenantId: TENANT, shipmentOrderId: SHIP, suppressNotifications: true });
    expect(r2.events.some(e => e.type === 'ENTER')).toBe(false);
    // Still exactly one arrival exception (the de-dup + transition logic held).
    expect(await openExceptionsOfType('GEOFENCE_ARRIVED_PICKUP')).toBe(1);
  }, 60_000);

  it('raises GEOFENCE_DEPARTED_PICKUP when the truck leaves the zone', async () => {
    await ping(25.2705, 55.3100);   // inside
    await ping(25.2745, 55.3100);   // ~500m N → outside → EXIT
    const r = await evaluateShipmentGeofences({ tenantId: TENANT, shipmentOrderId: SHIP, suppressNotifications: true });
    expect(r.events.some(e => e.type === 'EXIT')).toBe(true);
    expect(await openExceptionsOfType('GEOFENCE_DEPARTED_PICKUP')).toBe(1);
  }, 60_000);

  it('raises GEOFENCE_ROUTE_DEVIATION when the truck strays far off the corridor', async () => {
    // Corridor is the line A→B at lng 55.31. Move far east (~7km).
    await ping(25.3100, 55.3100);   // on-route
    await ping(25.3100, 55.3800);   // ~7km east → outside the 5km corridor
    const r = await evaluateShipmentGeofences({ tenantId: TENANT, shipmentOrderId: SHIP, suppressNotifications: true });
    expect(r.events.some(e => e.type === 'DEVIATION')).toBe(true);
    expect(await openExceptionsOfType('GEOFENCE_ROUTE_DEVIATION')).toBe(1);
  }, 60_000);

  it('stays quiet while travelling along the corridor', async () => {
    await ping(25.2800, 55.3100);   // on-route
    await ping(25.3000, 55.3100);   // still on-route, moved north
    const r = await evaluateShipmentGeofences({ tenantId: TENANT, shipmentOrderId: SHIP, suppressNotifications: true });
    expect(r.events.length).toBe(0);
    expect(r.raised).toBe(0);
  }, 60_000);

  it('returns a not-found result for an unknown shipment', async () => {
    const r = await evaluateShipmentGeofences({ tenantId: TENANT, shipmentOrderId: randomUUID(), suppressNotifications: true });
    expect(r.reason).toMatch(/not found/i);
    expect(r.raised).toBe(0);
  }, 30_000);
});
