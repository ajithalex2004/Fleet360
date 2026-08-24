/**
 * POST /api/logistics/shipments/[id]/stops
 *
 * Replace the pickup/delivery stops of a shipment order — used by the New
 * Shipment Order form to persist the coordinates picked on the map (the
 * shipment row itself has no lat/lng; geo lives at the stop level, which the
 * Control Tower map, planner, and pickup-geo broadcast all read).
 *
 * The shipment CREATE is proxied to the Go backend (api-shim), which does not
 * write stops; this sibling Next route writes them in a second call. The path
 * (.../[id]/stops) is intentionally NOT in api-shim MIGRATED_PREFIXES, so it is
 * served here rather than proxied.
 *
 * Auth: tenant operator session; tenantId from the middleware-set x-tenant-id
 * header, never the body. The shipment is ownership-checked before any write.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
interface StopInput {
  stopType: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE' | string;
  sequenceNo?: number;
  locationName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  plannedArrivalAt?: string | null;
  plannedDepartAt?: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  }
  const shipmentId = params.id;

  let body: { stops?: StopInput[] };
  try { body = (await req.json()) as { stops?: StopInput[] }; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const stops = Array.isArray(body.stops) ? body.stops : [];
  if (stops.length === 0) {
    return NextResponse.json({ error: 'No stops provided' }, { status: 400 });
  }

  try {
    // Ownership check — refuse to write stops onto another tenant's shipment.
    const owned = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM logistics_shipment_orders
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      shipmentId, tenantId,
    );
    if (!owned.length) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    }

    // Replace any existing stops, then insert the supplied set (idempotent
    // re-submit). Mirrors the column set used by domain.createShipmentOrder.
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_shipment_stops WHERE tenant_id = $1 AND shipment_order_id = $2`,
      tenantId, shipmentId,
    );
    let seq = 0;
    for (const s of stops) {
      seq += 1;
      await prisma.$executeRawUnsafe(
        `INSERT INTO logistics_shipment_stops
           (tenant_id, shipment_order_id, sequence_no, stop_type, location_name, address,
            latitude, longitude, planned_arrival_at, planned_depart_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)`,
        tenantId,
        shipmentId,
        s.sequenceNo ?? seq,
        s.stopType,
        s.locationName ?? null,
        s.address ?? null,
        s.latitude ?? null,
        s.longitude ?? null,
        s.plannedArrivalAt ?? null,
        s.plannedDepartAt ?? null,
      );
    }

    return NextResponse.json({ ok: true, count: stops.length });
  } catch (e) {
    console.error('[logistics/shipments/:id/stops POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to save stops' },
      { status: 500 },
    );
  }
}
