/**
 * GET /api/logistics/rfqs/[id]/broadcast/candidates?radiusKm=&vehicleType=&limit=
 *
 * The nearest idle gig drivers (owner-operator carriers) to THIS load's pickup —
 * resolves the RFQ → shipment → pickup GPS server-side, then runs
 * findNearestIdleCarriers. Feeds the "top 3 nearest" + override picker on the
 * driver-broadcast panel.
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  findNearestIdleCarriers, resolveShipmentPickupGeo,
  getCarrierAwardComplianceBlockers,
} from '@/lib/logistics/domain';

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
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const num = (n: string, d?: number) => { const v = Number(sp.get(n)); return Number.isFinite(v) ? v : d; };

  try {
    const shipmentId = await rfqShipmentId(tenantId, id);
    if (!shipmentId) return NextResponse.json({ error: 'RFQ not found' }, { status: 404 });

    // The load's required vehicle type — only suggest drivers whose vehicle matches.
    const vtRows = await prisma.$queryRawUnsafe<Array<{ requested_vehicle_type: string | null }>>(
      `SELECT requested_vehicle_type FROM logistics_shipment_orders WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      shipmentId, tenantId,
    ).catch(() => [] as Array<{ requested_vehicle_type: string | null }>);
    const requestedVehicleType = vtRows[0]?.requested_vehicle_type ?? null;

    const pickup = await resolveShipmentPickupGeo(tenantId, shipmentId);
    if (!pickup) {
      return NextResponse.json({ data: [], pickup: null, requestedVehicleType, note: 'This load has no pickup GPS yet, so nearby drivers can’t be ranked. Geocode the pickup or add pickup coordinates.' });
    }

    // Compliance pre-filter: getCarrierAwardComplianceBlockers can reject a
    // candidate (missing insurance, expired licence, etc.) — better to drop
    // those before showing the list than to surprise the operator with a
    // 409 at assign time. Over-fetch by 3× the requested limit so we still
    // hit the target N after blocked drivers are removed; cap at 30 so the
    // compliance fan-out stays small even when a caller asks for the max.
    const wantedLimit = num('limit', 3) ?? 3;
    const overFetch = Math.min(Math.max(wantedLimit * 3, wantedLimit), 30);

    const candidates = await findNearestIdleCarriers({
      tenantId,
      lat: pickup.lat,
      lng: pickup.lng,
      radiusKm: num('radiusKm'),
      // Match the load's vehicle type by default; an explicit ?vehicleType= overrides.
      vehicleType: sp.get('vehicleType') ?? requestedVehicleType,
      limit: overFetch,
    });

    type Candidate = (typeof candidates)[number];
    const compliant: Candidate[] = [];
    const blocked: Array<{ carrierId: string; carrierName: string | null; reasons: string[] }> = [];
    await Promise.all(candidates.map(async (c) => {
      const issues = await getCarrierAwardComplianceBlockers({
        tenantId, carrierId: c.carrierId, requireVehicle: false,
      }).catch(() => [] as Array<{ severity: string; label: string }>);
      const errors = issues.filter(i => i.severity === 'ERROR');
      if (errors.length === 0) compliant.push(c);
      else blocked.push({ carrierId: c.carrierId, carrierName: c.carrierName ?? null, reasons: errors.map(e => e.label) });
    }));

    // Promise.all loses order — restore the scorecard-weighted ranking
    // emitted by findNearestIdleCarriers (effectiveDistanceKm ASC).
    compliant.sort((a, b) => (a.effectiveDistanceKm ?? Infinity) - (b.effectiveDistanceKm ?? Infinity));
    const data = compliant.slice(0, wantedLimit);

    return NextResponse.json(
      { data, pickup, requestedVehicleType, blockedCount: blocked.length, blocked: blocked.slice(0, 10) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[rfqs/:id/broadcast/candidates GET]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to find drivers' }, { status: 500 });
  }
}
