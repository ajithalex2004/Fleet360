export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { parseGs1Barcode } from '@/lib/digital-ebol-engine';

export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const barcode = (body?.barcode || '').trim();
    const palletId = (body?.palletId || '').trim();

    if (!barcode) {
      return NextResponse.json({ error: 'Barcode string required' }, { status: 400 });
    }

    const parsed = parseGs1Barcode(barcode);

    return NextResponse.json({
      success: true,
      verified: true,
      palletId: palletId || `PAL-${Date.now().toString().slice(-4)}`,
      barcode,
      parsed,
      scannedAt: new Date().toISOString(),
      status: 'VERIFIED_LOADED',
    });
  } catch (err) {
    console.error('[api/logistics/ebol/scan-pallet POST]', err);
    return NextResponse.json({ error: 'Failed to scan and verify pallet' }, { status: 500 });
  }
}
