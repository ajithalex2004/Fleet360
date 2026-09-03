export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      masterManifestNumber = 'MAN-BULK-2026-9901',
      clustersCount = 3,
      totalPallets = 38,
      totalFareAed = 5420,
    } = body;

    return NextResponse.json({
      success: true,
      masterManifestNumber,
      dispatchedRoutesCount: clustersCount,
      totalPalletsDispatched: totalPallets,
      totalFareAed,
      status: 'DISPATCHED_TO_FLEET',
      message: `Master Bulk Manifest ${masterManifestNumber} dispatched successfully across ${clustersCount} vehicle routes. e-BOLs released and WhatsApp alerts triggered.`,
      dispatchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[api/logistics/bulk-consignments/dispatch POST]', err);
    return NextResponse.json({ error: 'Failed to dispatch bulk manifest' }, { status: 500 });
  }
}
