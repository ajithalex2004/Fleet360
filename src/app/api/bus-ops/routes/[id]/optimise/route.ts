/**
 * GET  /api/bus-ops/routes/[id]/optimise — preview optimisation, no write
 * POST /api/bus-ops/routes/[id]/optimise — apply (re-sequence the stops)
 *
 * Reuses the existing zero-dep Nearest-Neighbour + 2-opt solver in
 * src/lib/agents/route-optimiser/tsp.ts. The school-bus agent applies the
 * same logic in batch; here we run it on-demand per staff bus route.
 *
 * Apply mode: re-numbers RouteStop.sequence in a transaction so the order
 * change is atomic. Returns before/after distances and savings.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { optimiseRoute, type GeoStop } from '@/lib/agents/route-optimiser/tsp';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

async function loadGeoStops(routeId: string) {
  const stops = await prisma.routeStop.findMany({
    where: { routeId },
    orderBy: { sequence: 'asc' },
    select: { id: true, stopName: true, sequence: true, gpsLat: true, gpsLng: true },
  });
  const geoStops: GeoStop[] = [];
  const skipped: string[] = [];
  for (const s of stops) {
    if (s.gpsLat == null || s.gpsLng == null) {
      skipped.push(s.stopName);
      continue;
    }
    geoStops.push({
      id: s.id,
      name: s.stopName,
      lat: s.gpsLat,
      lng: s.gpsLng,
      sequence: s.sequence,
    });
  }
  return { stops, geoStops, skipped };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const route = await prisma.busRoute.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!route) return NextResponse.json({ error: 'Route not found' }, { status: 404 });

  const { stops, geoStops, skipped } = await loadGeoStops(params.id);
  if (geoStops.length < 3) {
    return NextResponse.json({
      ok: false,
      reason: 'Need at least 3 geocoded stops to optimise',
      stopsTotal: stops.length, stopsGeocoded: geoStops.length, skipped,
    });
  }

  const result = optimiseRoute(geoStops);
  return NextResponse.json({
    ok: true,
    route: { id: route.id, name: route.name },
    stopsTotal: stops.length,
    stopsGeocoded: geoStops.length,
    skippedNoCoords: skipped,
    originalDistanceKm: round2(result.originalDistanceKm),
    optimisedDistanceKm: round2(result.optimisedDistanceKm),
    distanceSavedKm: round2(result.distanceSavedKm),
    distanceSavedPct: round2(result.distanceSavedPct),
    iterations2opt: result.iterations2opt,
    durationMs: result.durationMs,
    optimisedSequence: result.optimisedSequence.map((s, i) => ({
      stopId: s.id, stopName: s.name, newSequence: i + 1, originalSequence: s.sequence,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const route = await prisma.busRoute.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
    if (!route) return NextResponse.json({ error: 'Route not found' }, { status: 404 });

    const { stops, geoStops } = await loadGeoStops(params.id);
    if (geoStops.length < 3) {
      return NextResponse.json({ error: 'Need at least 3 geocoded stops to optimise' }, { status: 400 });
    }

    const result = optimiseRoute(geoStops);

    // Re-number RouteStop.sequence per optimised order. Stops without coords
    // are appended at the end in their original relative order.
    const optimisedIds = new Set(result.optimisedSequence.map(s => s.id));
    const tail = stops.filter(s => !optimisedIds.has(s.id));

    await prisma.$transaction([
      ...result.optimisedSequence.map((s, i) =>
        prisma.routeStop.update({ where: { id: s.id }, data: { sequence: i + 1 } }),
      ),
      ...tail.map((s, i) =>
        prisma.routeStop.update({ where: { id: s.id }, data: { sequence: result.optimisedSequence.length + i + 1 } }),
      ),
      // Persist the new total distance on the route.
      prisma.busRoute.update({
        where: { id: params.id },
        data: { totalDistanceKm: round2(result.optimisedDistanceKm) },
      }),
    ]);

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'BusRoute',
      entityId: params.id,
      action: 'UPDATE',
      details: `Route "${route.name}" re-optimised (TSP): ${round2(result.originalDistanceKm)} → ${round2(result.optimisedDistanceKm)} km (saved ${round2(result.distanceSavedKm)} km / ${round2(result.distanceSavedPct)}%).`,
    });

    return NextResponse.json({
      ok: true,
      applied: true,
      route: { id: route.id, name: route.name },
      originalDistanceKm: round2(result.originalDistanceKm),
      optimisedDistanceKm: round2(result.optimisedDistanceKm),
      distanceSavedKm: round2(result.distanceSavedKm),
      distanceSavedPct: round2(result.distanceSavedPct),
    });
  } catch (err) {
    captureException(err, { context: 'bus-ops.routes.optimise', tags: { routeId: params.id } });
    return NextResponse.json({ error: 'Optimisation failed' }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
