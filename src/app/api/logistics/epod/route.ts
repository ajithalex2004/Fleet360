export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  createDigitalEPOD,
  DigitalEPODRecord,
} from '@/lib/digital-epod-engine';

const EPOD_STORE: Record<string, DigitalEPODRecord> = {};

export async function GET(req: NextRequest) {
  const epodNumber = req.nextUrl.searchParams.get('epodNumber');
  if (epodNumber && EPOD_STORE[epodNumber]) {
    return NextResponse.json({ success: true, epod: EPOD_STORE[epodNumber] });
  }

  return NextResponse.json({
    success: true,
    records: Object.values(EPOD_STORE),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const epod = createDigitalEPOD(body);
    EPOD_STORE[epod.epodNumber] = epod;

    return NextResponse.json({
      success: true,
      epod,
      message: `Electronic Proof of Delivery (e-POD) ${epod.epodNumber} confirmed and sealed. Final VAT Invoice released.`,
    });
  } catch (err) {
    console.error('[api/logistics/epod POST]', err);
    return NextResponse.json({ error: 'Failed to generate e-POD' }, { status: 500 });
  }
}
