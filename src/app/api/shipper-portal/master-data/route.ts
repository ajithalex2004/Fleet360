/**
 * GET /api/shipper-portal/master-data
 *
 * The portal-facing version of the logistics master-data pick-lists (pickup
 * locations, countries, vehicle types, service types) used to populate the
 * shipper's new-request form dropdowns. Tenant is taken from the portal session,
 * never from the request — so a shipper only ever sees their tenant's governed
 * lists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';
import { listLogisticsMasterData } from '@/lib/logistics/domain';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireShipperPortal(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const data = await listLogisticsMasterData({ tenantId: auth.tenantId, status: 'ACTIVE' });
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (e) {
    console.error('[shipper-portal/master-data GET]', e);
    return NextResponse.json({ data: [] }, { status: 200 });
  }
}
