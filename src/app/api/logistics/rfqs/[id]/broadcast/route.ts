/**
 * /api/logistics/rfqs/[id]/broadcast
 *
 *   GET   the active broadcast + live offer responses for this load (operator panel)
 *   POST  broadcast the load as a fixed-price offer to the selected gig drivers
 *
 * POST creates the broadcast + one OFFERED offer (magic-link token) per selected
 * owner-operator carrier and fans out notifications (WhatsApp/SMS link now; push
 * when configured). Drivers accept (Phase 2) → CONFIRMING → operator assigns one.
 *
 * Auth: tenant operator session; tenantId / actor from x-tenant-id / x-user-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { createLoadBroadcast, getActiveLoadBroadcast, resolveShipmentPickupGeo } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

async function rfqShipmentId(tenantId: string, rfqId: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ shipment_order_id: string }>>(
    `SELECT shipment_order_id FROM logistics_freight_rfqs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    rfqId, tenantId,
  ).catch(() => [] as Array<{ shipment_order_id: string }>);
  return rows[0]?.shipment_order_id ?? null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  try {
    const shipmentId = await rfqShipmentId(tenantId, id);
    if (!shipmentId) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });
    const data = await getActiveLoadBroadcast(tenantId, shipmentId);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
    console.error('[rfqs/:id/broadcast GET]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to load broadcast' }, { status: 500 });
  }
}

interface BroadcastBody {
  amount?: number | string;
  currency?: string | null;
  carrierIds?: string[];
  radiusKm?: number | null;
  vehicleType?: string | null;
  responseDeadlineMin?: number | null;
  autoAssign?: boolean;
  pickupLat?: number | null;
  pickupLng?: number | null;
  createdBy?: string | null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {

  const { id } = await ctx.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const createdBy = req.headers.get('x-user-id');

      let bodyRaw: BroadcastBody;
      try {
        bodyRaw = await req.json() as BroadcastBody;
      } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
      const body = stripTenantOwnershipFields(bodyRaw);

      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'A fixed offer amount is required' }, { status: 400 });
      }
      if (!Array.isArray(body.carrierIds) || body.carrierIds.length === 0) {
        return NextResponse.json({ error: 'Select at least one driver to broadcast to' }, { status: 400 });
      }

      try {
        const shipmentId = await rfqShipmentId(tenantId, id);
        if (!shipmentId) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

        // The load's required vehicle type. Refuse to broadcast to any selected
        // driver whose KNOWN vehicle (from their live presence) doesn't match —
        // drivers with no presence yet are allowed (we can't verify until online).
        const vtRows = await tx.$queryRawUnsafe<Array<{ requested_vehicle_type: string | null }>>(
          `SELECT requested_vehicle_type FROM logistics_shipment_orders WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          shipmentId, tenantId,
        ).catch(() => [] as Array<{ requested_vehicle_type: string | null }>);
        const requestedVehicleType = body.vehicleType ?? vtRows[0]?.requested_vehicle_type ?? null;

        if (requestedVehicleType) {
          const presRows = await tx.$queryRawUnsafe<Array<{ carrier_id: string; vehicle_type: string | null; name: string | null }>>(
            `SELECT p.carrier_id, p.vehicle_type, c.name
               FROM logistics_carrier_presence p
               JOIN logistics_carriers c ON c.id = p.carrier_id AND c.tenant_id = p.tenant_id
              WHERE p.tenant_id = $1 AND p.carrier_id = ANY($2::text[])`,
            tenantId, body.carrierIds,
          ).catch(() => [] as Array<{ carrier_id: string; vehicle_type: string | null; name: string | null }>);
          const mismatched = presRows.filter(r => r.vehicle_type && r.vehicle_type !== requestedVehicleType);
          if (mismatched.length > 0) {
            return NextResponse.json({
              error: `This load needs a "${requestedVehicleType}". These drivers don't match: ${mismatched.map(m => m.name ?? m.carrier_id).join(', ')}. Remove them, or pick drivers running a ${requestedVehicleType}.`,
            }, { status: 400 });
          }
        }

        let pickupLat = body.pickupLat ?? null;
        let pickupLng = body.pickupLng ?? null;
        if (pickupLat == null || pickupLng == null) {
          const geo = await resolveShipmentPickupGeo(tenantId, shipmentId);
          if (geo) { pickupLat = geo.lat; pickupLng = geo.lng; }
        }

        const broadcast = await createLoadBroadcast({
          tenantId,
          shipmentOrderId: shipmentId,
          rfqId: id,
          amount,
          currency: body.currency ?? 'AED',
          carrierIds: body.carrierIds,
          pickupLat,
          pickupLng,
          radiusKm: body.radiusKm ?? null,
          vehicleType: requestedVehicleType,
          responseDeadlineMin: body.responseDeadlineMin ?? null,
          autoAssign: Boolean(body.autoAssign),
          createdBy: body.createdBy ?? createdBy,
          baseUrl: req.nextUrl.origin,
        });
        return NextResponse.json(broadcast, { status: 201 });
        } catch (e) {
        console.error('[rfqs/:id/broadcast POST]', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to broadcast the load' }, { status: 500 });
      }
  });
}

