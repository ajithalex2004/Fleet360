/**
 * GET /api/bus-ops/routes/optimisation-preview
 *
 * Dry-run digest: scans every active staff bus route, runs the TSP solver
 * on its geocoded stops, returns top potential savings ranked by km saved.
 * Powers the "Routes worth re-optimising" widget.
 *
 * No writes. Safe to call from a dashboard widget on any cadence.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { optimiseRoute, totalDistance, type GeoStop } from '@/lib/agents/route-optimiser/tsp';

export const runtime = 'nodejs';

export async function GET() {
  const routes = await prisma.busRoute.findMany({
    where: { deletedAt: null, isActive: true, routeType: { in: ['STAFF', 'BOTH'] } },
    select: {
      id: true, name: true, code: true, totalDistanceKm: true,
      stops: { select: { id: true, stopName: true, sequence: true, gpsLat: true, gpsLng: true } },
    },
  });

  interface PreviewRow {
    routeId: string; routeName: string; routeCode: string | null;
    stopCount: number; geoStopCount: number;
    originalDistanceKm: number; optimisedDistanceKm: number;
    distanceSavedKm: number; distanceSavedPct: number;
    skipped: boolean; skipReason?: string;
  }

  const rows: PreviewRow[] = [];
  for (const r of routes) {
    const sorted = [...r.stops].sort((a, b) => a.sequence - b.sequence);
    const geo: GeoStop[] = sorted
      .filter(s => s.gpsLat != null && s.gpsLng != null)
      .map(s => ({ id: s.id, name: s.stopName, lat: s.gpsLat!, lng: s.gpsLng!, sequence: s.sequence }));

    if (geo.length < 3) {
      rows.push({
        routeId: r.id, routeName: r.name, routeCode: r.code ?? null,
        stopCount: sorted.length, geoStopCount: geo.length,
        originalDistanceKm: 0, optimisedDistanceKm: 0, distanceSavedKm: 0, distanceSavedPct: 0,
        skipped: true, skipReason: `Only ${geo.length} stops geocoded`,
      });
      continue;
    }

    // Constrain the solver to match what the planner's Mapbox save actually
    // applies: origin (first stop) and destination (last stop) are FIXED;
    // only the intermediate stops get reordered. The old call passed the
    // whole sequence to optimiseRoute, which is free to move the destination
    // into the middle — the resulting "savings" number was theoretical and
    // could never be applied via Save, so rows stayed permanently non-zero
    // even after the operator optimised the route.
    const start = geo[0];
    const end   = geo[geo.length - 1];
    const middle = geo.slice(1, -1);
    const originalDist = totalDistance(geo);

    let optimisedDist: number;
    if (middle.length <= 1) {
      // With 0 or 1 middle stops there's nothing to permute — bookended
      // distance equals the original by definition. No savings possible.
      optimisedDist = originalDist;
    } else {
      const inner = optimiseRoute(middle);
      const bookended = [start, ...inner.optimisedSequence, end];
      optimisedDist = totalDistance(bookended);
    }

    const saved    = Math.max(originalDist - optimisedDist, 0);
    const savedPct = originalDist > 0 ? (saved / originalDist) * 100 : 0;

    rows.push({
      routeId: r.id, routeName: r.name, routeCode: r.code ?? null,
      stopCount: sorted.length, geoStopCount: geo.length,
      originalDistanceKm:  round2(originalDist),
      optimisedDistanceKm: round2(optimisedDist),
      distanceSavedKm:     round2(saved),
      distanceSavedPct:    round2(savedPct),
      skipped: false,
    });
  }

  rows.sort((a, b) => b.distanceSavedKm - a.distanceSavedKm);
  const totalSavingsKm = round2(rows.reduce((s, r) => s + r.distanceSavedKm, 0));
  const meaningful = rows.filter(r => !r.skipped && r.distanceSavedPct >= 5);

  return NextResponse.json({
    runAt: new Date().toISOString(),
    routesScanned: routes.length,
    totalPotentialSavingsKm: totalSavingsKm,
    routesWithMeaningfulSavings: meaningful.length,
    rows,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
