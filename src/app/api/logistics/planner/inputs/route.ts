/**
 * GET /api/logistics/planner/inputs?type=vehicles|shipments
 *
 * Feeds the planner's selection panes:
 *   - vehicles:  logistics-usable vehicles that have payload capacity AND a
 *     depot configured (the solver can't use a vehicle without either)
 *   - shipments: PENDING shipments that have both a pickup and a delivery
 *     stop (the solver needs the pair)
 *
 * Auth: tenant operator session. Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureRouteOptimizerSchema } from '@/lib/logistics/route-optimizer-schema';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  await ensureRouteOptimizerSchema();
  const type = req.nextUrl.searchParams.get('type');

  try {
    if (type === 'vehicles') {
      const rows = await prisma.$queryRawUnsafe<Array<{
        id: string; license_plate: string | null; payload_capacity_kg: string | number | null;
      }>>(
        `SELECT id, license_plate, payload_capacity_kg
           FROM vehicles
          WHERE deleted_at IS NULL
            AND (vehicle_usage = 'LOGISTICS' OR vehicle_usage IS NULL)
            AND payload_capacity_kg IS NOT NULL
            AND depot_latitude IS NOT NULL
          ORDER BY license_plate NULLS LAST
          LIMIT 200`,
      ).catch(() => []);
      return NextResponse.json({
        vehicles: rows.map(r => ({
          id: r.id,
          label: r.license_plate || r.id.slice(0, 8),
          capacityKg: r.payload_capacity_kg != null ? Number(r.payload_capacity_kg) : null,
        })),
      }, { headers: { 'Cache-Control': 'private, max-age=15' } });
    }

    if (type === 'shipments') {
      // Pending shipments that have at least one pickup AND one delivery stop.
      const rows = await prisma.$queryRawUnsafe<Array<{
        id: string; shipment_no: string | null; total_weight_kg: string | number | null;
      }>>(
        `SELECT s.id, s.shipment_no, s.total_weight_kg
           FROM logistics_shipment_orders s
          WHERE s.tenant_id = $1
            AND s.deleted_at IS NULL
            AND s.status IN ('PENDING', 'CONFIRMED')
            AND EXISTS (SELECT 1 FROM logistics_shipment_stops st
                         WHERE st.shipment_order_id = s.id AND st.stop_type = 'PICKUP')
            AND EXISTS (SELECT 1 FROM logistics_shipment_stops st
                         WHERE st.shipment_order_id = s.id AND st.stop_type = 'DELIVERY')
          ORDER BY s.created_at DESC
          LIMIT 200`,
        tenantId,
      ).catch(() => []);
      return NextResponse.json({
        shipments: rows.map(r => ({
          id: r.id,
          label: r.shipment_no || r.id.slice(0, 8),
          weightKg: r.total_weight_kg != null ? Number(r.total_weight_kg) : null,
        })),
      }, { headers: { 'Cache-Control': 'private, max-age=15' } });
    }

    return NextResponse.json({ error: 'type must be vehicles or shipments' }, { status: 400 });
  } catch (e) {
    console.error('[planner/inputs]', e);
    return NextResponse.json({ error: 'Failed to load inputs' }, { status: 500 });
  }
}
