export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  createDigitalEBOL,
  DigitalEBOLRecord,
} from '@/lib/digital-ebol-engine';

const EBOL_STORE: Record<string, DigitalEBOLRecord> = {};

export async function GET(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  const ebolNumber = req.nextUrl.searchParams.get('ebolNumber');
  if (ebolNumber && EBOL_STORE[ebolNumber]) {
    return NextResponse.json({ success: true, ebol: EBOL_STORE[ebolNumber] });
  }

  return NextResponse.json({
    success: true,
    records: Object.values(EBOL_STORE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const ebol = createDigitalEBOL(body);
    EBOL_STORE[ebol.ebolNumber] = ebol;

    return NextResponse.json({
      success: true,
      ebol,
      message: `Digital Bill of Lading ${ebol.ebolNumber} generated and cryptographically sealed with SHA-256`,
    });
  } catch (err) {
    console.error('[api/logistics/ebol POST]', err);
    return NextResponse.json({ error: 'Failed to generate e-BOL' }, { status: 500 });
  }
}
