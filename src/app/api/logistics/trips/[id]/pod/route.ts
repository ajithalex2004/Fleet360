import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const BODY = {
  error: 'Legacy booking-based logistics trip POD API has been retired.',
  replacement: '/api/logistics/shipments/[id]/pod',
  canonicalEntity: 'logistics_shipment_orders',
};

export async function GET() {
  return NextResponse.json(BODY, { status: 410 });
}

export async function POST() {
  return NextResponse.json(BODY, { status: 410 });
}
