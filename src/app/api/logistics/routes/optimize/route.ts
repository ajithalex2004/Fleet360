export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  computeMultiStopRoute,
  WaypointNode,
} from '@/lib/multi-stop-routing';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
