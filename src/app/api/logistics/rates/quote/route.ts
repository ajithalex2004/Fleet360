/**
 * POST /api/logistics/rates/quote
 *
 * Preview a freight quote without creating a shipment. The /logistics/shipments/new
 * form calls this on origin/destination/vehicle blur so the operator sees the
 * contracted rate before they hit submit.
 *
 * Body:
 *   {
 *     origin, destination,
 *     vehicleType?, serviceLevel?,
 *     customerId?, carrierId?,
 *     shipmentDate?  // ISO date — defaults to today
 *   }
 *
 * Returns: QuoteShipmentResult (see rate-engine.ts).
 *
 * Auth: requires tenant operator session (xl-session). Read-only — never
 *       mutates state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { quoteShipment, type QuoteShipmentInput } from '@/lib/logistics/rate-engine';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: Partial<QuoteShipmentInput>;
  try { body = (await req.json()) as Partial<QuoteShipmentInput>; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.origin?.trim() || !body.destination?.trim()) {
    return NextResponse.json({ error: 'origin and destination are required' }, { status: 400 });
  }

  try {
    const result = await quoteShipment({
      tenantId,
      origin: body.origin.trim(),
      destination: body.destination.trim(),
      vehicleType: body.vehicleType ?? null,
      serviceLevel: body.serviceLevel ?? null,
      customerId: body.customerId ?? null,
      carrierId: body.carrierId ?? null,
      shipmentDate: body.shipmentDate ?? null,
      distanceKm: body.distanceKm ?? null,
      weightKg: body.weightKg ?? null,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=10' },
    });
  } catch (e) {
    console.error('[rates/quote] error', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'quote failed' },
      { status: 500 },
    );
  }
}
