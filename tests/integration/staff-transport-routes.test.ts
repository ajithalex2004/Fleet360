/**
 * tests/integration/staff-transport-routes.test.ts
 *
 * Integration tests for the Route CRUD APIs (Phase 0 — pre-existing Staff
 * Transport module, hardened after the geofence_radius_m regression).
 *
 *   - GET    /api/bus-ops/routes                  — list (with/without ?active)
 *   - POST   /api/bus-ops/routes                  — create
 *   - GET    /api/bus-ops/routes/:id              — read
 *   - PATCH  /api/bus-ops/routes/:id              — update
 *   - DELETE /api/bus-ops/routes/:id              — soft-delete
 *   - GET    /api/bus-ops/routes/:id/stops        — list stops
 *   - POST   /api/bus-ops/routes/:id/stops        — add a stop
 *   - PUT    /api/bus-ops/routes/:id/stops        — replace all stops
 *   - GET    /api/bus-ops/routes/optimisation-preview
 *
 * Regression note (2026-08-04):
 *   /api/bus-ops/routes was 500-ing because the Prisma schema declared
 *   `RouteStop.geofenceRadiusM @map("geofence_radius_m")` but the actual DB
 *   column had never been created. Every Prisma-generated SELECT included
 *   the column and crashed. The previous integration suite didn't cover
 *   the routes endpoints, so the bug shipped to the UI and broke the
 *   "Active Routes" KPI + the whole /bus-ops/routes page.
 *
 *   This test pins the contract: a list of routes MUST return 200, and
 *   the response must include the `stops` relation with the new
 *   `geofenceRadiusM` field (Prisma auto-renames `geofence_radius_m` →
 *   `geofenceRadiusM` on the TS model).
 *
 * Hits the running Next.js dev server on localhost:3000.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma as basePrisma } from '@/lib/prisma';
import { cleanupTenant, isServerRunning, makeRequest, seedTestTenantFull } from '../setup';

let serverUp = false;
let seed: Awaited<ReturnType<typeof seedTestTenantFull>> | null = null;
let createdRouteId: string | null = null;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('[routes integration] Dev server not reachable on localhost:3000 — skipping');
    return;
  }
  seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');
});

afterAll(async () => {
  if (createdRouteId) {
    await basePrisma.routeStop.deleteMany({ where: { routeId: createdRouteId } }).catch(() => {});
    await basePrisma.busRoute.delete({ where: { id: createdRouteId } }).catch(() => {});
  }
  if (seed) await cleanupTenant(seed.tenant.id);
});

describe('Route CRUD /api/bus-ops/routes', () => {
  it('REGRESSION: GET returns 200 and includes stops with geofenceRadiusM field', async () => {
    // This is the exact failure that broke the /bus-ops/routes page and the
    // dashboard's "Active Routes" KPI on 2026-08-04. The bug was a missing
    // `route_stops.geofence_radius_m` column in the dev DB; Prisma generated
    // a SELECT that included it and the query crashed with 500. If this
    // test ever returns 500, the column is missing again.
    const r = await makeRequest('GET', '/api/bus-ops/routes', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const list = await r.json();
    expect(Array.isArray(list)).toBe(true);

    // If a route exists with stops, each stop should have the geofenceRadiusM
    // field (or undefined when NULL). The Prisma client surfaces the DB
    // column as geofenceRadiusM. If the column is missing in the DB, the
    // list call would 500 before reaching this assertion.
    for (const route of list as Array<{ stops?: Array<{ geofenceRadiusM?: number | null }> }>) {
      for (const stop of route.stops ?? []) {
        // The field should exist on the response shape (even if null).
        // The Prisma client doesn't strip unknown columns, so its presence
        // proves the column is in the DB.
        expect('geofenceRadiusM' in stop).toBe(true);
      }
    }
  });

  it('REGRESSION: GET ?active=true also returns 200', async () => {
    // Same bug, different query path. The ?active=true variant was 500-ing
    // too because it shares the same generated SELECT.
    const r = await makeRequest('GET', '/api/bus-ops/routes?active=true', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const list = await r.json();
    expect(Array.isArray(list)).toBe(true);
  });

  it('POST creates a route and GET /:id returns it', async () => {
    const create = await makeRequest('POST', '/api/bus-ops/routes', {
      name: 'E2E-Routes-Regression',
      origin: 'Regression A',
      destination: 'Regression B',
      routeType: 'STAFF',
      capacity: 30,
    }, seed!.headers);
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.id).toBeDefined();
    createdRouteId = created.id;

    const one = await makeRequest('GET', `/api/bus-ops/routes/${created.id}`, undefined, seed!.headers);
    expect(one.status).toBe(200);
    const oneBody = await one.json();
    expect(oneBody.name).toBe('E2E-Routes-Regression');
    expect(oneBody.stops).toEqual([]);
  });

  it('POST /:id/stops creates a stop and it appears in GET /:id/stops', async () => {
    if (!createdRouteId) throw new Error('route not created');

    const add = await makeRequest('POST', `/api/bus-ops/routes/${createdRouteId}/stops`, {
      stopName: 'E2E-Stop-Alpha',
      gpsLat: 25.2,
      gpsLng: 55.3,
      estimatedArrivalMins: 5,
      landmark: 'E2E landmark',
    }, seed!.headers);
    expect(add.status).toBe(201);
    const added = await add.json();
    expect(added.stopName).toBe('E2E-Stop-Alpha');
    // The new field must round-trip. This is the strongest pin against
    // the missing-column regression: if route_stops.geofence_radius_m is
    // absent, this insert succeeds but the next GET throws on the include.
    expect('geofenceRadiusM' in added).toBe(true);

    const list = await makeRequest('GET', `/api/bus-ops/routes/${createdRouteId}/stops`, undefined, seed!.headers);
    expect(list.status).toBe(200);
    const stops = await list.json();
    expect(stops).toHaveLength(1);
    expect(stops[0].stopName).toBe('E2E-Stop-Alpha');
    expect('geofenceRadiusM' in stops[0]).toBe(true);
  });

  it('GET /:id includes the created stop with geofenceRadiusM field', async () => {
    if (!createdRouteId) throw new Error('route not created');

    // The full route include — this is the exact query the /bus-ops/routes
    // page does. If geofence_radius_m is missing from the DB, this 500s.
    const r = await makeRequest('GET', `/api/bus-ops/routes/${createdRouteId}`, undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.stops).toHaveLength(1);
    const stop = body.stops[0];
    expect(stop.stopName).toBe('E2E-Stop-Alpha');
    // This assertion is the regression pin. If `geofence_radius_m` is
    // missing from the DB, Prisma's generated client crashes BEFORE
    // returning the row, so we never get here.
    expect('geofenceRadiusM' in stop).toBe(true);
  });

  it('PUT /:id/stops replaces all stops (idempotent on a single stop)', async () => {
    if (!createdRouteId) throw new Error('route not created');

    const put = await makeRequest('PUT', `/api/bus-ops/routes/${createdRouteId}/stops`, {
      stops: [
        { stopName: 'E2E-Stop-Replaced', sequence: 1, gpsLat: 25.4, gpsLng: 55.5 },
      ],
    }, seed!.headers);
    expect(put.status).toBe(200);
    const newStops = await put.json();
    expect(newStops).toHaveLength(1);
    expect(newStops[0].stopName).toBe('E2E-Stop-Replaced');
  });

  it('PATCH /:id updates the route', async () => {
    if (!createdRouteId) throw new Error('route not created');

    const patch = await makeRequest('PATCH', `/api/bus-ops/routes/${createdRouteId}`, { capacity: 50 }, seed!.headers);
    expect(patch.status).toBe(200);
    const updated = await patch.json();
    expect(updated.capacity).toBe(50);
  });

  it('GET /api/bus-ops/routes/optimisation-preview returns 200', async () => {
    // This endpoint also queries busRoute.stops. The 2026-08-04 bug would
    // have caused a 500 here too.
    const r = await makeRequest('GET', '/api/bus-ops/routes/optimisation-preview', undefined, seed!.headers);
    expect(r.status).toBe(200);
    const body = await r.json();
    // The preview is either an array of rows or a wrapped object — both are
    // valid shapes depending on which version of the handler compiled.
    expect(body !== null).toBe(true);
  });

  it('DELETE /:id soft-deletes the route', async () => {
    if (!createdRouteId) throw new Error('route not created');

    const del = await makeRequest('DELETE', `/api/bus-ops/routes/${createdRouteId}`, undefined, seed!.headers);
    expect(del.status).toBe(200);

    // After delete, the route should be filtered out by the list endpoint's
    // `deletedAt: null` predicate. The bug regression doesn't affect this,
    // but it pins the soft-delete contract.
    const list = await makeRequest('GET', '/api/bus-ops/routes', undefined, seed!.headers);
    const items = await list.json();
    expect(items.some((r: { id: string }) => r.id === createdRouteId)).toBe(false);
    // Detach so afterAll doesn't double-clean.
    createdRouteId = null;
  });

  it('returns 401 without auth', async () => {
    const r = await makeRequest('GET', '/api/bus-ops/routes');
    expect(r.status).toBe(401);
  });
});
