/**
 * POST /api/route-optimizer/optimize
 * Body: { waypoints: Waypoint[], vehicleType?: 'van'|'truck'|'bus' }
 * Returns optimized route order + polyline + distance/duration/fuel stats.
 * MAPBOX_TOKEN stays server-side — never exposed to the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { optimizeRoute, estimateFuelCost, DEFAULT_FUEL_PRICE_AED, type Waypoint } from '@/lib/mapbox';
import { prisma } from '@/lib/prisma';
import { getLatestFuelPrice } from '@/lib/fleet/fuel-price';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

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

    const latestFuel = await getLatestFuelPrice(prisma, tenantId).catch(() => null);
    const fuel = estimateFuelCost(result.totalDistanceKm, vehicleType, latestFuel?.price ?? DEFAULT_FUEL_PRICE_AED);
    const fuelPriceSource = latestFuel ? 'fleet-log' as const : 'default' as const;

    return NextResponse.json({
      ...result,
      fuel: { ...fuel, source: fuelPriceSource, asOf: latestFuel?.asOf ?? null },
      summary: {
        stops:        waypoints.length,
        distanceKm:   result.totalDistanceKm,
        durationMin:  result.totalDurationMin,
        durationHuman: formatDuration(result.totalDurationMin),
        fuelLitres:   fuel.litres,
        fuelCostAED:  fuel.costAED,
        fuelPricePerLitre: fuel.pricePerLitreAED,
        fuelPriceSource,
      },
    });
    } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // If Google Cloud credentials aren't configured, return a mock result
    // so the UI still renders (helps first-time setup + local dev without
    // a GCP account). The old Mapbox fallback checked MAPBOX_TOKEN; the
    // Google client raises with GOOGLE_CLOUD_SA_KEY when the SA key
    // isn't set.
    if (message.includes('GOOGLE_CLOUD_SA_KEY') || message.includes('GOOGLE_CLOUD_PROJECT_ID')) {
      return NextResponse.json({
        orderedWaypoints: [],
        totalDistanceKm: 0,
        totalDurationMin: 0,
        geometry: { type: 'LineString', coordinates: [] },
        legs: [],
        fuel: { litres: 0, costAED: 0 },
        summary: { stops: 0, distanceKm: 0, durationMin: 0, durationHuman: '—', fuelLitres: 0, fuelCostAED: 0 },
        _warning: 'Google Cloud not configured — set GOOGLE_CLOUD_SA_KEY + GOOGLE_CLOUD_PROJECT_ID in .env.local to enable route optimization.',
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
