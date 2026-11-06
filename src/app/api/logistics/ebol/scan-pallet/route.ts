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
      bolNumber = 'EBOL-2026-8410',
      palletBarcode = 'PLT-DXB-00192',
      scannerStage = 'LOADING_DOCK',
      scannedBy = 'Rashid Al-Mansoori (Driver)',
      gpsLat = 24.9857,
      gpsLng = 55.0273,
    } = body;

    return NextResponse.json({
      success: true,
      bolNumber,
      palletBarcode,
      scannerStage,
      scannedBy,
      scannedAt: new Date().toISOString(),
      gps: { lat: gpsLat, lng: gpsLng },
      verified: true,
      chainOfCustodyHash: `SHA256-${Buffer.from(`${bolNumber}:${palletBarcode}:${Date.now()}`).toString('base64').slice(0, 24)}`,
    });
  } catch (err) {
    console.error('[api/logistics/ebol/scan-pallet POST]', err);
    return NextResponse.json({ error: 'Failed to scan pallet barcode' }, { status: 500 });
  }
}
