/**
 * GET /api/logistics/master-data
 *
 * Lists the tenant's logistics master data (governed pick-lists) for the form
 * dropdowns — PICKUP_LOCATION, COUNTRY, AIRPORT, VEHICLE_TYPE, SERVICE_TYPE, etc.
 * Defaults to ACTIVE entries; optional ?type= filters to one type. Seeds the
 * tenant's defaults on first call (handled inside listLogisticsMasterData).
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listLogisticsMasterData } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type');
  const search = sp.get('search');

  try {
    const data = await listLogisticsMasterData({ tenantId, type, status: 'ACTIVE', search });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    console.error('[logistics/master-data GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list master data' },
      { status: 500 },
    );
  }
}
