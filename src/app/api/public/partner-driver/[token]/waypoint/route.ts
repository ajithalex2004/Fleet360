export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { WaypointService } from '@/lib/exchange/waypoint-service';

export const runtime = 'nodejs';

/**
 * GET /api/public/partner-driver/[token]/waypoint
 * Retrieve waypoints and progression for a driver's outsourced trip
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const rawToken = params.token;
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
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const rawToken = params.token;
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
