export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getPublicTicketTrackingData } from '@/lib/service-tickets/csat-analytics-engine';

export const runtime = 'nodejs';

/**
 * GET /api/public/service-tickets/track/[token]
 * Public endpoint to fetch live tracking progress for drivers / corporate clients
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ token: string }> }
) {
  const params = await props.params;
  const { token } = params;

  try {
    const data = await getPublicTicketTrackingData(token);
    if (!data) {
      return NextResponse.json({ error: 'Tracking record not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error(`GET /api/public/service-tickets/track/${token} error:`, err);
    return NextResponse.json(
      { error: 'Failed to fetch public tracking status' },
      { status: 500 }
    );
  }
}
