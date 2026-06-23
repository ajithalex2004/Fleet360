/**
 * GET /api/logistics/shipments/[id]/eta
 *
 * Returns the shipment's current dynamic ETA, computed fresh from its latest
 * GPS history. Notifications are suppressed (a read shouldn't message anyone),
 * but the ETA is persisted to the latest tracking event's metadata so the
 * customer-tracking view stays in sync.
 *
 * Returns: EtaPrediction (etaAt, method, confidence, remainingKm,
 *          effectiveSpeedKmh, reason) or { error } when the shipment is gone.
 *
 * Auth: tenant operator session (x-tenant-id). Read-only w.r.t. business
 * state (only refreshes the cached ETA metadata).
 */

import { NextRequest, NextResponse } from 'next/server';
import { recomputeShipmentEta } from '@/lib/logistics/eta-notifier';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  try {
    const result = await recomputeShipmentEta({
      tenantId,
      shipmentOrderId: id,
      suppressNotifications: true,
    });
    if (!result.prediction) {
      return NextResponse.json({ error: result.reason || 'No ETA available' }, { status: 404 });
    }
    return NextResponse.json(result.prediction, {
      headers: { 'Cache-Control': 'private, max-age=15' },
    });
  } catch (e) {
    console.error('[shipments/[id]/eta]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'ETA computation failed' },
      { status: 500 },
    );
  }
}
