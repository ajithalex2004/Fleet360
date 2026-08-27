/**
 * POST /api/bus-ops/fleet-optimizer/spike
 *
 * DEV-ONLY smoke test for the Fleet Routing Commit A validation milestone.
 * Runs the full pipe on hardcoded fake stops against Google's live API and
 * reports pass/fail for the five Commit A criteria:
 *
 *   1. AUTH_OK           — SA key parsed, OAuth token acquired
 *   2. ROUND_TRIP_OK     — round-trip on 3 stops + 1 vehicle returns a solve
 *   3. MATRIX_CACHE_OK   — second solve reads the matrix from cache
 *   4. STRUCTURED_OK     — Google response parses into RunRoute/Stop/Unassigned
 *   5. INFEASIBLE_OK     — deliberately over-constrained input → INFEASIBLE
 *                          (not FAILED)
 *
 * The endpoint is gated by NODE_ENV !== 'production' — 403 in prod. It
 * writes NOTHING to the DB (no FleetOptimizationRun row). Its only
 * side-effect is populating (and then reading from) the matrix cache
 * so criterion 3 can be verified.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { checkGoogleAuth, optimizeTours, GoogleApiError } from '@/lib/planning/fleet-routing/google-client';
import { getRouteMatrix } from '@/lib/planning/fleet-routing/matrix-cache';
import { buildOptimizeToursRequest } from '@/lib/planning/fleet-routing/input-builder';
import { parseSuccess, normaliseSkipReason } from '@/lib/planning/fleet-routing/response-parser';
import { resolveTimeWindow } from '@/lib/planning/fleet-routing/window-resolver';
import type { ShipmentInput, VehicleInput } from '@/lib/planning/fleet-routing/types';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

// ── Fake fixtures (Dubai — Al Khail Gate area) ─────────────────────────────

const OFFICE = { lat: 25.0657, lng: 55.1713, label: 'Zayed University UAE' };

const FAKE_STOPS = [
  { passengerId: 'demo-p1', lat: 25.1189, lng: 55.2064, label: 'Al Khail Gate — Pickup A' },
  { passengerId: 'demo-p2', lat: 25.1122, lng: 55.2145, label: 'Al Khail Gate — Pickup B' },
  { passengerId: 'demo-p3', lat: 25.1235, lng: 55.1988, label: 'Al Khail Gate — Pickup C' },
];

const FAKE_DEPOT = { lat: 25.1250, lng: 55.2010, label: 'Depot' };

// ── Endpoint ────────────────────────────────────────────────────────────────

interface CriterionResult { ok: boolean; detail: string }

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'spike endpoint is dev-only' }, { status: 403 });
  }

  const results: Record<string, CriterionResult> = {
    AUTH_OK:         { ok: false, detail: 'not run' },
    ROUND_TRIP_OK:   { ok: false, detail: 'not run' },
    MATRIX_CACHE_OK: { ok: false, detail: 'not run' },
    STRUCTURED_OK:   { ok: false, detail: 'not run' },
    INFEASIBLE_OK:   { ok: false, detail: 'not run' },
  };

  // ── 1. AUTH_OK ────────────────────────────────────────────────────────────
  const auth = await checkGoogleAuth();
  if (!auth.ok) {
    results.AUTH_OK = { ok: false, detail: auth.error };
    return NextResponse.json({ pass: false, results }, { status: 200 });
  }
  results.AUTH_OK = { ok: true, detail: `client=${auth.clientEmail}, project=${auth.projectId}` };

  // Anchor windows to a target date 1 day from now so departureTime is in
  // the future (traffic-aware routing needs that).
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);
  targetDate.setHours(0, 0, 0, 0);

  // ── 3. MATRIX_CACHE_OK (call before ROUND_TRIP so we exercise cache) ─────
  const departureAt = new Date(targetDate);
  departureAt.setHours(7, 0, 0, 0);
  try {
    const first = await getRouteMatrix({
      tenantId: '__spike__',
      origins:      FAKE_STOPS.map(s => ({ id: s.passengerId, lat: s.lat, lng: s.lng })),
      destinations: [{ id: 'office', lat: OFFICE.lat, lng: OFFICE.lng }],
      routingMode:  'DRIVE',
      departureTime: departureAt,
    });
    const second = await getRouteMatrix({
      tenantId: '__spike__',
      origins:      FAKE_STOPS.map(s => ({ id: s.passengerId, lat: s.lat, lng: s.lng })),
      destinations: [{ id: 'office', lat: OFFICE.lat, lng: OFFICE.lng }],
      routingMode:  'DRIVE',
      departureTime: departureAt,
    });
    if (second.fromCache) {
      results.MATRIX_CACHE_OK = { ok: true, detail: `first=miss(${first.matrix.length} elems), second=hit` };
    } else {
      results.MATRIX_CACHE_OK = { ok: false, detail: `second lookup missed cache (first: ${first.fromCache ? 'hit' : 'miss'})` };
    }
  } catch (e) {
    results.MATRIX_CACHE_OK = { ok: false, detail: (e as Error).message };
  }

  // ── 2 + 4. ROUND_TRIP_OK + STRUCTURED_OK ─────────────────────────────────
  const shipments: ShipmentInput[] = FAKE_STOPS.map(s => ({
    passengerId: s.passengerId,
    pickup:   { lat: s.lat, lng: s.lng, label: s.label },
    delivery: { lat: OFFICE.lat, lng: OFFICE.lng, label: OFFICE.label },
    demand: 1,
    window: resolveTimeWindow(
      { pickupTime: '07:00' },
      { departureTime: '07:00', expectedArrivalTime: '08:00' },
      {},
      targetDate,
    ),
  }));
  const vehicles: VehicleInput[] = [{
    vehicleId: 'demo-v1',
    driverId:  null,
    start:  { lat: FAKE_DEPOT.lat, lng: FAKE_DEPOT.lng, label: FAKE_DEPOT.label },
    end:    { lat: FAKE_DEPOT.lat, lng: FAKE_DEPOT.lng, label: FAKE_DEPOT.label },
    capacity: 20,
    earliestStart: iso(targetDate, 6, 30),
    latestEnd:     iso(targetDate, 9, 30),
  }];

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;
  const optimizeReq = buildOptimizeToursRequest({
    projectId,
    shipments,
    vehicles,
    globalStart: iso(targetDate, 6, 0),
    globalEnd:   iso(targetDate, 10, 0),
    timeout: '30s',
  });
  const solveStart = Date.now();
  try {
    const raw = await optimizeTours(optimizeReq);
    const solveSec = (Date.now() - solveStart) / 1000;

    // Criterion 2: got a route
    const routeCount = raw.routes?.length ?? 0;
    results.ROUND_TRIP_OK = routeCount > 0
      ? { ok: true, detail: `${routeCount} route(s), ${raw.routes?.[0]?.visits?.length ?? 0} visits, solve=${solveSec.toFixed(1)}s` }
      : { ok: false, detail: 'Google returned 0 routes (unexpected for this feasible input)' };

    // Criterion 4: parses into structured tables
    try {
      const parsed = parseSuccess(raw, shipments, new Map([['demo-v1', null]]), solveSec);
      const stopCount = parsed.routes.reduce((n, r) => n + r.stops.length, 0);
      results.STRUCTURED_OK = { ok: true, detail: `parsed ${parsed.routes.length} route(s), ${stopCount} stop(s), ${parsed.unassigned.length} unassigned, ${parsed.metrics.totalDistanceKm} km` };
    } catch (e) {
      results.STRUCTURED_OK = { ok: false, detail: `parser threw: ${(e as Error).message}` };
    }
  } catch (e) {
    const err = e as Error;
    results.ROUND_TRIP_OK = { ok: false, detail: err instanceof GoogleApiError
      ? `HTTP ${err.status}: ${err.responseBody.slice(0, 400)}`
      : err.message };
  }

  // ── 5. INFEASIBLE_OK ─────────────────────────────────────────────────────
  // Same demand but a vehicle with capacity=1 and only 1 pickup allowed
  // via the timeout — impossible to serve all 3 shipments.
  const infeasibleVehicle: VehicleInput = {
    ...vehicles[0],
    capacity: 1,   // can only carry ONE passenger; three shipments each demand 1 seat
    latestEnd: iso(targetDate, 7, 15), // and a very tight shift window
  };
  const infReq = buildOptimizeToursRequest({
    projectId,
    shipments,
    vehicles: [infeasibleVehicle],
    globalStart: iso(targetDate, 6, 0),
    globalEnd:   iso(targetDate, 10, 0),
    timeout: '10s',
  });
  try {
    const raw = await optimizeTours(infReq);
    const skippedCount = raw.skippedShipments?.length ?? 0;
    if (skippedCount >= 2) {
      const normalised = raw.skippedShipments!.map(s => normaliseSkipReason(s.reasons).reason);
      results.INFEASIBLE_OK = { ok: true, detail: `${skippedCount} shipments skipped: ${normalised.join(', ')}` };
    } else {
      results.INFEASIBLE_OK = { ok: false, detail: `expected ≥2 skips, got ${skippedCount} (solver found unexpected fit)` };
    }
  } catch (e) {
    const err = e as Error;
    // Google returning a non-2xx would be FAILED (bad), not INFEASIBLE (what we want).
    results.INFEASIBLE_OK = { ok: false, detail: err instanceof GoogleApiError
      ? `HTTP ${err.status} — this should have been an INFEASIBLE (200 + skipped) response instead: ${err.responseBody.slice(0, 300)}`
      : err.message };
  }

  const pass = Object.values(results).every(r => r.ok);
  return NextResponse.json({ pass, results }, { status: 200 });
}

// ── Local helpers ──────────────────────────────────────────────────────────

function iso(date: Date, hours: number, minutes: number): string {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}
