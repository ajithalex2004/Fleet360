/**
 * GET /api/bus-ops/route-stops
 *
 * Flat list of every route stop with GPS coords for the current tenant.
 * Used by the New Route form's "pick from existing stops" selector, so the
 * operator can seed Origin/Destination from a location that's already been
 * geocoded and used by another route — no need to re-type or re-map.
 *
 * De-duplicated by (stopName, gpsLat, gpsLng) — if the same physical stop
 * appears on N routes, it shows up once. Each entry carries the route name
 * for context so the picker can show "Al Ghazal HQ (Route: Marina Loop)".
 *
 * Auth: tenant operator session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    // Typed Prisma query — cleaner than raw SQL and surfaces a helpful error
    // if the schema drifts from the actual DB (e.g. a column that exists in
    // schema.prisma but hasn't been migrated). Nested route filter enforces
    // tenant scope on the join side.
    const rows = await prisma.routeStop.findMany({
      where: {
        gpsLat: { not: null },
        gpsLng: { not: null },
        route: {
          deletedAt: null,
          OR: [{ tenantId }, { tenantId: null }],
        },
      },
      select: {
        stopName: true,
        gpsLat: true,
        gpsLng: true,
        landmark: true,
        route: { select: { name: true } },
      },
      orderBy: { stopName: 'asc' },
    });

    // Dedupe by (name, coords) so a stop reused across routes shows once.
    // Prisma's typed select above guarantees gps_lat / gps_lng are non-null
    // in the rows (the where filter ensures it), so the ! assertions here are
    // safe.
    const seen = new Map<string, { name: string; lat: number; lng: number; landmark: string | null; routeName: string }>();
    for (const r of rows) {
      const lat = r.gpsLat as number;
      const lng = r.gpsLng as number;
      const key = `${r.stopName.trim().toLowerCase()}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.set(key, {
          name: r.stopName,
          lat, lng,
          landmark: r.landmark ?? null,
          routeName: r.route?.name ?? '(unknown route)',
        });
      }
    }

    return NextResponse.json({
      stops: Array.from(seen.values()),
    }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=180' } });
  } catch (e) {
    console.error('[bus-ops/route-stops GET]', e);
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Failed to list stops',
      // Surface the Prisma error code when present so the client console has
      // something actionable to grep on ("P2021 table not found", etc.).
      code: (e as { code?: string } | null)?.code,
    }, { status: 500 });
  }
}
