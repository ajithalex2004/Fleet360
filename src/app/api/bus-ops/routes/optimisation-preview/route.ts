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
import { optimiseRoute, type GeoStop } from '@/lib/agents/route-optimiser/tsp';

export const runtime = 'nodejs';

export async function GET() {
  const routes = await prisma.busRoute.findMany({
    where: { deletedAt: null, isActive: true, routeType: { in: ['STAFF', 'BOTH'] } },
    select: {
      id: true, name: true, totalDistanceKm: true,
      stops: { select: { id: true, stopName: true, sequence: true, gpsLat: true, gpsLng: true } },
    },
  });

  interface PreviewRow {
    routeId: string; routeName: string;
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
        routeId: r.id, routeName: r.name, stopCount: sorted.length, geoStopCount: geo.length,
        originalDistanceKm: 0, optimisedDistanceKm: 0, distanceSavedKm: 0, distanceSavedPct: 0,
        skipped: true, skipReason: `Only ${geo.length} stops geocoded`,
      });
      continue;
    }

    const result = optimiseRoute(geo);
    rows.push({
      routeId: r.id, routeName: r.name, stopCount: sorted.length, geoStopCount: geo.length,
      originalDistanceKm: round2(result.originalDistanceKm),
      optimisedDistanceKm: round2(result.optimisedDistanceKm),
      distanceSavedKm: round2(result.distanceSavedKm),
      distanceSavedPct: round2(result.distanceSavedPct),
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
