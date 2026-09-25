export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { WaypointService } from '@/lib/exchange/waypoint-service';
import { withPartnerTokenTenant } from '@/lib/exchange/partner-token-tenant';

export const runtime = 'nodejs';

/**
 * GET /api/public/partner-driver/[token]/waypoint
 * Retrieve waypoints and progression for a driver's outsourced trip
 */
async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await params;
    const progress = await WaypointService.getWaypoints(rawToken);
    return NextResponse.json(progress);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch waypoints' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/public/partner-driver/[token]/waypoint
 * Record milestone at a specific waypoint sequence
 */
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await params;
    const body = await req.json().catch(() => ({}));
    const { sequence, action, headcount, notes } = body;

    if (sequence == null) {
      return NextResponse.json({ error: 'Waypoint sequence number is required' }, { status: 400 });
    }

    const result = await WaypointService.recordWaypointMilestone(
      rawToken,
      Number(sequence),
      action || 'CHECKIN',
      { headcount: headcount != null ? Number(headcount) : undefined, notes }
    );

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to record waypoint milestone' },
      { status: 500 }
    );
  }
}

// Runs each handler in the tenant of the link's award (src/lib/exchange/partner-token-tenant.ts):
// the award and request tables are tenant-isolated by RLS and this route has no session.
export async function GET(
  req: Parameters<typeof handleGET>[0],
  ctx: { params: Promise<{ token: string }> },
) {
  return withPartnerTokenTenant((await ctx.params).token, () => handleGET(req, ctx));
}
export async function POST(
  req: Parameters<typeof handlePOST>[0],
  ctx: { params: Promise<{ token: string }> },
) {
  return withPartnerTokenTenant((await ctx.params).token, () => handlePOST(req, ctx));
}
