export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  generateContinuousTelemetryStream,
  COLD_CHAIN_TARGET_BANDS,
} from '@/lib/cold-chain-telematics';

export async function GET(req: NextRequest) {
  const tripRef = req.nextUrl.searchParams.get('tripRef') || 'TRIP-9821';
  const band = req.nextUrl.searchParams.get('band') || 'FROZEN_PHARMA';

  const telemetry = generateContinuousTelemetryStream(tripRef, band);

  return NextResponse.json({
    success: true,
    telemetry,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tripRef = 'TRIP-9821', band = 'FROZEN_PHARMA' } = body;
    const telemetry = generateContinuousTelemetryStream(tripRef, band);

    return NextResponse.json({
      success: true,
      telemetry,
      message: 'Live IoT telematics packet ingested successfully',
    });
  } catch (err) {
    console.error('[api/logistics/telematics/stream POST]', err);
    return NextResponse.json({ error: 'Failed to ingest telematics' }, { status: 500 });
  }
}
