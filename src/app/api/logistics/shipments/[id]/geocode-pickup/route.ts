export const dynamic = 'force-dynamic';

/**
 * POST /api/logistics/shipments/[id]/geocode-pickup
 *
 * Resolve the shipment's pickup address text into lat/lng and write it onto
 * the first PICKUP stop, so the Driver Broadcast candidate finder can rank
 * nearby drivers by distance. Used by the marketplace broadcast panel when
 * a shipment was created without map coordinates (typical shipper-portal
 * submissions: the shipper types "Zayed Airport" and never drops a pin).
 *
 * Behaviour:
 *   - Reads origin_address (or falls back to origin_name) from the shipment.
 *   - Calls the cached Mapbox geocoder (src/lib/logistics/geocoder).
 *   - If a PICKUP stop already exists, UPDATEs its lat/lng/address (cheaper
 *     than DELETE+INSERT and preserves any contact info the operator set).
 *   - If no PICKUP stop, INSERTs one with sequence_no=1.
 *
 * Auth: tenant operator session; tenantId from x-tenant-id header. Ownership
 * is enforced by the WHERE tenant_id = $1 on both lookup queries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { geocode, GeocodeError } from '@/lib/logistics/geocoder';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
interface ShipmentRow {
  id: string;
  origin_name: string | null;
  origin_address: string | null;
}

interface StopRow { id: string; }

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  // Wrapped so app.tenant_id is set for this handler's database work. The
  // queries already pass tenantId explicitly; the wrapper is what keeps that
  // true once the connection role no longer holds BYPASSRLS.
  return withTenantRls(prisma, tenantId, async (tx) => {
  const shipmentId = params.id;

  try {
    const owned = await tx.$queryRawUnsafe<ShipmentRow[]>(
      `SELECT id, origin_name, origin_address
         FROM logistics_shipment_orders
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      shipmentId, tenantId,
    );
    const shipment = owned[0];
    if (!shipment) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    }

    const address = (shipment.origin_address?.trim() || shipment.origin_name?.trim()) ?? '';
    if (!address) {
      return NextResponse.json({
        error: 'This shipment has no origin name or address to geocode. Edit the shipment and pick a location on the map.',
      }, { status: 400 });
    }

    const result = await geocode(address, tenantId);

    const existing = await tx.$queryRawUnsafe<StopRow[]>(
      `SELECT id FROM logistics_shipment_stops
        WHERE tenant_id = $1 AND shipment_order_id = $2 AND stop_type = 'PICKUP'
        ORDER BY sequence_no ASC LIMIT 1`,
      tenantId, shipmentId,
    );

    if (existing[0]) {
      await tx.$executeRawUnsafe(
        `UPDATE logistics_shipment_stops
            SET latitude = $1, longitude = $2,
                location_name = COALESCE(location_name, $3),
                address = COALESCE(address, $4),
                updated_at = NOW()
          WHERE id = $5`,
        result.latitude, result.longitude,
        shipment.origin_name ?? null,
        shipment.origin_address ?? null,
        existing[0].id,
      );
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO logistics_shipment_stops
           (tenant_id, shipment_order_id, sequence_no, stop_type, location_name, address, latitude, longitude)
         VALUES ($1, $2, 1, 'PICKUP', $3, $4, $5, $6)`,
        tenantId, shipmentId,
        shipment.origin_name ?? null,
        shipment.origin_address ?? null,
        result.latitude, result.longitude,
      );
    }

    return NextResponse.json({
      ok: true,
      address,
      latitude: result.latitude,
      longitude: result.longitude,
      confidence: result.confidence,
      source: result.source,
    });
    } catch (e) {
    if (e instanceof GeocodeError) {
      const friendly = e.kind === 'no_token'
        ? 'Map service is not configured (NEXT_PUBLIC_MAPBOX_TOKEN / MAPBOX_TOKEN). Ask your admin to set it up, or pin the pickup on the map manually.'
        : e.kind === 'no_match'
          ? 'Could not find a map location for this address. Try a more specific origin, or pin it on the map manually.'
          : 'The map service returned an e. Try again in a moment, or pin the pickup on the map manually.';
      return NextResponse.json({ error: friendly, kind: e.kind }, { status: 422 });
    }
    console.error('[logistics/shipments/:id/geocode-pickup POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Geocoding failed' },
      { status: 500 },
    );
  }
  });
}
