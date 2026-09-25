export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { TelematicsService } from '@/lib/exchange/telematics-service';
import { withPartnerTokenTenant } from '@/lib/exchange/partner-token-tenant';

export const runtime = 'nodejs';

/**
 * POST /api/public/partner-driver/[token]/telemetry-batch
 * Ingests a buffered batch of GPS breadcrumbs accumulated while driver was offline
 */
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await params;
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

// Runs each handler in the tenant of the link's award (src/lib/exchange/partner-token-tenant.ts):
// the award and request tables are tenant-isolated by RLS and this route has no session.
export async function POST(
  req: Parameters<typeof handlePOST>[0],
  ctx: { params: Promise<{ token: string }> },
) {
  return withPartnerTokenTenant((await ctx.params).token, () => handlePOST(req, ctx));
}
