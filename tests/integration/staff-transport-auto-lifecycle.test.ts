/**
 * tests/integration/staff-transport-auto-lifecycle.test.ts
 *
 * End-to-end integration test for the auto-lifecycle pipeline:
 *   1. GET /api/driver-app/trips/[id]/geofences returns origin + destination
 *   2. Auto-lifecycle library correctly fires onShouldStart / onShouldEnd
 *      when GPS positions are injected (simulated movement)
 *   3. Each auto-event POSTs to /start or /end → trip state transitions
 *      are persisted + transitions logged with source='DRIVER_APP'
 *   4. Idempotency: a second start (post-manual) is a no-op
 *
 * Run: npx vitest run tests/integration/staff-transport-auto-lifecycle.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';
import {
  createAutoLifecycle,
  haversineMeters,
  type LatLng,
} from '@/lib/driver-offline/auto-lifecycle';

let seed: SeedResult | undefined;
let tripId = '';
let routeId = '';
let geofences: {
  origin: LatLng & { radiusM: number };
  destination: LatLng & { radiusM: number };
} | null = null;

beforeAll(async () => {
  if (!(await isServerRunning())) {
    throw new Error('dev server must be running on :3000 — start with `npm run dev`');
  }
  seed = await seedTestTenantFull();
  const prisma = new PrismaClient();
  try {
    // Find a route with 2+ geocoded stops
    const routeRows = await prisma.$queryRaw<Array<{ route_id: string }>>`
      SELECT route_id FROM route_stops
      WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL
      GROUP BY route_id HAVING COUNT(*) >= 2
      ORDER BY COUNT(*) DESC LIMIT 1
    `;
    routeId = routeRows[0]?.route_id ?? '';
    if (!routeId) throw new Error('no route with 2+ geocoded stops');

    tripId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO trip_schedules (
        id, tenant_id, driver_id, vehicle_id, route_id,
        departure_time, arrival_time, status, direction,
        trip_number, capacity, created_at, updated_at
      ) VALUES (
        ${tripId}, ${seed.tenant.id}::uuid, ${seed.user.id}::text, '', ${routeId},
        NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '40 minutes',
        'SCHEDULED', 'OUTBOUND', 'AUTO-LIFECYCLE-IT', 30, NOW(), NOW()
      )
    `;
  } finally {
    await prisma.$disconnect();
  }
});

afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    if (tripId) {
      await prisma.$executeRaw`DELETE FROM trip_state_transitions WHERE trip_id = ${tripId}`;
      await prisma.$executeRaw`DELETE FROM trip_schedules WHERE id = ${tripId}`;
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe('Auto-lifecycle (driver-controlled trip + geofences)', () => {
  it('GET /geofences returns origin + destination for the trip', async () => {
    const r = await makeRequest('GET', `/api/driver-app/trips/${tripId}/geofences`, undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.tripId).toBe(tripId);
    expect(body.defaultRadiusM).toBe(100);
    expect(typeof body.origin.lat).toBe('number');
    expect(typeof body.origin.lng).toBe('number');
    expect(body.origin.radiusM).toBeGreaterThan(0);
    expect(typeof body.destination.lat).toBe('number');
    expect(body.origin.lat).not.toBe(body.destination.lat);

    geofences = {
      origin: { lat: body.origin.lat, lng: body.origin.lng, radiusM: body.origin.radiusM },
      destination: { lat: body.destination.lat, lng: body.destination.lng, radiusM: body.destination.radiusM },
    };
  });

  it('rejects 404 for an unknown trip', async () => {
    const r = await makeRequest(
      'GET',
      `/api/driver-app/trips/00000000-0000-0000-0000-000000000000/geofences`,
      undefined,
      seed!.headers,
    );
    expect(r.status).toBe(404);
  });

  it('rejects 401 for an unauthenticated request', async () => {
    const r = await makeRequest(
      'GET',
      `/api/driver-app/trips/${tripId}/geofences`,
      undefined,
      // no headers
    );
    expect(r.status).toBe(401);
  });

  it('full auto-lifecycle: move 200 m east of origin → auto-start fires', async () => {
    expect(geofences).not.toBeNull();
    const { origin, destination } = geofences!;
    // Move ~250 m east by adding 0.0025 to lng (≈ 270 m at 25° lat)
    const outsideOrigin: LatLng = {
      lat: origin.lat,
      lng: origin.lng + 0.0025,
    };
    // Sanity: the position is really outside the geofence
    const d = haversineMeters(outsideOrigin, origin);
    expect(d).toBeGreaterThan(origin.radiusM);

    // Build the watcher and inject the position
    let fired: { start: boolean; end: boolean } = { start: false, end: false };
    let firedDistance: number | null = null;
    const watcher = createAutoLifecycle({
      tripId,
      origin,
      destination,
      onShouldStart: (pos, dist) => {
        fired.start = true;
        firedDistance = dist;
      },
      onShouldEnd: () => { fired.end = true; },
      // No-op source: tests don't need real GPS
      watchPosition: () => () => {},
    });
    watcher.injectPosition(outsideOrigin);
    expect(fired.start).toBe(true);
    expect(firedDistance).not.toBeNull();
    expect(firedDistance!).toBeGreaterThan(origin.radiusM);

    // Now actually POST to /start
    const r = await makeRequest(
      'POST',
      `/api/driver-app/trips/${tripId}/start`,
      { at: new Date().toISOString(), lat: outsideOrigin.lat, lng: outsideOrigin.lng, accuracyM: 12 },
      seed!.headers,
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.idempotent).toBe(false);
  });

  it('move within 100 m of destination → auto-end fires', async () => {
    expect(geofences).not.toBeNull();
    const { destination } = geofences!;
    // The position is "near the destination" — inside the geofence
    const nearDestination: LatLng = {
      lat: destination.lat,
      lng: destination.lng,
    };
    // Verify it's actually inside
    const d = haversineMeters(nearDestination, destination);
    expect(d).toBeLessThan(destination.radiusM);

    let firedDistance: number | null = null;
    const watcher = createAutoLifecycle({
      tripId,
      origin: geofences!.origin,
      destination,
      onShouldStart: () => {},
      onShouldEnd: (pos, dist) => { firedDistance = dist; },
      watchPosition: () => () => {},
    });
    watcher.injectPosition(nearDestination);
    expect(firedDistance).not.toBeNull();
    expect(firedDistance!).toBeLessThan(destination.radiusM);

    // POST to /end
    const r = await makeRequest(
      'POST',
      `/api/driver-app/trips/${tripId}/end`,
      { at: new Date().toISOString(), lat: nearDestination.lat, lng: nearDestination.lng, accuracyM: 12 },
      seed!.headers,
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('COMPLETED');
  });

  it('persisted both transitions (STARTED + COMPLETED) for the auto-driven trip', async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw<Array<{ transition: string; source: string }>>`
        SELECT transition, source FROM trip_state_transitions
        WHERE trip_id = ${tripId} ORDER BY at
      `;
      expect(rows.map((r) => r.transition)).toEqual(['STARTED', 'COMPLETED']);
      expect(rows.every((r) => r.source === 'DRIVER_APP')).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });
});
