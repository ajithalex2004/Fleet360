export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { TelematicsService } from '@/lib/exchange/telematics-service';

export const runtime = 'nodejs';

/**
 * POST /api/public/partner-driver/[token]/telemetry-batch
 * Ingests a buffered batch of GPS breadcrumbs accumulated while driver was offline
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const rawToken = params.token;
    const body = await req.json().catch(() => ({}));
    const points = Array.isArray(body.points) ? body.points : [];

    if (points.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: 'No points provided' });
    }

    let lastResult = null;
    let successCount = 0;

    // Process points in chronological order
    for (const pt of points) {
      if (pt.latitude != null && pt.longitude != null) {
        try {
          const res = await TelematicsService.ingestDriverGpsPing(rawToken, {
            latitude: Number(pt.latitude),
            longitude: Number(pt.longitude),
            speed: pt.speed != null ? Number(pt.speed) : undefined,
            heading: pt.heading != null ? Number(pt.heading) : undefined,
            accuracy: pt.accuracy != null ? Number(pt.accuracy) : undefined,
          });
          lastResult = res;
          successCount++;
        } catch {
          // Continue processing remaining batch items
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: successCount,
      total: points.length,
      latestGeofenceState: lastResult?.geofenceTriggered || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Telemetry batch sync failed' },
      { status: 500 }
    );
  }
}
