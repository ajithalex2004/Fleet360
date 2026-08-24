/**
 * GET /api/logistics/carriers/nearest
 *
 * The nearest idle owner-operator (gig driver) carriers to a pickup point — the
 * candidate pool that seeds a load broadcast (the "top 3 nearest" in the
 * dispatch screen). Thin wrapper over domain.findNearestIdleCarriers.
 *
 *   ?lat= ?lng=           pickup coordinates (required)
 *   ?radiusKm=            search radius (default 25)
 *   ?vehicleType=         optional exact vehicle-type match
 *   ?limit=               default 3
 *   ?maxStaleSeconds=     ignore presence older than this (default 300)
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findNearestIdleCarriers } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get('lat'));
  const lng = Number(sp.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  const numParam = (name: string) => {
    const v = sp.get(name);
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    const data = await findNearestIdleCarriers({
      tenantId,
      lat,
      lng,
      radiusKm: numParam('radiusKm'),
      vehicleType: sp.get('vehicleType'),
      maxStaleSeconds: numParam('maxStaleSeconds'),
      limit: numParam('limit'),
    });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[carriers/nearest GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to find nearby drivers' },
      { status: 500 },
    );
  }
}
