/**
 * POST /api/route-optimizer/optimize
 * Body: { waypoints: Waypoint[], vehicleType?: 'van'|'truck'|'bus' }
 * Returns optimized route order + polyline + distance/duration/fuel stats.
 * MAPBOX_TOKEN stays server-side — never exposed to the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { optimizeRoute, estimateFuelCost, type Waypoint } from '@/lib/mapbox';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      waypoints: Waypoint[];
      vehicleType?: 'van' | 'truck' | 'bus';
    };

    const { waypoints, vehicleType = 'van' } = body;

    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 waypoints required (origin + destination).' },
        { status: 400 },
      );
    }

    // Validate all waypoints have valid coordinates
    for (const wp of waypoints) {
      if (typeof wp.lng !== 'number' || typeof wp.lat !== 'number') {
        return NextResponse.json(
          { error: `Waypoint "${wp.label}" has invalid coordinates.` },
          { status: 400 },
        );
      }
    }

    const result = await optimizeRoute(waypoints);
    const fuel   = estimateFuelCost(result.totalDistanceKm, vehicleType);

    return NextResponse.json({
      ...result,
      fuel,
      summary: {
        stops:        waypoints.length,
        distanceKm:   result.totalDistanceKm,
        durationMin:  result.totalDurationMin,
        durationHuman: formatDuration(result.totalDurationMin),
        fuelLitres:   fuel.litres,
        fuelCostAED:  fuel.costAED,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // If Mapbox isn't configured yet, return a mock result for UI dev
    if (message.includes('MAPBOX_TOKEN is not configured')) {
      return NextResponse.json({
        orderedWaypoints: [],
        totalDistanceKm: 0,
        totalDurationMin: 0,
        geometry: { type: 'LineString', coordinates: [] },
        legs: [],
        fuel: { litres: 0, costAED: 0 },
        summary: { stops: 0, distanceKm: 0, durationMin: 0, durationHuman: '—', fuelLitres: 0, fuelCostAED: 0 },
        _warning: 'MAPBOX_TOKEN not set — add it to .env.local to enable route optimization.',
      });
    }

    console.error('[route-optimizer/optimize]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
