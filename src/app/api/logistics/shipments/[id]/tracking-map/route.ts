/**
 * GET /api/logistics/shipments/[id]/tracking-map
 *
 * Everything the live-tracking map needs for one shipment:
 *   - stops: pickup/delivery coordinates + geofence radius (drawn as zones)
 *   - latest: the most recent GPS position (the truck marker)
 *   - trail:  the recent GPS path (a breadcrumb line)
 *   - eta:    the latest persisted ETA from the telematics layer
 *
 * Auth: tenant operator session (x-tenant-id). Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const DEFAULT_RADIUS_M = 200;
const TRAIL_LIMIT = 50;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  try {
    const shipRows = await prisma.$queryRawUnsafe<Array<{ shipment_no: string | null; status: string | null; destination_name: string | null }>>(
      `SELECT shipment_no, status, destination_name
         FROM logistics_shipment_orders
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
      id, tenantId,
    ).catch(() => []);
    if (!shipRows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const stopRows = await prisma.$queryRawUnsafe<Array<{
      id: string; stop_type: string; sequence_no: number;
      latitude: string | number | null; longitude: string | number | null;
      location_name: string | null; geofence_radius_m: number | null;
    }>>(
      `SELECT id, stop_type, sequence_no, latitude::text, longitude::text, location_name, geofence_radius_m
         FROM logistics_shipment_stops
        WHERE shipment_order_id = $1 AND tenant_id = $2
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY sequence_no ASC`,
      id, tenantId,
    ).catch(() => []);

    const trailRows = await prisma.$queryRawUnsafe<Array<{
      latitude: string | number; longitude: string | number; occurred_at: string;
    }>>(
      `SELECT latitude::text, longitude::text, occurred_at::text
         FROM logistics_tracking_events
        WHERE shipment_order_id = $1 AND tenant_id = $2
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY occurred_at DESC
        LIMIT ${TRAIL_LIMIT}`,
      id, tenantId,
    ).catch(() => []);

    // Latest persisted ETA from the telematics layer (what customer-tracking shows).
    const etaRows = await prisma.$queryRawUnsafe<Array<{ eta_at: string | null }>>(
      `SELECT eta_at::text
         FROM logistics_telematics_events
        WHERE shipment_order_id = $1 AND tenant_id = $2 AND eta_at IS NOT NULL
        ORDER BY event_time DESC LIMIT 1`,
      id, tenantId,
    ).catch(() => []);

    const stops = stopRows.map(s => ({
      id: s.id,
      type: s.stop_type.toUpperCase(),
      sequence: s.sequence_no,
      latitude: num(s.latitude)!,
      longitude: num(s.longitude)!,
      label: s.location_name,
      radiusM: s.geofence_radius_m ?? DEFAULT_RADIUS_M,
    }));

    // trailRows is newest-first; reverse to chronological for a drawn line.
    const trail = trailRows
      .map(t => ({ latitude: num(t.latitude)!, longitude: num(t.longitude)!, at: t.occurred_at }))
      .reverse();
    const latest = trail.length ? trail[trail.length - 1] : null;

    return NextResponse.json({
      shipmentNo: shipRows[0].shipment_no,
      status: shipRows[0].status,
      destinationName: shipRows[0].destination_name,
      stops,
      trail,
      latest,
      etaAt: etaRows[0]?.eta_at ?? null,
    }, {
      headers: { 'Cache-Control': 'private, max-age=15' },
    });
  } catch (e) {
    console.error('[tracking-map]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
