import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const BODY = {
  error: 'Legacy booking-based logistics trip status API has been retired.',
  replacement: '/api/logistics/shipments/[id]/status',
  canonicalEntity: 'logistics_shipment_orders',
};

export async function GET() {
  return NextResponse.json(BODY, { status: 410 });
}

export async function PATCH() {
  return NextResponse.json(BODY, { status: 410 });
}
