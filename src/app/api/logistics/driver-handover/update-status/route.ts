export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { DeliveryExecutionStatus } from '@/lib/digital-epod-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tripReference = 'TRIP-9821',
      status = 'DELIVERED',
      driverNotes = '',
      gps = { lat: 25.1972, lng: 55.2744 },
    } = body;

    return NextResponse.json({
      success: true,
      tripReference,
      status: status as DeliveryExecutionStatus,
      driverNotes,
      gps,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[api/logistics/driver-handover/update-status POST]', err);
    return NextResponse.json({ error: 'Failed to update driver status' }, { status: 500 });
  }
}
