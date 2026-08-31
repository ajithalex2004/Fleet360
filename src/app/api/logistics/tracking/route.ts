export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

const toNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const tenantWhere = ' AND so.tenant_id = $1';
      const params = [tenantId];

      try {
        const rows = await tx.$queryRawUnsafe<Array<{
          id: string;
          booking_ref: string | null;
          status: string | null;
          requestor_name: string | null;
          origin: string | null;
          destination: string | null;
          driver_name: string | null;
          vehicle_plate: string | null;
          shipment_type: string | null;
          start_date: Date | null;
          end_date: Date | null;
          latitude: string | number | null;
          longitude: string | number | null;
          position_ts: Date | null;
          position_source: string | null;
        }>>(
          `WITH latest_tracking AS (
              SELECT DISTINCT ON (shipment_order_id)
                     shipment_order_id, latitude, longitude, source, occurred_at
                FROM logistics_tracking_events
               WHERE latitude IS NOT NULL AND longitude IS NOT NULL
               ORDER BY shipment_order_id, occurred_at DESC, created_at DESC
            ),
            latest_pod AS (
              SELECT DISTINCT ON (shipment_order_id)
                     shipment_order_id,
                     NULLIF(gps->>'lat', '')::numeric AS latitude,
                     NULLIF(gps->>'lng', '')::numeric AS longitude,
                     delivered_at
                FROM logistics_pod_events
               WHERE gps IS NOT NULL
               ORDER BY shipment_order_id, created_at DESC
            ),
            origin_stop AS (
              SELECT DISTINCT ON (shipment_order_id)
                     shipment_order_id, latitude, longitude
                FROM logistics_shipment_stops
               WHERE latitude IS NOT NULL AND longitude IS NOT NULL
               ORDER BY shipment_order_id, sequence_no ASC
            )
            SELECT so.id,
                   so.shipment_no AS booking_ref,
                   so.status,
                   so.cargo_owner_name AS requestor_name,
                   COALESCE(so.origin_name, so.origin_address) AS origin,
                   COALESCE(so.destination_name, so.destination_address) AS destination,
                   NULL::text AS driver_name,
                   NULL::text AS vehicle_plate,
                   so.shipment_type,
                   so.pickup_window_from AS start_date,
                   so.delivery_window_to AS end_date,
                   COALESCE(lt.latitude, lp.latitude, os.latitude, 25.2048) AS latitude,
                   COALESCE(lt.longitude, lp.longitude, os.longitude, 55.2708) AS longitude,
                   COALESCE(lt.occurred_at, lp.delivered_at, so.updated_at, so.created_at) AS position_ts,
                   CASE
                     WHEN lt.latitude IS NOT NULL THEN 'driver_update'
                     WHEN lp.latitude IS NOT NULL THEN 'epod'
                     ELSE 'estimated'
                   END AS position_source
              FROM logistics_shipment_orders so
              LEFT JOIN latest_tracking lt ON lt.shipment_order_id = so.id
              LEFT JOIN latest_pod lp ON lp.shipment_order_id = so.id
              LEFT JOIN origin_stop os ON os.shipment_order_id = so.id
             WHERE so.deleted_at IS NULL
               AND so.status IN ('ASSIGNED','DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','DELIVERED')${tenantWhere}
             ORDER BY so.updated_at DESC, so.created_at DESC
             LIMIT 200`,
          ...params,
        );

        return NextResponse.json(rows.map(row => ({
          id: row.id,
          bookingRef: row.booking_ref,
          status: row.status,
          requestorName: row.requestor_name,
          origin: row.origin,
          destination: row.destination,
          driverName: row.driver_name,
          vehiclePlate: row.vehicle_plate,
          shipmentType: row.shipment_type,
          startDate: row.start_date?.toISOString() ?? null,
          endDate: row.end_date?.toISOString() ?? null,
          position: {
            lat: toNumber(row.latitude) ?? 25.2048,
            lng: toNumber(row.longitude) ?? 55.2708,
            ts: row.position_ts?.toISOString() ?? new Date().toISOString(),
            source: row.position_source === 'driver_update' || row.position_source === 'epod'
              ? row.position_source
              : 'estimated',
          },
        })));
      } catch (e) {
        console.error('[logistics/tracking GET]', e);
        return NextResponse.json({ error: 'Unable to load live shipment tracking' }, { status: 500 });
      }
  });
}

