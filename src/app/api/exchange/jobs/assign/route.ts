export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';

export const runtime = 'nodejs';

/**
 * POST /api/exchange/jobs/assign
 *
 * Partner assigns a vehicle and driver to an awarded job and generates a secure driver execution link.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { awardId, partnerId, vehicleId, vehiclePlate, driverId, driverName, driverPhone } = body;

    if (!awardId || !partnerId || !vehiclePlate || !driverName || !driverPhone) {
      return NextResponse.json({ error: 'Missing required assignment fields' }, { status: 400 });
    }

    const res = await OutsourceEngine.assignVehicleAndDriver({
      awardId,
      partnerId,
      vehicleId,
      vehiclePlate,
      driverId,
      driverName,
      driverPhone,
    });

    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to assign vehicle/driver' }, { status: 500 });
  }
}
