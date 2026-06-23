/**
 * POST /api/logistics/shipments/[id]/tracking
 *
 * Ingest a GPS ping for a shipment (from a driver app / telematics device),
 * then recompute the ETA. If the new ETA has shifted materially since the
 * customer was last told, recomputeShipmentEta sends them an SMS + email.
 *
 * Body:
 *   { latitude, longitude, occurredAt?, eventType?, status?, source?, notes? }
 *
 * Returns: { event: { id }, eta: EtaPrediction, notified, notifyReason }
 *
 * Auth: tenant operator/device session (x-tenant-id). The ETA recompute +
 * notification is best-effort — a failure there never fails the ingest, so a
 * driver's location always lands even if the notifier is down.
 */

import { NextRequest, NextResponse } from 'next/server';
import { addTrackingEvent } from '@/lib/logistics/domain';
import { recomputeShipmentEta } from '@/lib/logistics/eta-notifier';
import { evaluateShipmentGeofences } from '@/lib/logistics/geofence-service';

export const runtime = 'nodejs';

interface Body {
  latitude?: number;
  longitude?: number;
  occurredAt?: string;
  eventType?: string;
  status?: string;
  source?: string;
  notes?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (body.latitude == null || body.longitude == null) {
    return NextResponse.json({ error: 'latitude and longitude are required' }, { status: 400 });
  }

  try {
    // addTrackingEvent persists the ping (and writes its own audit trail).
    await addTrackingEvent({
      tenantId,
      shipmentOrderId: id,
      eventType: body.eventType ?? 'GPS_PING',
      status: body.status ?? null,
      latitude: body.latitude,
      longitude: body.longitude,
      source: body.source ?? 'gps',
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      notes: body.notes ?? null,
    });

    // Recompute the ETA + notify on material change. Best-effort — never
    // fails the ingest.
    let etaResult: Awaited<ReturnType<typeof recomputeShipmentEta>> | null = null;
    try {
      etaResult = await recomputeShipmentEta({ tenantId, shipmentOrderId: id });
    } catch (e) {
      console.error('[tracking ingest] ETA recompute failed', e);
    }

    // Evaluate geofences (arrival/departure/route-deviation). Best-effort.
    let geofence: Awaited<ReturnType<typeof evaluateShipmentGeofences>> | null = null;
    try {
      geofence = await evaluateShipmentGeofences({ tenantId, shipmentOrderId: id });
    } catch (e) {
      console.error('[tracking ingest] geofence eval failed', e);
    }

    return NextResponse.json({
      ingested: true,
      eta: etaResult?.prediction ?? null,
      notified: etaResult?.notified ?? false,
      notifyReason: etaResult?.notifyDecision?.reason ?? null,
      geofenceEvents: geofence?.events ?? [],
      alertsRaised: geofence?.raised ?? 0,
    }, { status: 201 });
  } catch (e) {
    console.error('[tracking ingest]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'tracking ingest failed' },
      { status: 500 },
    );
  }
}
