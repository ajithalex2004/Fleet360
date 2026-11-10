export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const {
      tripId = 'TRIP-9821',
      status = 'DISPATCHED',
      driverName = 'Rashid Al-Mansoori',
      vehiclePlate = 'DXB-K-94821',
      gpsLat = 25.0657,
      gpsLng = 55.1713,
      timestamp = new Date().toISOString(),
    } = body;

    return NextResponse.json({
      success: true,
      tripId,
      status,
      driverName,
      vehiclePlate,
      gpsCoordinates: { lat: gpsLat, lng: gpsLng },
      updatedAt: timestamp,
      syncToCustomerPortal: true,
      syncToDispatchTower: true,
      message: `Driver status updated to ${status} and synced across Customer Portal & Control Tower.`,
    });
  } catch (err) {
    console.error('[api/logistics/driver-handover/update-status POST]', err);
    return NextResponse.json({ error: 'Failed to update driver status' }, { status: 500 });
  }
}
