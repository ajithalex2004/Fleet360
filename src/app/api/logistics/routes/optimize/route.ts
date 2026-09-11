export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  computeMultiStopRoute,
  WaypointNode,
} from '@/lib/multi-stop-routing';

export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const { origin, intermediateWaypoints = [], destination, baseFareAed = 550 } = body;

    if (!origin || !destination) {
      return NextResponse.json({ error: 'Origin and Destination waypoints are required' }, { status: 400 });
    }

    const result = computeMultiStopRoute(origin, intermediateWaypoints, destination, Number(baseFareAed));

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err) {
    console.error('[api/logistics/routes/optimize POST]', err);
    return NextResponse.json({ error: 'Route optimization failed' }, { status: 500 });
  }
}
