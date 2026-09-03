export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  createDigitalEBOL,
  DigitalEBOLRecord,
} from '@/lib/digital-ebol-engine';

const EBOL_STORE: Record<string, DigitalEBOLRecord> = {};

export async function GET(req: NextRequest) {
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
  try {
    const body = await req.json();
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
